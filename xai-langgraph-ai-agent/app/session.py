"""
Session state lives in Redis, not process memory — the orchestrator runs
behind a load balancer and any instance may handle the next turn for a call.
"""
from __future__ import annotations

import datetime as dt

from redis.asyncio import Redis

from app.config import settings
from app.schemas import Message, SessionState

_KEY_PREFIX = "chqme:voice:session:"


def _key(call_id: str) -> str:
    return f"{_KEY_PREFIX}{call_id}"


class SessionStore:
    def __init__(self, redis: Redis):
        self._redis = redis

    @classmethod
    def from_url(cls, url: str | None = None) -> "SessionStore":
        return cls(Redis.from_url(url or settings.redis_url, decode_responses=True))

    async def get(self, call_id: str) -> SessionState:
        raw = await self._redis.get(_key(call_id))
        if raw is None:
            return SessionState(call_id=call_id)
        return SessionState.model_validate_json(raw)

    async def save(self, session: SessionState) -> None:
        session.updated_at = dt.datetime.now(dt.timezone.utc).isoformat()
        await self._redis.set(
            _key(session.call_id),
            session.model_dump_json(),
            ex=settings.session_ttl_seconds,
        )

    async def delete(self, call_id: str) -> None:
        await self._redis.delete(_key(call_id))

    @staticmethod
    def append_turn(
        session: SessionState,
        user_text: str,
        assistant_text: str,
        interrupted: bool = False,
        max_window: int = 12,
    ) -> SessionState:
        """
        Push the latest exchange onto the sliding window. When the window
        overflows, the oldest pair is dropped from message_history — callers
        are responsible for folding dropped turns into `conversation_summary`
        (see summarizer.py) BEFORE calling this, since we only keep the tail.
        """
        session.message_history.append(Message(role="user", content=user_text))
        session.message_history.append(
            Message(role="assistant", content=assistant_text, interrupted=interrupted)
        )
        if len(session.message_history) > max_window:
            overflow = len(session.message_history) - max_window
            session.message_history = session.message_history[overflow:]
        return session
