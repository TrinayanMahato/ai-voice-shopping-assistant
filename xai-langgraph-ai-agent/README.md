# xai-langgraph-ai-agent

The reasoning layer of an **AI shopping assistant**. A shopper asks a question on a live voice call ("Is this available in blue?", "What's the warranty?"), and this service answers it in real time using the store's own product data.

It's a **FastAPI + LangGraph** service with **RAG over ChromaDB**, session memory in **Redis**, and transcript persistence in **PostgreSQL**.

## How it works

```
LiveKit voice agent ──WebSocket /ws/{call_id}──▶ resolve_explicit_context ─▶ main_node ─▶ formatter_node ─▶ answer
                                                         │                    │
                                                   which product?      tools + retrieval
                                                                       (ChromaDB, product APIs)
```

- **LangGraph state machine.** A 3-node graph: resolve which product the shopper means, generate the answer with tool calls, then format it for speech.
- **Hybrid retrieval (RAG).** Per-store ChromaDB collections, combining vector similarity with keyword filters, over product-page and store-policy chunks.
- **Tool calling.** Product details, pricing/promotions and catalogue search via internal APIs, with a hard per-call timeout budget, retries and Redis caching.
- **Streaming over WebSocket.** The voice agent keeps one socket open per call; the service also handles **cancel signals** when the shopper interrupts mid-answer.
- **Conversation memory.** Session state in Redis with TTL, plus rolling summarisation for long calls.
- **Model routing.** A small, fast model for intent/product resolution, a stronger model for the final answer.

## Tech stack

Python · FastAPI · LangGraph · OpenAI · ChromaDB · Redis · PostgreSQL (asyncpg) · httpx · tenacity

## Project structure

```
app/
  main.py              FastAPI app: /healthz, /initialize, WebSocket /ws/{call_id}
  orchestrator.py      Runs one conversational turn through the graph
  graph/               LangGraph state, nodes and graph wiring
  tools/               Retrieval (ChromaDB), product & catalogue tools, HTTP/Redis clients
  llm.py, prompts.py   Model clients and prompt templates
  session.py           Redis-backed session store
  summarizer.py        Rolling conversation summary
  transcript_store.py  Async transcript persistence
```

## Running locally

```bash
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
# create a .env (see below), then:
uvicorn app.main:app --reload --port 8001
```

Environment variables (`.env`): `OPENAI_API_KEY`, `REDIS_URL`, `POSTGRES_DSN`, `CHROMA_ROOT_PATH`, `PRODUCT_API_BASE_URL`, `CATALOGUE_API_BASE_URL`. See `app/config.py` for all options and defaults.

## Part of a 4-service system

| Folder | Role |
|---|---|
| [smart-shop](../smart-shop) | React web app: the shopper's video/voice call UI |
| [xai-backend](../xai-backend) | FastAPI service: call tokens, products, orders, transcripts |
| [new-agent](../new-agent) | LiveKit voice agent: listens, speaks, handles interruptions |
| [xai-langgraph-ai-agent](../xai-langgraph-ai-agent) | LangGraph + RAG "brain" that answers shopper questions |

Built during my AI Engineer internship at **Chqme** (June–Sept 2026).
