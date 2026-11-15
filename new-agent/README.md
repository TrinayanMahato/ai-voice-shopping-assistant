# new-agent: real-time multilingual voice agent

A **LiveKit Agents** worker that joins a shopper's call and talks to them by voice: it listens, works out what they asked, gets the answer from the AI backend, and speaks it back, in English or Hindi.

The hard parts of voice AI are latency and turn-taking, and most of this code is about getting those right.

## Highlights

- **Full voice pipeline.** Silero VAD → speech-to-text with language detection → custom RAG LLM → **Sarvam Bulbul v3** TTS.
- **Natural interruptions.** When the shopper starts talking, the agent stops speaking immediately, cancels the in-flight answer on the backend, and notifies the UI.
- **Filler phrases.** Short randomised fillers ("Let me check that for you…") play while the answer is generated, so there's no dead air, without blocking the backend request.
- **Language switching.** Replies in the language the shopper spoke, using the STT's language ID with a text-based fallback.
- **Custom LLM adapter.** A `RAGLLM` / `RAGLLMStream` that plugs the LangGraph backend into LiveKit as if it were an LLM, streaming chunks over WebSocket.
- **Inactivity handling.** Idle detection and prompts, plus a data-channel protocol to the frontend for captions, product cards and status events.
- **Tuned VAD.** Speech-duration thresholds set to avoid self-interruption and noise pops.

## Tech stack

Python · LiveKit Agents · Silero VAD · Sarvam TTS · OpenAI · asyncio · aiohttp · asyncpg

## Files

- `two.py`: the agent worker (session setup, voice pipeline, interruption and filler logic, backend bridge)
- `test_rds.py`: database connectivity check (reads credentials from env vars)

## Running locally

```bash
pip install "livekit-agents[openai,silero,sarvam]" python-dotenv aiohttp asyncpg
python two.py dev
```

Needs a `.env` with `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `OPENAI_API_KEY`, `SARVAM_API_KEY`, and the `DB_*` variables (`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`). Optional: `SARVAM_TTS_SPEAKER`, `SARVAM_TTS_MODEL`, `SARVAM_TTS_LANGUAGE_CODE`.

## Part of a 4-service system

| Folder | Role |
|---|---|
| [smart-shop](../smart-shop) | React web app: the shopper's video/voice call UI |
| [xai-backend](../xai-backend) | FastAPI service: call tokens, products, orders, transcripts |
| [new-agent](../new-agent) | LiveKit voice agent: listens, speaks, handles interruptions |
| [xai-langgraph-ai-agent](../xai-langgraph-ai-agent) | LangGraph + RAG "brain" that answers shopper questions |

Built during my AI Engineer internship at **Chqme** (June–Sept 2026).
