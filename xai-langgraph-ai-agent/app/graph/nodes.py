from __future__ import annotations

import logging

from langchain_core.runnables.config import RunnableConfig

from app.config import settings
from app.graph.state import GraphState
from app.llm import run_grounded_turn
from app.prompts import MAIN_SYSTEM_PROMPT
from app.schemas import AgentResponse
from app.session import SessionStore
from app.tools.retrieval import current_store, retrieve_pdp_context

logger = logging.getLogger("chqme.voice_agent")


# ---------------------------------------------------------------------------
# Node 1 — rule-based context resolution (cheap, certain, runs first)
# ---------------------------------------------------------------------------

async def resolve_explicit_context_node(state: GraphState) -> GraphState:
    """
    If the UI fired an explicit product-selection event this turn (customer
    tapped a recommendation card), that overrides everything — no need to
    ask the LLM to infer it.
    """
    session = state["session"]
    selected = state.get("selected_product_id")
    if selected:
        session.current_product_id = selected
    return {"session": session}


# ---------------------------------------------------------------------------
# Node 2 — single main LLM node (replaces router + product + catalogue nodes)
# ---------------------------------------------------------------------------

async def main_node(state: GraphState, config: RunnableConfig) -> GraphState:
    """
    Single grounded LLM node. Takes:
      - messages array (from session history)
      - transcript (current user utterance)
      - current_product_id (from session)
    Calls retrieve_pdp_context to ground the response, then calls the LLM.
    """
    # Store identity rides a ContextVar so the retrieval tool knows which store
    current_store.set(state["store_name"])

    websocket = config["configurable"].get("websocket")
    session = state["session"]

    # Build the messages array from rolling history
    messages = [{"role": m.role, "content": m.content} for m in session.message_history[-6:]]
    transcript_lower = state["transcript"].lower().strip()
    is_ui_click = transcript_lower.startswith("tell me more about") or transcript_lower.startswith("tell me about the feature")
    
    enforcement_str = ""
    if is_ui_click and session.last_answers_language:
        enforcement_str = f"\n\n[CRITICAL SYSTEM OVERRIDE: The user just clicked a UI button. You MUST generate your spoken response in {session.last_answers_language} to maintain conversational continuity. Do NOT reply in English!]"

    gender = state.get('voice_name', 'Not Specified')

    messages.append(
        {
            "role": "user",
            "content": (
                f"[ACTIVE PRODUCT IN FOCUS: {session.current_product_id}]\n"
                f"last_shown_products: {session.last_shown_products}\n"
                f"SPEAKER_GENDER: {gender}\n"
                f"customer says: {state['transcript']}{enforcement_str}"
            ),

        }
    )

    system_prompt = MAIN_SYSTEM_PROMPT.replace("{store_name}", state.get("store_name", "the store"))
    turn_id = f"{state['call_id']}_{state['turn_number']}"

    response, trace = await run_grounded_turn(
        system_prompt=system_prompt,
        messages=messages,
        retrieve_fn=retrieve_pdp_context,
        retrieve_kwargs={
            "query": state["transcript"],
            "product_id": state.get("selected_product_id"),
        },
        websocket=websocket,
        turn_id=turn_id,
        call_id=state.get("call_id"),
        cart_data=session.cart_data,
        default_language=session.default_language,
        last_answers_language=session.last_answers_language,
        conversation_summary=session.conversation_summary,
    )
    return {"agent_response": response, "tool_trace": trace}


# ---------------------------------------------------------------------------
# Node 3 — response formatter: single place that writes session state back
# ---------------------------------------------------------------------------

async def formatter_node(state: GraphState, config: RunnableConfig) -> GraphState:
    session = state["session"]
    response: AgentResponse = state["agent_response"]

    # Update session with new product IDs seen this turn
    if response.current_product_id:
        session.current_product_id = response.current_product_id
        if session.current_product_id not in session.last_shown_products:
            session.last_shown_products.append(session.current_product_id)

    if response.product_ids:
        for pid in response.product_ids:
            if pid not in session.last_shown_products:
                session.last_shown_products.append(pid)
                
    session.last_shown_products = session.last_shown_products[-10:]  # bounded
    session.turn_number = state["turn_number"]
    session.last_answers_language = response.language

    # History windowing and appending
    MAX_WINDOW = 6
    dropped: list = []
    if len(session.message_history) >= MAX_WINDOW:
        dropped = session.message_history[: max(0, len(session.message_history) - MAX_WINDOW + 2)]

    session = SessionStore.append_turn(
        session,
        user_text=state["transcript"],
        assistant_text=response.message,
        interrupted=state["interrupted"],
        max_window=MAX_WINDOW,
    )

    logger.info(
        "turn_complete",
        extra={
            "call_id": state["call_id"],
            "turn": state["turn_number"],
            "tool_calls": [t["tool"] for t in state.get("tool_trace", [])],
        },
    )

    websocket = config["configurable"].get("websocket")
    if websocket:
        # This will perfectly serialize message, current_product_id, product_ids, and question_for_you
        payload = response.model_dump(exclude_defaults=True)
        turn_id = f"{state['call_id']}_{state['turn_number']}"

        await websocket.send_json({
            "event": "final",
            "data": payload,
            "turn_id": turn_id
        })

    return {"session": session, "agent_response": response, "dropped": dropped}
