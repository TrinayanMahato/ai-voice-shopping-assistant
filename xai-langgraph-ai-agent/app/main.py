"""
Entry point for the LiveKit agent to talk to.

Recommended transport: WebSocket, one connection per call room
(`/ws/{call_id}`), opened when the LiveKit agent joins the room and closed
when the call ends. Reasons over plain per-turn HTTP:
  - One connection amortized across the whole call instead of a new
    TCP+TLS handshake every turn — matters when you're chasing every
    100ms of turn latency.
  - Natural place to push a partial/streaming "thinking" signal back to
    the LiveKit agent later if you want filler audio during long tool calls.
  - Session affinity is still handled by Redis (not the WebSocket process),
    so this doesn't reintroduce the "state stuck on one instance" problem —
    if the socket reconnects to a different instance mid-call, session
    state is unaffected.

A plain HTTP POST /turn is kept alongside it for curl/Postman testing and
for the LiveKit agent to fall back to if a socket reconnect is mid-flight.
"""
from __future__ import annotations

import asyncio
import logging
import json

import httpx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from pydantic import ValidationError

from app.config import settings
from app.orchestrator import process_turn
from app.schemas import InitializeInput, TurnInput
from app.session import SessionStore

logging.basicConfig(level=settings.log_level)
logger = logging.getLogger("chqme.voice_agent")

app = FastAPI(title="ChQMe Voice Commerce Agent")

_session_store: SessionStore | None = None


@app.on_event("startup")
async def startup() -> None:
    global _session_store
    _session_store = SessionStore.from_url(settings.redis_url)


def get_session_store() -> SessionStore:
    assert _session_store is not None, "session store not initialized"
    return _session_store


STORE_WELCOME_TEMPLATES = {
    "en-IN": "Welcome to {store_name}, you can ask me about anything, any product, I will be more than happy to help you.",
    "hi-IN": "{store_name} में आपका स्वागत है, आप मुझसे किसी भी चीज़, किसी भी उत्पाद के बारे में पूछ सकते हैं, मुझे आपकी मदद करने में बहुत खुशी होगी।",
    "bn-IN": "{store_name}-এ আপনাকে স্বাগত, আপনি আমাকে যেকোনো কিছু, যেকোনো পণ্য সম্পর্কে জিজ্ঞাসা করতে পারেন, আমি আপনাকে সাহায্য করতে পেরে অত্যন্ত আনন্দিত হব।",
    "kn-IN": "{store_name} ಗೆ ಸುಸ್ವಾಗತ, ನೀವು ನನ್ನನ್ನು ಯಾವುದರ ಬಗ್ಗೆಯಾದರೂ, ಯಾವುದೇ ಉತ್ಪನ್ನದ ಬಗ್ಗೆ ಕೇಳಬಹುದು, ನಿಮಗೆ ಸಹಾಯ ಮಾಡಲು ನನಗೆ ತುಂಬಾ ಸಂತೋಷವಾಗುತ್ತದೆ.",
    "ml-IN": "{store_name}-ലേക്ക് സ്വാഗതം, നിങ്ങൾക്ക് എന്നോട് എന്തിനെക്കുറിച്ചും, ഏത് ഉൽപ്പന്നത്തെക്കുറിച്ചും ചോദിക്കാം, നിങ്ങളെ സഹായിക്കുന്നതിൽ എനിക്ക് അതിയായ സന്തോഷമുണ്ട്.",
    "mr-IN": "{store_name} मध्ये आपले स्वागत आहे, आपण मला कोणत्याही गोष्टीबद्दल, कोणत्याही उत्पादनाबद्दल विचारू शकता, मला तुमची मदत करण्यात खूप आनंद होईल.",
    "or-IN": "{store_name} କୁ ସ୍ଵାଗତ, ଆପଣ ମୋତେ ଯେକୌଣସି ଜିନିଷ, ଯେକୌଣସି ଉତ୍ପାଦ ବିଷୟରେ ପଚାରି ପାରିବେ, ଆପଣଙ୍କୁ ସାହାଯ୍ୟ କରିବାରେ ମୋତେ ବହୁତ ଖୁସି ଲାଗିବ।",
    "pa-IN": "{store_name} ਵਿੱਚ ਤੁਹਾਡਾ ਸੁਆਗਤ ਹੈ, ਤੁਸੀਂ ਮੈਨੂੰ ਕਿਸੇ ਵੀ ਚੀਜ਼, ਕਿਸੇ ਵੀ ਉਤਪਾਦ ਬਾਰੇ ਪੁੱਛ ਸਕਦੇ ਹੋ, ਮੈਨੂੰ ਤੁਹਾਡੀ ਮਦਦ ਕਰਨ ਵਿੱਚ ਬਹੁਤ ਖੁਸ਼ੀ ਹੋਵੇਗੀ।",
    "ta-IN": "{store_name}-க்கு உங்களை வரவேற்கிறோம், நீங்கள் என்னிடம் எதைப் பற்றியும், எந்தப் பொருளைப் பற்றியும் கேட்கலாம், உங்களுக்கு உதவுவதில் நான் மிகவும் மகிழ்ச்சியடைவேன்.",
    "te-IN": "{store_name} కు స్వాగతం, మీరు నన్ను దేని గురించైనా, ఏ ఉత్పత్తి గురించి అయినా అడగవచ్చు, మీకు సహాయం చేయడానికి నేను చాలా సంతోషిస్తాను.",
    "gu-IN": "{store_name} માં તમારું સ્વાગત છે, તમે મને કોઈપણ વસ્તુ, કોઈપણ ઉત્પાદન વિશે પૂછી શકો છો, મને તમારી મદદ કરવામાં ખૂબ જ આનંદ થશે."
}

