from __future__ import annotations

from langgraph.graph import END, StateGraph

from app.graph.nodes import (
    formatter_node,
    main_node,
    resolve_explicit_context_node,
)
from app.graph.state import GraphState


def build_graph():
    """
    resolve_explicit_context -> main_node -> formatter_node -> END

    Flat 3-node graph — no routing fan-out.
    """
    graph = StateGraph(GraphState)

    graph.add_node("resolve_explicit_context", resolve_explicit_context_node)
    graph.add_node("main_node", main_node)
    graph.add_node("formatter_node", formatter_node)

    graph.set_entry_point("resolve_explicit_context")
    graph.add_edge("resolve_explicit_context", "main_node")
    graph.add_edge("main_node", "formatter_node")
    graph.add_edge("formatter_node", END)

    return graph.compile()


compiled_graph = build_graph()
