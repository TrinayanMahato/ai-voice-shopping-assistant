"""
Thin wrapper the agent's tools use to call ChQMe's internal product /
catalogue services. Enforces the per-tool latency budget from the design
doc (400-500ms) and never lets a slow/failed call block the voice turn —
callers get a typed error they can turn into a graceful spoken fallback
("let me confirm that and get back to you").
"""
from __future__ import annotations

import json
from typing import Any, Optional

import httpx
from redis.asyncio import Redis
from tenacity import retry, stop_after_attempt, wait_fixed, retry_if_exception_type

from app.config import settings


class ToolCallError(Exception):
    """Raised when an internal tool call fails or times out after retries."""

    def __init__(self, tool_name: str, cause: Exception):
        self.tool_name = tool_name
        self.cause = cause
        super().__init__(f"tool '{tool_name}' failed: {cause!r}")


_http_client: Optional[httpx.AsyncClient] = None
_redis: Optional[Redis] = None


def get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None:
        _http_client = httpx.AsyncClient(timeout=settings.tool_call_timeout_seconds)
    return _http_client


def get_cache() -> Redis:
    global _redis
    if _redis is None:
        _redis = Redis.from_url(settings.redis_url, decode_responses=True)
    return _redis


@retry(
    reraise=True,
    stop=stop_after_attempt(settings.tool_call_retries + 1),
    wait=wait_fixed(0.05),
    retry=retry_if_exception_type((httpx.TimeoutException, httpx.TransportError)),
)
async def _request(method: str, url: str, **kwargs) -> httpx.Response:
    client = get_http_client()
    resp = await client.request(method, url, **kwargs)
    resp.raise_for_status()
    return resp


async def call_tool_api(
    tool_name: str,
    method: str,
    url: str,
    *,
    params: dict[str, Any] | None = None,
    json_body: dict[str, Any] | None = None,
    cache_key: str | None = None,
    cache_ttl: int | None = None,
) -> dict[str, Any]:
    """
    Generic call used by every tool function. If cache_key is given, checks
    Redis first and writes through on a cache miss — this is how inventory
    /pricing get their short TTL cache without duplicating logic per tool.
    """
    cache = None
    try:
        cache = get_cache() if cache_key else None
        if cache is not None:
            cached = await cache.get(cache_key)
            if cached is not None:
                return json.loads(cached)
    except Exception:
        # If Redis isn't running locally, just bypass the cache and fetch directly
        cache = None

    try:
        resp = await _request(method, url, params=params, json=json_body)
        data = resp.json()
    except Exception as exc:  # noqa: BLE001 — deliberately broad, we wrap it
        raise ToolCallError(tool_name, exc) from exc

    if cache is not None and cache_ttl:
        try:
            await cache.set(cache_key, json.dumps(data), ex=cache_ttl)
        except Exception:
            pass

    return data