PRODUCT_WELCOME_TEMPLATES = {
    "en-IN": "I am here to help you about {product_name}, I can tell about anything and everything about the product and I will be more than happy to help you.",
    "hi-IN": "मैं {product_name} के बारे में आपकी मदद करने के लिए यहाँ हूँ, मैं उत्पाद के बारे में कुछ भी और सब कुछ बता सकता हूँ और मुझे आपकी मदद करने में बहुत खुशी होगी।",
    "bn-IN": "আমি {product_name} সম্পর্কে আপনাকে সাহায্য করতে এখানে আছি, আমি পণ্যটি সম্পর্কে যেকোনো কিছু এবং সবকিছু বলতে পারি এবং আমি আপনাকে সাহায্য করতে পেরে অত্যন্ত আনন্দিত হব।",
    "kn-IN": "ನಾನು {product_name} ಬಗ್ಗೆ ನಿಮಗೆ ಸಹಾಯ ಮಾಡಲು ಇಲ್ಲಿದ್ದೇನೆ, ನಾನು ಉತ್ಪನ್ನದ ಬಗ್ಗೆ ಏನಾದರೂ ಮತ್ತು ಎಲ್ಲವನ್ನೂ ಹೇಳಬಲ್ಲೆ ಮತ್ತು ನಿಮಗೆ ಸಹಾಯ ಮಾಡಲು ನನಗೆ ತುಂಬಾ ಸಂತೋಷವಾಗುತ್ತದೆ.",
    "ml-IN": "{product_name}-നെക്കുറിച്ച് നിങ്ങളെ സഹായിക്കാൻ ഞാൻ ഇവിടെയുണ്ട്, എനിക്ക് ഉൽപ്പന്നത്തെക്കുറിച്ച് എന്തിനെക്കുറിച്ചും എല്ലാ കാര്യങ്ങളെക്കുറിച്ചും പറയാൻ കഴിയും, നിങ്ങളെ സഹായിക്കുന്നതിൽ എനിക്ക് അതിയായ സന്തോഷമുണ്ട്.",
    "mr-IN": "मी {product_name} बद्दल तुमची मदत करण्यासाठी येथे आहे, मी उत्पादनाबद्दल काहीही आणि सर्वकाही सांगू शकतो आणि मला तुमची मदत करण्यात खूप आनंद होईल.",
    "or-IN": "ମୁଁ {product_name} ବିଷୟରେ ଆପଣଙ୍କୁ ସାହାଯ୍ୟ କରିବାକୁ ଏଠାରେ ଅଛି, ମୁଁ ଉତ୍ପାଦ ବିଷୟରେ କିଛି ବି ଏବଂ ସବୁକିଛି କହିପାରିବି ଏବଂ ଆପଣଙ୍କୁ ସାହାଯ୍ୟ କରିବାରେ ମୋତେ ବହୁତ ଖୁସି ଲାଗିବ।",
    "pa-IN": "ਮੈਂ {product_name} ਬਾਰੇ ਤੁਹਾਡੀ ਮਦਦ ਕਰਨ ਲਈ ਇੱਥੇ ਹਾਂ, ਮੈਂ ਉਤਪਾਦ ਬਾਰੇ ਕੁਝ ਵੀ ਅਤੇ ਸਭ ਕੁਝ ਦੱਸ ਸਕਦਾ ਹਾਂ ਅਤੇ ਮੈਨੂੰ ਤੁਹਾਡੀ ਮਦਦ ਕਰਨ ਵਿੱਚ ਬਹੁਤ ਖੁਸ਼ੀ ਹੋਵੇਗੀ।",
    "ta-IN": "{product_name} பற்றி உங்களுக்கு உதவ நான் இங்கு இருக்கிறேன், தயாரிப்பு பற்றி நான் எதையும் மற்றும் எல்லாவற்றையும் சொல்ல முடியும், மேலும் உங்களுக்கு உதவுவதில் நான் மிகவும் மகிழ்ச்சியடைவேன்.",
    "te-IN": "నేను {product_name} గురించి మీకు సహాయం చేయడానికి ఇక్కడ ఉన్నాను, నేను ఉత్పత్తి గురించి దేనినైనా మరియు ప్రతిదానిని చెప్పగలను మరియు మీకు సహాయం చేయడానికి నేను చాలా సంతోషిస్తాను.",
    "gu-IN": "હું {product_name} વિશે તમારી મદદ કરવા માટે અહીં છું, હું ઉત્પાદન વિશે કંઈપણ અને બધું કહી શકું છું અને મને તમારી મદદ કરવામાં ખૂબ જ આનંદ થશે."
}

