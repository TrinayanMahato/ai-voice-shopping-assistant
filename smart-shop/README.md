# smart-shop

The **React** front end of an AI shopping assistant: a shopper joins a live **video/voice call** with an AI agent that can talk about products, show them on screen, and answer questions in real time.

## Features

- **LiveKit WebRTC call UI**, with separate desktop and mobile layouts, an AI agent tile with an audio-reactive orb/waveform, and a control bar.
- **In-browser voice activity detection** (`@ricky0123/vad-web` + Silero ONNX on `onnxruntime-web`), e.g. to remind the shopper when they're muted but talking.
- **Live captions and chat** streamed from the agent over LiveKit data channels.
- **Rich product media in the call**: product cards, image galleries, GIFs and video sent by the agent mid-conversation.
- **Join flow**: OTP/auth, call-token validation, device checks, fullscreen gate.
- Handles real-world WebRTC issues: track re-attachment, video stretching/zoom fixes, no duplicate connections (StrictMode deliberately off).

## Tech stack

React 19 · Vite · Tailwind CSS v4 · LiveKit client · onnxruntime-web · Silero VAD

## Running locally

Requires Node.js 20.19+ or 22.12+.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build to dist/
```

The app expects its backend services (see `vite.config.js` for the dev proxies) and a LiveKit server URL (`src/constants.js` / `src/hooks/useLiveKitRoom.js`). Point these at your own deployment to run it end to end.

## Project structure

```
src/
  App.jsx        Top-level orchestration
  components/    Meeting UI (desktop + mobile), chat, captions, product media
  hooks/         LiveKit room, voice agent, auth/OTP, VAD, device mode, fullscreen
  utils/         Auth parsing, colour helpers, remote-track rendering
public/          VAD models (Silero ONNX) and worklets, icons
```

## Part of a 4-service system

| Folder | Role |
|---|---|
| [smart-shop](../smart-shop) | React web app: the shopper's video/voice call UI |
| [xai-backend](../xai-backend) | FastAPI service: call tokens, products, orders, transcripts |
| [new-agent](../new-agent) | LiveKit voice agent: listens, speaks, handles interruptions |
| [xai-langgraph-ai-agent](../xai-langgraph-ai-agent) | LangGraph + RAG "brain" that answers shopper questions |

Built during my AI Engineer internship at **Chqme** (June–Sept 2026).
