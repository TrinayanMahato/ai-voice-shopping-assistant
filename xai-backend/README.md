# xai-backend

The **FastAPI** service behind an AI video-call shopping assistant. It issues **LiveKit** call tokens and dispatches the AI agent into rooms, serves product data to the agent, and tracks each AI call from start to finish: orders, intent, duration, cost and transcripts.

## What it does

- **Call setup.** Validates call tokens and generates LiveKit meeting tokens / AI sessions, then dispatches the voice agent into the room.
- **Product APIs.** Single and bulk product lookup, plus media hotspots for the in-call product UI.
- **Call lifecycle.** End-call handling, order status, call-cost updates, using Postgres advisory locks to avoid double-counting.
- **Transcripts.** Appends each conversational turn and exports full transcripts to **AWS S3**.
- **Analytics.** Records the shopper's intent per call; creates orders from the call.
- **Operational.** Async Postgres connection pool, CORS config, structured error logging to the DB.

## Endpoints (selection)

| Method | Path | Purpose |
|---|---|---|
| POST | `/generate_meeting_token` | LiveKit token + agent dispatch |
| POST | `/generate_ai_session` | AI session tokens |
| POST | `/validate_call_token` | Validate a call token |
| GET | `/products/{product_id}` | Product details |
| POST | `/products/bulk` | Bulk product lookup |
| POST | `/append_transcript` | Save a conversation turn |
| POST | `/export_transcript` | Export transcript to S3 |
| POST | `/update_intent` | Record shopper intent |
| POST | `/end_call` | End call, update order status |

Interactive docs at `/docs` once running.

## Tech stack

Python · FastAPI · Pydantic v2 · asyncpg / PostgreSQL · LiveKit server API · boto3 (S3)

## Running locally

```bash
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in your DB, LiveKit and AWS values
uvicorn app.main:app --reload
```

## Project structure

```
app/
  main.py          API routes
  schemas.py       Request/response models
  helpers.py       Product, token, transcript and S3 helpers
  core/
    config.py      Settings (from .env)
    db.py          Async Postgres pool
    queries.py     SQL queries
dump_schema.py     Dumps the DB schema (credentials from env vars)
```

## Part of a 4-service system

| Folder | Role |
|---|---|
| [smart-shop](../smart-shop) | React web app: the shopper's video/voice call UI |
| [xai-backend](../xai-backend) | FastAPI service: call tokens, products, orders, transcripts |
| [new-agent](../new-agent) | LiveKit voice agent: listens, speaks, handles interruptions |
| [xai-langgraph-ai-agent](../xai-langgraph-ai-agent) | LangGraph + RAG "brain" that answers shopper questions |

Built during my AI Engineer internship at **Chqme** (June–Sept 2026).