@app.get("/healthz")
async def healthz():
    return {"status": "ok"}


@app.post("/initialize")
async def initialize(initialize: InitializeInput, product_id: str | None = None):
    """Initialize a new call session in Redis. This is optional; the first
    /turn message will also create the session if it doesn't exist. But this
    allows the LiveKit agent to pre-create the session before the first turn
    arrives, so that the first turn can be processed faster (no Redis roundtrip to create the session).
    
    Also validates the call token against the backend and returns store welcome info.
    call_id is used as the ai_call_token for validation.
    """
    print(f"\n[INCOMING INITIALIZE] {initialize.model_dump_json(indent=2)}\n")
    
    # Validate token and fetch welcome info from backend.
    # call_id is the ai_call_token.
    async with httpx.AsyncClient() as client:
        try:
            params = {"call_token": initialize.call_id}

            val_response = await client.get(
                "http://localhost:8000/validate-token",
                params=params,
            )
            if val_response.status_code != 200:
                logger.warning("validate_token_non_200", extra={"call_id": initialize.call_id, "status": val_response.status_code})
                return {"status": "unauthorized"}

            data = val_response.json()
            print(f"\n[VALIDATE TOKEN RESPONSE] {data}\n")
            if not data.get("valid"):
                logger.warning("validate_token_invalid", extra={"call_id": initialize.call_id, "error": data.get("error")})
                return {"status": "unauthorized"}

        except Exception as exc:
            logger.error("validate_token_failed", extra={"call_id": initialize.call_id, "error": str(exc)})
            return {"status": "unauthorized"}

    # Token is valid — create the session in Redis now.
    session_store = get_session_store()
    session = await session_store.get(initialize.call_id)
    if initialize.customer_id:
        session.customer_id = initialize.customer_id
    if hasattr(initialize, "store_name") and initialize.store_name:
        session.store_name = initialize.store_name
    if hasattr(initialize, "language") and initialize.language:
        session.default_language = initialize.language
        
    if getattr(initialize, "ai_id", None):
        async with httpx.AsyncClient() as client:
            try:
                cart_resp = await client.get(f"http://localhost:8000/cart/{initialize.ai_id}")
                if cart_resp.status_code == 200:
                    session.cart_data = cart_resp.json().get("cart_data", [])
                else:
                    logger.warning("failed_to_fetch_cart_on_init", extra={"ai_id": initialize.ai_id, "status": cart_resp.status_code})
                    session.cart_data = []
            except Exception as exc:
                logger.error("failed_to_fetch_cart_on_init", extra={"ai_id": initialize.ai_id, "error": str(exc)})
                session.cart_data = []
            
    await session_store.save(session)

    # Inject localized welcome message
    store_info = data.get("store") or {}
    lang = initialize.language or "en-IN"
    product_name = store_info.get("product_name")

    if product_name:
        template = PRODUCT_WELCOME_TEMPLATES.get(lang, PRODUCT_WELCOME_TEMPLATES["en-IN"])
        store_info["welcome_text"] = template.format(product_name=product_name)
    else:
        template = STORE_WELCOME_TEMPLATES.get(lang, STORE_WELCOME_TEMPLATES["en-IN"])
        store_info["welcome_text"] = template.format(store_name=store_info.get("store_name", "the store"))

    # Return all welcome info
    return {
        "status": "ok",
        **store_info,
    }



