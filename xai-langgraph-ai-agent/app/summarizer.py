"""
When message_history exceeds the sliding window, don't just drop the oldest
turns — fold them into `conversation_summary` so a 20-minute call doesn't
forget "I have wide feet" said 15 turns ago.

Runs async / fire-and-forget from the formatter node — never blocks the
live voice turn.
"""
from __future__ import annotations

from openai import AsyncOpenAI

from app.config import settings
from app.schemas import Message, SessionState

_client = AsyncOpenAI(api_key=settings.openai_api_key)

_SUMMARY_PROMPT = """You maintain a running summary of a voice-shopping call.
Fold the NEW turns below into the EXISTING summary. Keep it to 2-4 short
sentences — durable facts only (stated preferences, size, budget, things
ruled out), not blow-by-blow narration. Output the summary text only.

EXISTING SUMMARY:
{existing}

NEW TURNS:
{turns}
"""


async def update_summary_if_needed(
    session: SessionState, dropped_turns: list[Message], max_window: int
) -> SessionState:
    if not dropped_turns:
        return session

    turns_text = "\n".join(f"{m.role}: {m.content}" for m in dropped_turns)
    prompt = _SUMMARY_PROMPT.format(
        existing=session.conversation_summary or "(none yet)", turns=turns_text
    )
    try:
        resp = await _client.chat.completions.create(
            model=settings.router_model,  # cheap model is fine for this
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            max_tokens=150,
        )
        session.conversation_summary = resp.choices[0].message.content.strip()
    except Exception:
        # Non-fatal: summary update failing should never break the live turn.
        # A rule-based fallback (concat + truncate) beats losing context silently.
        fallback = (session.conversation_summary + " " + turns_text).strip()
        session.conversation_summary = fallback[-800:]
    return session
