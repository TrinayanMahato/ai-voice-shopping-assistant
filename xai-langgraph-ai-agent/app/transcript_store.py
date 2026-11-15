"""
Async-persist the full transcript to Postgres for analytics, QA, and evals.
Never awaited on the live turn path — call `persist_turn` with
asyncio.create_task(...) and let it run in the background.
"""
from __future__ import annotations

import json
import logging

import asyncpg

from app.config import settings

logger = logging.getLogger("chqme.voice_agent")

_pool: asyncpg.Pool | None = None

_DDL = """
CREATE TABLE IF NOT EXISTS voice_call_turns (
    id BIGSERIAL PRIMARY KEY,
    call_id TEXT NOT NULL,
    customer_id TEXT,
    turn_number INT NOT NULL,
    user_transcript TEXT NOT NULL,
    assistant_message TEXT NOT NULL,
    intent TEXT,
    resolved_product_id TEXT,
    tool_calls JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_voice_call_turns_call_id ON voice_call_turns (call_id);
"""


async def _get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(settings.postgres_dsn, min_size=1, max_size=5)
        async with _pool.acquire() as conn:
            await conn.execute(_DDL)
    return _pool


async def persist_turn(
    *,
    call_id: str,
    customer_id: str | None,
    turn_number: int,
    user_transcript: str,
    assistant_message: str,
    intent: str,
    resolved_product_id: str | None,
    tool_calls: list[dict],
) -> None:
    try:
        pool = await _get_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO voice_call_turns
                    (call_id, customer_id, turn_number, user_transcript,
                     assistant_message, intent, resolved_product_id, tool_calls)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                """,
                call_id,
                customer_id,
                turn_number,
                user_transcript,
                assistant_message,
                intent,
                resolved_product_id,
                json.dumps(tool_calls, default=str),
            )
    except Exception:
        # Analytics write failing must never surface to the live call.
        logger.exception("transcript_persist_failed", extra={"call_id": call_id})
