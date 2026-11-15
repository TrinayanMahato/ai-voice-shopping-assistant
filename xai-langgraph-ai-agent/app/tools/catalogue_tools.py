"""
Catalogue / store-scoped tools, bound to the catalogue node only.
Same caveat as product_tools.py: paths are a placeholder contract.
"""
from __future__ import annotations

from typing import Optional

from app.config import settings
from app.tools.client import call_tool_api

_BASE = settings.catalogue_api_base_url


async def search_products(product_ids: list[str]) -> dict:
    return await call_tool_api(
        "search_products",
        "POST",
        "http://127.0.0.1:8000/products/bulk",
        json_body={"product_ids": product_ids},
    )


# async def get_shipping_policy(region: Optional[str] = None) -> dict:
#     return await call_tool_api(
#         "get_shipping_policy",
#         "GET",
#         f"{_BASE}/policy/shipping",
#         params={"region": region} if region else None,
#         cache_key=f"tool:shipping_policy:{region or 'default'}",
#         cache_ttl=settings.static_cache_ttl_seconds,
#     )
# 
# 
# async def get_order_status(
#     order_id: Optional[str] = None, customer_id: Optional[str] = None
# ) -> dict:
#     params = {k: v for k, v in {"order_id": order_id, "customer_id": customer_id}.items() if v}
#     return await call_tool_api(
#         "get_order_status", "GET", f"{_BASE}/orders/status", params=params
#     )
