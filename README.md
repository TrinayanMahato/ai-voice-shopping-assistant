# AI Voice Shopping Assistant

A real-time **voice AI sales assistant for e-commerce stores**. A shopper starts a voice or video call from a product page and talks to an AI agent. The agent answers questions about products, pricing, availability and store policy in English or Hindi. It handles interruptions naturally and shows product images and videos during the call.

Built during my AI Engineer internship at Chqme (June–Sept 2026). This monorepo holds all four services that make up the system.

## Architecture

```
 Shopper's browser                     LiveKit (WebRTC)                       AI services
┌──────────────────┐   audio/video   ┌──────────────────┐   audio   ┌──────────────────────────┐
│  smart-shop      │◀──────────────▶│   LiveKit room   │◀────────▶│  new-agent               │
│  React call UI   │                 └──────────────────┘           │  VAD → STT → LLM → TTS   │
└────────┬─────────┘                                                └────────────┬─────────────┘
         │ REST (token, products)                                                │ WebSocket
         ▼                                                                       ▼
┌──────────────────┐                                                ┌──────────────────────────┐
│  xai-backend     │  dispatches the agent into the room            │  xai-langgraph-ai-agent  │
│  FastAPI + PG    │───────────────────────────────────────────────▶│  LangGraph + RAG brain   │
└──────────────────┘                                                └──────────────────────────┘
```

| Folder | What it does | Stack |
|---|---|---|
| [`smart-shop/`](smart-shop) | Shopper-facing call UI: in-browser VAD, live captions, product cards and media | React 19, Vite, LiveKit Client, ONNX Runtime Web |
| [`xai-backend/`](xai-backend) | Call tokens, agent dispatch, product/order APIs, call lifecycle, transcript export to S3 | Python, FastAPI, PostgreSQL, AWS S3 |
| [`new-agent/`](new-agent) | Voice agent in the call: Silero VAD, speech-to-text, Sarvam TTS, interruptions, filler phrases, language switching | Python, LiveKit Agents |
| [`xai-langgraph-ai-agent/`](xai-langgraph-ai-agent) | The "brain": LangGraph state machine, hybrid RAG over ChromaDB, tool calling, streaming answers with cancel | Python, FastAPI, LangGraph, OpenAI, ChromaDB, Redis |

Each folder has its own README with setup steps and design details.

## Highlights

- **Full real-time pipeline:** WebRTC audio → voice activity detection → speech-to-text → RAG-grounded LLM → text-to-speech, streamed end to end.
- **Natural conversation:** the shopper can interrupt mid-answer. The agent stops speaking, the in-flight LLM call is cancelled over WebSocket, and it responds to the new question.
- **Grounded answers:** per-store ChromaDB collections plus product/pricing tools, so answers come from the store's real data.
- **Production concerns:** per-call timeouts and retries, Redis caching and session memory, Postgres advisory locks for call state, transcripts archived to S3.

## Running locally

Each service runs on its own; start them in this order:

1. `xai-langgraph-ai-agent/`: the RAG/LLM service
2. `xai-backend/`: the API and LiveKit token service
3. `new-agent/`: the LiveKit voice worker
4. `smart-shop/`: the web UI (`npm install && npm run dev`)

Every service reads its configuration from environment variables (OpenAI, LiveKit, Sarvam, PostgreSQL, Redis, AWS); see each folder's README for the list. `xai-backend/.env.example` is a template.