@app.websocket("/ws/{call_id}")
async def ws_turn(websocket: WebSocket, call_id: str):
    """
    Primary entrypoint. The LiveKit agent opens this once per room and
    sends JSON messages for questions.
    """
    await websocket.accept()
    session_store = get_session_store()
    logger.info("ws_connected", extra={"call_id": call_id})

    # Initialize the session
    session = await session_store.get(call_id)
    await session_store.save(session)

    current_task: asyncio.Task | None = None

    try:
        while True:
            raw = await websocket.receive_json()
            event = raw.get("event")

            # ── Cancel signal from LiveKit agent (user interrupted) ──────────
            if event == "cancel":
                if current_task and not current_task.done():
                    logger.info("turn_cancelled", extra={"call_id": call_id})
                    current_task.cancel()
                    try:
                        await current_task
                    except asyncio.CancelledError:
                        pass
                    current_task = None
                continue

            if event != "question":
                continue
                
            payload = raw.get("data", {})
            payload["call_id"] = call_id
            
            try:
                turn = TurnInput.model_validate(payload)
            except ValidationError as exc:
                await websocket.send_json({"error": "invalid_turn_payload", "detail": exc.errors()})
                continue

            # Validate turn against backend
            async with httpx.AsyncClient() as client:
                try:
                    val_response = await client.get(
                        "http://localhost:8000/validate_turn",
                        params={"ai_call_id": turn.call_id}
                    )
                    if val_response.status_code != 200:
                        logger.warning("validate_turn_non_200", extra={"call_id": turn.call_id, "status": val_response.status_code})
                        await websocket.send_json({"error": "unauthorized"})
                        continue

                    data = val_response.json()
                    if not data.get("valid"):
                        logger.warning("validate_turn_invalid", extra={"call_id": turn.call_id, "error": data.get("error")})
                        await websocket.send_json({"error": "unauthorized"})
                        continue
                        
                    turn.store_name = data.get("store_name", session.store_name)
                    #turn.store_name = "nesterstore"  # Hardcoded for now
                    logger.info(f"Store name resolved to: {turn.store_name}")
                except Exception as exc:
                    logger.error("validate_turn_failed", extra={"call_id": turn.call_id, "error": str(exc)})
                    await websocket.send_json({"error": "unauthorized"})
                    continue

            # ── Wrap process_turn in a task so cancel events can abort it ────
            async def _run_turn(t=turn):
                try:
                    await process_turn(t, session_store, websocket)
                except asyncio.CancelledError:
                    logger.info("turn_task_cancelled", extra={"call_id": call_id})
                    raise
                except Exception as exc:  # noqa: BLE001
                    logger.exception("turn_failed", extra={"call_id": call_id})
                    await websocket.send_json(
                        {
                            "message": "Sorry, I had trouble with that — could you say that again?",
                            "products": [],
                            "current_product_id": None,
                            "intent": "error_fallback",
                            "highlighted_feature": None,
                            "is_context_change": False,
                            "question_for_you": [],
                        }
                    )

            # Cancel any previous orphaned task before starting a new one.
            # This handles the race where Q2 arrives before a "cancel" event
            # for Q1 — without this, Q1 keeps running as a ghost in the background
            # and eventually sends stale chunks/final events over the socket.
            if current_task and not current_task.done():
                logger.info("turn_replaced_without_cancel", extra={"call_id": call_id})
                current_task.cancel()
                try:
                    await current_task
                except asyncio.CancelledError:
                    pass

            current_task = asyncio.create_task(_run_turn())

    except WebSocketDisconnect:
        logger.info("ws_disconnected", extra={"call_id": call_id})
        if current_task and not current_task.done():
            current_task.cancel()

