from __future__ import annotations

from typing import Optional, TypedDict

from app.schemas import AgentResponse, RouterDecision, SessionState


class GraphState(TypedDict, total=False):
    # --- inbound ---
    call_id: str
    customer_id: Optional[str]
    transcript: str
    turn_number: int
    interrupted: bool
    selected_product_id: Optional[str]
    voice_name: Optional[str]
             
    # --- loaded/produced during the run ---
    session: SessionState
    router_decision: RouterDecision
    agent_response: AgentResponse
    tool_trace: list[dict]
    dropped: list
    store_name: str
