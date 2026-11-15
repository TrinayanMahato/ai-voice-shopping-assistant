"""
Two tool sets, one per specialized node — binding all tools to one generic
node adds noise to every tool-selection decision (design doc §3/§8).
Each entry pairs an OpenAI function-calling schema with the Python callable
that actually executes it.
"""
from __future__ import annotations

from typing import Any, Awaitable, Callable

from app.tools import catalogue_tools, product_tools, retrieval

ToolFn = Callable[..., Awaitable[Any]]


def _schema(name: str, description: str, params: dict, required: list[str]) -> dict:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {
                "type": "object",
                "properties": params,
                "required": required,
            },
        },
    }


PRODUCT_TOOL_SCHEMAS: list[dict] = [
    # _schema(
    #     "get_product_details",
    #     "STEP 2 (always required): Fetch the complete product record from the database. "
    #     "You MUST call this after retrieve_pdp_context identifies a product_id. "
    #     "The response contains `description_text`, `feature_image`, and a `media_gallery` array. "
    #     "Inside `media_gallery`, each media item has a `features` array detailing specific components "
    #     "(e.g. 'Oven Door', 'Steam Button'). Each feature includes its own `media_params.image.url`. "
    #     "CRITICAL: If you talk about or highlight a specific feature, you MUST use its corresponding "
    #     "`media_params.image.url` to display that feature to the user.",
    #     {"product_id": {"type": "string"}},
    #     ["product_id"],
    # ),
    _schema(
        "get_inventory_status",
        "Live stock for a product, optionally a specific variant/region.",
        {
            "product_id": {"type": "string"},
            "variant_id": {"type": "string"},
            "region": {"type": "string"},
        },
        ["product_id"],
    ),
    _schema(
        "get_pricing_promotions",
        "Fetch active discounts, coupons, or promotions for a specific product. "
        "Call this ONLY when the customer explicitly asks about discounts, offers, or deals "
        "for a product whose product_id you already have from get_product_details.",
        {"product_id": {"type": "string"}},
        ["product_id"],
    ),
    # _schema(
    #     "get_related_products",
    #     "Upsell/cross-sell candidates for a product.",
    #     {"product_id": {"type": "string"}},
    #     ["product_id"],
    # ),
    # _schema(
    #     "get_product_reviews_summary",
    #     "Pre-aggregated review themes and rating for a product.",
    #     {"product_id": {"type": "string"}},
    #     ["product_id"],
    # ),
    _schema(
        "retrieve_pdp_context",
        "STEP 1 (always first): Semantic search over this store's product content in "
        "ChromaDB to identify the relevant product_id and retrieve descriptive context. "
        "Always call this first before any other tool. Use the customer's exact words as "
        "the query. After this returns a product_id, you MUST call get_product_details "
        "with that product_id to get images and real prices before answering. "
        "Omit chunk_types to search everything; narrow it when the question is clearly "
        "one kind. Known types: summary, description, specs, sizing, faq.",
        {
            "query": {"type": "string"},
            "product_id": {
                "type": "string",
                "description": "Filter results to a specific product already in context. "
                               "Omit only when doing an open-ended search.",
            },
            "chunk_types": {"type": "array", "items": {"type": "string"}},
        },
        ["query"],
    ),
]

CATALOGUE_TOOL_SCHEMAS: list[dict] = [
    _schema(
        "search_products",
        "STEP 2 (always required after searching): Fetch full product records (images, prices, variants) "
        "for a list of product IDs from the database. Call this immediately after retrieve_store_context "
        "or retrieve_pdp_context returns relevant product_ids. Pass ALL product_ids found so the customer can see all options.",
        {
            "product_ids": {
                "type": "array",
                "items": {"type": "string"},
                "description": "List of product_id strings returned by retrieve_store_context."
            }
        },
        ["product_ids"],
    ),
    # _schema(
    #     "get_shipping_policy",
    #     "Store-level shipping/returns policy, optionally region-specific.",
    #     {"region": {"type": "string"}},
    #     [],
    # ),
    # _schema(
    #     "get_order_status",
    #     "Order status lookup by order_id or customer_id (post-purchase only).",
    #     {"order_id": {"type": "string"}, "customer_id": {"type": "string"}},
    #     [],
    # ),
    # _schema(
    #     "retrieve_store_context",
    #     "STEP 1 (always first): Semantic search over store-level context (shipping, returns, promotions, "
    #     "categories). Use this to find store policies or to find relevant product_ids by category. "
    #     "Always call this first before search_products. After this returns product_ids, you MUST call "
    #     "search_products with those IDs to fetch their full details before answering. Omit chunk_types to search everything; "
    #     "known types: shipping, returns, promotion, category.",
    #     {
    #         "query": {"type": "string"},
    #         "chunk_types": {"type": "array", "items": {"type": "string"}},
    #     },
    #     ["query"],
    # ),
    _schema(
        "retrieve_pdp_context",
        "STEP 1 (always first): Semantic search over this store's product content in "
        "ChromaDB to identify the relevant product_id and retrieve descriptive context. "
        "Always call this first before any other tool. Use the customer's exact words as "
        "the query. After this returns a product_id, you MUST call search_products "
        "with that product_id to get images and real prices before answering. "
        "Omit chunk_types to search everything; narrow it when the question is clearly "
        "one kind. Known types: summary, description, specs, sizing, faq.",
        {
            "query": {"type": "string"},
            "product_id": {
                "type": "string",
                "description": "Filter results to a specific product already in context. "
                               "Omit only when doing an open-ended search.",
            },
            "chunk_types": {"type": "array", "items": {"type": "string"}},
        },
        ["query"],
    ),
]

PRODUCT_TOOL_FUNCTIONS: dict[str, ToolFn] = {
    "get_product_details": product_tools.get_product_details,
    # "get_inventory_status": product_tools.get_inventory_status,
    "get_pricing_promotions": product_tools.get_pricing_promotions,
    # "get_related_products": product_tools.get_related_products,
    # "get_product_reviews_summary": product_tools.get_product_reviews_summary,
    "retrieve_pdp_context": retrieval.retrieve_pdp_context,
    #"retrieve_store_context": retrieval.retrieve_store_context,
}

CATALOGUE_TOOL_FUNCTIONS: dict[str, ToolFn] = {
    "search_products": catalogue_tools.search_products,
    # "get_shipping_policy": catalogue_tools.get_shipping_policy,
    # "get_order_status": catalogue_tools.get_order_status,
    # "retrieve_store_context": retrieval.retrieve_store_context,
    "retrieve_pdp_context": retrieval.retrieve_pdp_context,
}

