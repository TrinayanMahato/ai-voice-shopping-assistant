"""
Product-scoped tools, bound to the product-context node only.

IMPORTANT: the paths below (`/products/{id}`, `/inventory`, ...) are a
placeholder contract inferred from the design doc's tool table. Once ChQMe's
real internal API contract is available, this is the ONLY file that needs
to change for those five tools — the graph, prompts, and OpenAI tool
schemas are all written against the Python function signatures, not the
HTTP shape underneath.
"""
from __future__ import annotations

from typing import Optional

from app.config import settings
from app.tools.client import call_tool_api

_BASE = settings.product_api_base_url


async def get_product_details(product_id: str) -> dict:
    return await call_tool_api(
        "get_product_details",
        "GET",
        f"http://127.0.0.1:8000/products/{product_id}",
        cache_key=f"tool:product:{product_id}",
        cache_ttl=settings.static_cache_ttl_seconds,
    )


# async def get_inventory_status(
#     product_id: str, variant_id: Optional[str] = None, region: Optional[str] = None
# ) -> dict:
#     params = {k: v for k, v in {"variant_id": variant_id, "region": region}.items() if v}
#     cache_key = f"tool:inventory:{product_id}:{variant_id}:{region}"
#     return await call_tool_api(
#         "get_inventory_status",
#         "GET",
#         f"{_BASE}/products/{product_id}/inventory",
#         params=params,
#         cache_key=cache_key,
#         cache_ttl=settings.inventory_cache_ttl_seconds,
#     )


async def get_pricing_promotions(product_id: str) -> dict:
    return await call_tool_api(
        "get_pricing_promotions",
        "GET",
        f"{_BASE}/products/{product_id}/pricing",
        cache_key=f"tool:pricing:{product_id}",
        cache_ttl=settings.pricing_cache_ttl_seconds,
    )


# async def get_related_products(product_id: str) -> dict:
#     return await call_tool_api(
#         "get_related_products",
#         "GET",
#         f"{_BASE}/products/{product_id}/related",
#         cache_key=f"tool:related:{product_id}",
#         cache_ttl=settings.static_cache_ttl_seconds,
#     )


# async def get_product_reviews_summary(product_id: str) -> dict:
#     return await call_tool_api(
#         "get_product_reviews_summary",
#         "GET",
#         f"{_BASE}/products/{product_id}/reviews-summary",
#         cache_key=f"tool:reviews:{product_id}",
#         cache_ttl=settings.static_cache_ttl_seconds,
#     )
