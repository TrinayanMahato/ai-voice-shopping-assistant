from __future__ import annotations

import asyncio
import logging

from app.graph.build import compiled_graph
from app.schemas import AgentResponse, SessionState, TurnInput
from app.session import SessionStore
from app.summarizer import update_summary_if_needed
from app.transcript_store import persist_turn

logger = logging.getLogger("chqme.voice_agent")

MAX_WINDOW = 6


from fastapi import WebSocket

async def process_turn(
    turn: TurnInput, session_store: SessionStore, websocket: WebSocket = None) -> AgentResponse:
    """
    One full turn: load session -> run graph -> update + save session ->
    kick off async side-effects (summary fold, transcript persist) without
    blocking the response back to the LiveKit agent / TTS.
    """
    
    #validate the call_id from backend database, this may be done thru a tool call in the graph, but for now we will do it here
    
    # call xai_backend to validate the call_id and get store name as well 
    
    session: SessionState = await session_store.get(turn.call_id)
    if turn.customer_id and not session.customer_id:
        session.customer_id = turn.customer_id

    store_name = turn.store_name
    
    result = await compiled_graph.ainvoke(
        {
            "call_id": turn.call_id,
            "customer_id": turn.customer_id,
            "transcript": turn.transcript,
            "turn_number": turn.turn_number,
            "interrupted": turn.interrupted_previous_turn,
            "selected_product_id": turn.selected_product_id,
            "voice_name": turn.voice_name,
            "session": session,
            "store_name": store_name,
        },
        config={
            "run_name": f"turn:{turn.call_id}:{turn.turn_number}",
            "metadata": {
                "call_id": turn.call_id,
                "customer_id": turn.customer_id,
                "turn_number": turn.turn_number,
                "store_name": store_name,
            },
            "configurable": {
                "websocket": websocket
            }
        },
    )

    response: AgentResponse = result["agent_response"]
    session = result["session"]
    dropped: list = result.get("dropped", [])
    await session_store.save(session)

    # Fire-and-forget: never block the live voice turn on these.
    asyncio.create_task(update_summary_if_needed(session, dropped, MAX_WINDOW))
    # asyncio.create_task(
    #     persist_turn(
    #         call_id=turn.call_id,
    #         customer_id=turn.customer_id,
    #         turn_number=turn.turn_number,
    #         user_transcript=turn.transcript,
    #         assistant_message=response.message,
    #         intent=response.intent,
    #         resolved_product_id=response.current_product_id,
    #         tool_calls=result.get("tool_trace", []),
    #     )
    # )

    return response
