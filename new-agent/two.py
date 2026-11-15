import json
import os
import logging
import random
import uuid
import asyncio
import aiohttp
import asyncpg
import time
import datetime
import re
from dotenv import load_dotenv
from openai import AsyncOpenAI

from livekit import agents, rtc
from livekit.agents import (
    Agent,
    AgentSession,
    JobContext,
    JobProcess,
    APIConnectOptions,
)
from livekit.agents.llm import LLM, LLMStream, ChatContext, ChatChunk, ChoiceDelta, ChatMessage
from livekit.plugins import openai as lk_openai
from livekit.plugins import silero
from livekit.plugins import sarvam  # <-- official LiveKit Sarvam plugin (pip install "livekit-agents[sarvam]")

load_dotenv()

# Create a file handler to store all terminal logs in the workspace
file_handler = logging.FileHandler('agent_debug.log', encoding='utf-8', mode='a')
file_handler.setFormatter(logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s'))
logging.getLogger().addHandler(file_handler)

# Custom filters to isolate STT and TTS logs
class STTFilter(logging.Filter):
    def filter(self, record):
        name = record.name.lower()
        msg = str(record.msg).lower()
        # Catch STT plugins, transcript events, and STT metrics
        return "stt" in name or "stt" in msg or "transcript" in msg

class TTSFilter(logging.Filter):
    def filter(self, record):
        name = record.name.lower()
        msg = str(record.msg).lower()
        # Catch TTS plugins, Sarvam SpeechStream, and TTS metrics
        return "tts" in name or "tts" in msg or "speechstream" in name

class VADFilter(logging.Filter):
    def filter(self, record):
        name = record.name.lower()
        msg = str(record.msg).lower()
        # Catch Silero plugin and any message mentioning VAD
        return "vad" in name or "vad" in msg or "silero" in name

stt_handler = logging.FileHandler('stt_debug.log', encoding='utf-8', mode='a')
stt_handler.setFormatter(logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s'))
stt_handler.addFilter(STTFilter())
logging.getLogger().addHandler(stt_handler)

tts_handler = logging.FileHandler('tts_debug.log', encoding='utf-8', mode='a')
tts_handler.setFormatter(logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s'))
tts_handler.addFilter(TTSFilter())
logging.getLogger().addHandler(tts_handler)

vad_handler = logging.FileHandler('vad_debug.log', encoding='utf-8', mode='a')
vad_handler.setFormatter(logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s'))
vad_handler.addFilter(VADFilter())
logging.getLogger().addHandler(vad_handler)

logger = logging.getLogger("livekit-rag-agent")
logger.setLevel(logging.INFO)

INITIAL_FILLERS = {
    "en-IN_male": [
        "Hmm, let me check the details on that for you.",
        "Okay, just give me a moment while I pull up that information.",
        "Alright, I'm looking into that for you right now.",
        "Let me check that for you.",
        "Hold on a minute, I'm pulling up that info...",
        "Give me just a second to find that.",
        "I'm looking that up right now."
    ],
    "en-IN_female": [
        "Hmm, let me check the details on that for you.",
        "Okay, just give me a moment while I pull up that information.",
        "Alright, I'm looking into that for you right now.",
        "Let me check that for you.",
        "Hold on a minute, I'm pulling up that info...",
        "Give me just a second to find that.",
        "I'm looking that up right now."
    ],
    "hi-IN_male": [
        "मुझे आपके लिए इसकी जाँच करने दें।",
        "एक मिनट रुकिए, मैं वह जानकारी निकाल रहा हूँ...",
        "बस एक सेकंड दें, मैं देखता हूँ।",
        "मैं अभी इसकी जानकारी निकाल रहा हूँ।"
    ],
    "hi-IN_female": [
        "मुझे आपके लिए इसकी जाँच करने दें।",
        "एक मिनट रुकिए, मैं वह जानकारी निकाल रही हूँ...",
        "बस एक सेकंड दें, मैं देखती हूँ।",
        "मैं अभी इसकी जानकारी निकाल रही हूँ।"
    ],
    "bn-IN_male": [
        "আমাকে আপনার জন্য এটি পরীক্ষা করতে দিন।",
        "এক মিনিট অপেক্ষা করুন, আমি সেই তথ্যটি বের করছি...",
        "আমাকে একটু সময় দিন, আমি দেখছি।",
        "আমি এখনই এটি খুঁজে দেখছি।"
    ],
    "bn-IN_female": [
        "আমাকে আপনার জন্য এটি পরীক্ষা করতে দিন।",
        "এক মিনিট অপেক্ষা করুন, আমি সেই তথ্যটি বের করছি...",
        "আমাকে একটু সময় দিন, আমি দেখছি।",
        "আমি এখনই এটি খুঁজে দেখছি।"
    ],
    "kn-IN_male": [
        "ನಾನು ನಿಮಗಾಗಿ ಅದನ್ನು ಪರಿಶೀಲಿಸುತ್ತೇನೆ.",
        "ಒಂದು ನಿಮಿಷ ಕಾಯಿರಿ, ನಾನು ಆ ಮಾಹಿತಿಯನ್ನು ಹೊರತೆಗೆಯುತ್ತಿದ್ದೇನೆ...",
        "ಒಂದು ಕ್ಷಣ ಕೊಡಿ, ನಾನು ಹುಡುಕುತ್ತಿದ್ದೇನೆ.",
        "ನಾನು ಈಗಲೇ ಅದರ ಬಗ್ಗೆ ನೋಡುತ್ತಿದ್ದೇನೆ."
    ],
    "kn-IN_female": [
        "ನಾನು ನಿಮಗಾಗಿ ಅದನ್ನು ಪರಿಶೀಲಿಸುತ್ತೇನೆ.",
        "ಒಂದು ನಿಮಿಷ ಕಾಯಿರಿ, ನಾನು ಆ ಮಾಹಿತಿಯನ್ನು ಹೊರತೆಗೆಯುತ್ತಿದ್ದೇನೆ...",
        "ಒಂದು ಕ್ಷಣ ಕೊಡಿ, ನಾನು ಹುಡುಕುತ್ತಿದ್ದೇನೆ.",
        "ನಾನು ಈಗಲೇ ಅದರ ಬಗ್ಗೆ ನೋಡುತ್ತಿದ್ದೇನೆ."
    ],
    "ml-IN_male": [
        "ഞാൻ അതൊന്ന് പരിശോധിക്കട്ടെ.",
        "ഒരു നിമിഷം കാത്തിരിക്കൂ, ഞാൻ ആ വിവരങ്ങൾ എടുക്കാം...",
        "ഒരല്പ സമയം തരൂ, ഞാൻ നോക്കാം.",
        "ഞാൻ ഇപ്പോൾ തന്നെ അതൊന്ന് തിരയാം."
    ],
    "ml-IN_female": [
        "ഞാൻ അതൊന്ന് പരിശോധിക്കട്ടെ.",
        "ഒരു നിമിഷം കാത്തിരിക്കൂ, ഞാൻ ആ വിവരങ്ങൾ എടുക്കാം...",
        "ഒരല്പ സമയം തരൂ, ഞാൻ നോക്കാം.",
        "ഞാൻ ഇപ്പോൾ തന്നെ അതൊന്ന് തിരയാം."
    ],
    "mr-IN_male": [
        "थांबा, मी तुमच्यासाठी तपासतो.",
        "एक मिनिट थांबा, मी ती माहिती काढतोय...",
        "मला एक सेकंद द्या, मी शोधतो.",
        "मी आत्ताच ते पाहत आहे."
    ],
    "mr-IN_female": [
        "थांबा, मी तुमच्यासाठी तपासते.",
        "एक मिनिट थांबा, मी ती माहिती काढतेय...",
        "मला एक सेकंद द्या, मी शोधते.",
        "मी आत्ताच ते पाहत आहे."
    ],
    "or-IN_male": [
        "ମୁଁ ତୁମ ପାଇଁ ଯାଞ୍ଚ କରେ |",
        "ଟିକେ ଅପେକ୍ଷା କରନ୍ତୁ, ମୁଁ ସେହି ତଥ୍ୟ ବାହାର କରୁଛି...",
        "ମୋତେ ଗୋଟିଏ ସେକେଣ୍ଡ ଦିଅନ୍ତୁ, ମୁଁ ଖୋଜୁଛି |",
        "ମୁଁ ବର୍ତ୍ତମାନ ଏହାକୁ ଦେଖୁଛି |"
    ],
    "or-IN_female": [
        "ମୁଁ ତୁମ ପାଇଁ ଯାଞ୍ଚ କରେ |",
        "ଟିକେ ଅପେକ୍ଷା କରନ୍ତୁ, ମୁଁ ସେହି ତଥ୍ୟ ବାହାର କରୁଛି...",
        "ମୋତେ ଗୋଟିଏ ସେକେଣ୍ଡ ଦିଅନ୍ତୁ, ମୁଁ ଖୋଜୁଛି |",
        "ମୁଁ ବର୍ତ୍ତମାନ ଏହାକୁ ଦେଖୁଛି |"
    ],
    "pa-IN_male": [
        "ਰੁਕੋ, ਮੈਂ ਤੁਹਾਡੇ ਲਈ ਜਾਂਚ ਕਰਦਾ ਹਾਂ।",
        "ਇੱਕ ਮਿੰਟ ਉਡੀਕ ਕਰੋ, ਮੈਂ ਉਹ ਜਾਣਕਾਰੀ ਕੱਢ ਰਿਹਾ ਹਾਂ..."
    ],
    "pa-IN_female": [
        "ਰੁਕੋ, ਮੈਂ ਤੁਹਾਡੇ ਲਈ ਜਾਂਚ ਕਰਦੀ ਹਾਂ।",
        "ਇੱਕ ਮਿੰਟ ਉਡੀਕ ਕਰੋ, ਮੈਂ ਉਹ ਜਾਣਕਾਰੀ ਕੱਢ ਰਹੀ ਹਾਂ..."
    ],
    "ta-IN_male": [
        "நான் உங்களுக்குச் சரிபார்க்கிறேன்.",
        "ஒரு நிமிடம் காத்திருங்கள், நான் அந்தத் தகவலை எடுக்கிறேன்..."
    ],
    "ta-IN_female": [
        "நான் உங்களுக்குச் சரிபார்க்கிறேன்.",
        "ஒரு நிமிடம் காத்திருங்கள், நான் அந்தத் தகவலை எடுக்கிறேன்..."
    ],
    "te-IN_male": [
        "నేను మీ కోసం పరిశీలిస్తాను.",
        "ఒక నిమిషం ఆగండి, నేను ఆ సమాచారాన్ని తీసుకుంటున్నాను..."
    ],
    "te-IN_female": [
        "నేను మీ కోసం పరిశీలిస్తాను.",
        "ఒక నిమిషం ఆగండి, నేను ఆ సమాచారాన్ని తీసుకుంటున్నాను..."
    ],
    "gu-IN_male": [
        "ચાલો હું તમારા માટે તે તપાસું.",
        "એક મિનિટ રાહ જુઓ, હું તે માહિતી કાઢી રહ્યો છું..."
    ],
    "gu-IN_female": [
        "ચાલો હું તમારા માટે તે તપાસું.",
        "એક મિનિટ રાહ જુઓ, હું તે માહિતી કાઢી રહી છું..."
    ]
}

# DELAYED_FILLERS = {
#     "en-IN": "Ummmm, it is taking a bit longer to process, bear with me...",
#     "hi-IN": "उम, इसमें थोड़ा समय लग रहा है, कृपया प्रतीक्षा करें...",
#     "bn-IN": "উমম, একটু বেশি সময় লাগছে, দয়া করে অপেক্ষা করুন...",
#     "kn-IN": "ಉಮ್, ಇದು ಸ್ವಲ್ಪ ಸಮಯ ತೆಗೆದುಕೊಳ್ಳುತ್ತಿದೆ, ದಯವಿಟ್ಟು ಕಾಯಿರಿ...",
#     "ml-IN": "ഉം, ഇതിന് അല്പം സമയം എടുക്കുന്നു, ദയവായി കാത്തിരിക്കുക...",
#     "mr-IN": "उम्म, याला थोडा जास्त वेळ लागत आहे, कृपया प्रतीक्षा करा...",
#     "or-IN": "ଉମ୍, ଏହା ଟିକେ ଅଧିକ ସମୟ ନେଉଛି, ଦୟାକରି ଅପେକ୍ଷା କରନ୍ତୁ...",
#     "pa-IN": "ਉਮਮ, ਇਸ ਵਿੱਚ ਥੋੜ੍ਹਾ ਹੋਰ ਸਮਾਂ ਲੱਗ ਰਿਹਾ ਹੈ, ਕਿਰਪਾ ਕਰਕੇ ਉਡੀਕ ਕਰੋ...",
#     "ta-IN": "உம்ம், இது சிறிது நேரம் எடுக்கிறது, தயவுசெய்து காத்திருக்கவும்...",
#     "te-IN": "ఉమ్మ్, దీనికి కొంచెం సమయం పడుతుంది, దయచేసి వేచి ఉండండి...",
#     "gu-IN": "ઉમ્મ, આમાં થોડો વધુ સમય લાગી રહ્યો છે, કૃપા કરીને રાહ જુઓ..."
# }

# Standardized Silero VAD parameters across prewarm and fallback
DEFAULT_VAD_PARAMS = {
    "activation_threshold": 0.4,      # Balanced sensitivity to avoid noise triggers
    "min_speech_duration": 0.4,       # Filters short noise pops (Increased to 0.4 to prevent self-interruption)
    "min_silence_duration": 2.0,      # Prevents premature cuts mid-sentence
    "prefix_padding_duration": 0.5,   # Buffer to capture soft initial consonants
    "force_cpu": True,                # CPU optimized for cloud instances
}

# Sarvam TTS settings — pulled from env so you can swap voice/language without a redeploy
SARVAM_TTS_LANGUAGE_CODE = os.environ.get("SARVAM_TTS_LANGUAGE_CODE", "en-IN")  # English (Indian accent)
SARVAM_TTS_SPEAKER = os.environ.get("SARVAM_TTS_SPEAKER", "priya")  # priya works well for both en-IN and hi-IN

SARVAM_TTS_MODEL = os.environ.get("SARVAM_TTS_MODEL", "bulbul:v3")
_DEVANAGARI_RE = re.compile(r'[\u0900-\u097F]')

def detect_target_language_code(text: str) -> str:
    """Fallback language routing when no STT language signal is available:
    Devanagari script -> Hindi TTS, otherwise English. NOTE: faster-whisper
    sometimes transcribes spoken Hindi as Hinglish (Hindi words in Latin
    script), which this check can't catch on its own — see
    resolve_target_language_code below, which prefers the STT's own
    language-ID result over this text-based guess.
    """
    if not text:
        return SARVAM_TTS_LANGUAGE_CODE
    if _DEVANAGARI_RE.search(text):
        return "hi-IN"
    return "en-IN"


def normalize_lang_code(raw: str | None) -> str | None:
    """Map whatever Whisper/livekit reports (e.g. 'hi', 'hi-IN', 'en') to a
    Sarvam target_language_code. Returns None if unrecognized."""
    if not raw:
        return None
    raw = str(raw).lower()
    if raw.startswith("hi"):
        return "hi-IN"
    if raw.startswith("en"):
        return "en-IN"
    return None


def resolve_target_language_code(my_agent, spoken_or_answer_text: str) -> str:
    """Primary signal: language Whisper itself detected for the last user
    utterance (my_agent.stt_detected_language), set via the session's
    user_input_transcribed event. Falls back to script-detection on the
    given text if that signal isn't available yet."""
    normalized = normalize_lang_code(getattr(my_agent, "stt_detected_language", None))
    if normalized:
        return normalized
    return detect_target_language_code(spoken_or_answer_text)


# ─────────────────────────────────────────────
# Structured Agent — processes user questions via
# the RAG endpoint and publishes answers and
# products via data stream
# ─────────────────────────────────────────────
class StructuredAgent(Agent):
    def __init__(self, room: rtc.Room, http_session: aiohttp.ClientSession):
        self._room = room
        self._http_session = http_session
        self.session_id = room.name
        # Set from the frontend via the "credential" data topic.
        self.ai_access_token: str | None = None
        self.product_id: str | None = None
        # Set from the frontend via the "config" data topic.
        self.ai_id: int | None = None
        self.seller_id: int | None = None
        self.shop_name: str | None = None
        self._current_task: asyncio.Task | None = None
        self._custom_session = None
        self._last_user_question: str = ""

        self.stt_detected_language: str | None = None
        # Set after /initialize succeeds
        self.is_validated: bool = False
        self.store_info: dict = {}
        self.welcome_text: str | None = None
        # Incremented on every turn so the backend can track conversation order
        self.turn_number: int = 0
        self._generation: int = 0

        self.interrupted: bool = False
        self._accepting_turn_events: bool = False  # guards ws_loop against stale events after interrupt
        self.mic_muted: bool = False  # True when user has muted their mic via the frontend
        self.tts_status: bool = True  # True if agent is allowed to speak
        super().__init__(
            instructions="You are a warm, helpful voice assistant."
        )

    def interrupt(self) -> bool:
        """Cancels any ongoing RAG query or response processing cleanly.
        Returns True if the agent was actively processing or speaking, False otherwise."""
        logger.info(f"[{time.time()}] agent.interrupt() called")
        
        was_active = False
        if hasattr(self, "_current_task") and self._current_task and not self._current_task.done():
            was_active = True
        if hasattr(self, "_current_stream") and self._current_stream is not None:
            was_active = True
        # Also check if LiveKit's internal state is active (speaking/thinking)
        if hasattr(self, "_custom_session") and self._custom_session:
            # Using strings since AgentState might not be directly imported here
            state = str(getattr(self._custom_session, "_state", ""))
            if "SPEAKING" in state or "THINKING" in state:
                was_active = True
        
        self._generation += 1
        self._accepting_turn_events = False
        self._voice_filler_playing = False

        if getattr(self, "_filler_task", None) and not self._filler_task.done():
            self._filler_task.cancel()
            logger.info("[interrupt] Cancelled background filler task")

        if hasattr(self, "_turn_future") and self._turn_future and not self._turn_future.done():
            logger.info(f"[{time.time()}] self._turn_future.cancel() called")
            self._turn_future.cancel()

        # Fire a cancel signal to the backend FIRST so LangGraph can abort
        # its running graph (LLM call etc.) before we cancel our local task.
        if hasattr(self, "ws") and self.ws and not self.ws.closed:
            async def _send_cancel():
                try:
                    await self.ws.send_json({"event": "cancel", "generation": self._generation})
                    logger.info("[interrupt] Sent cancel signal to backend.")
                except Exception as e:
                    logger.warning(f"[interrupt] Failed to send cancel signal: {e}")
            asyncio.create_task(_send_cancel())

        # Stop accepting events from ws_loop immediately — this discards any
        # in-flight chunks or final events that arrive after the interrupt.


        # THEN stop TTS playback via AgentSession to ensure the flushed text is cleared
        if was_active and hasattr(self, "_custom_session") and self._custom_session and hasattr(self._custom_session, "interrupt"):
            try:
                self._custom_session.interrupt()
                logger.info("[interrupt] Forced TTS engine to stop speaking")
            except Exception as e:
                logger.error(f"[interrupt] Failed to interrupt TTS: {e}")

        if hasattr(self, "_current_stream") and self._current_stream is not None:
            stream_to_close = self._current_stream
            self._current_stream = None
            
            # 1. Drain the buffer to completely eliminate race conditions
            if hasattr(stream_to_close, "_event_ch"):
                while True:
                    try:
                        stream_to_close._event_ch.recv_nowait()
                    except Exception:
                        break  # Breaks out of the loop when the queue is completely empty
            
            # 2. Safely close the async generator in the background
            async def _close_stream(s):
                try:
                    if hasattr(s, "aclose"):
                        await s.aclose()
                except Exception as e:
                    logger.debug(f"[interrupt] Error closing stream: {e}")
            
            asyncio.create_task(_close_stream(stream_to_close))

        # We intentionally do NOT cancel self._current_task manually!
        # _current_task is the LiveKit internal task running AgentSession's LLM iteration.
        # Forcefully cancelling it rips the task out of LiveKit's event loop and breaks
        # its internal state machine, causing TTS silence on the next turn.
        # Cancelling _turn_future (done above) is enough to cleanly exit _run().
        # Signal frontend UI to stop any typing animations and clear the screen
        if hasattr(self, "_room") and self._room:
            async def _send_ui_interrupt():
                try:
                    interrupt_payload = json.dumps({"status": "interrupted", "message": "User interrupted", "turn_number": self.turn_number}).encode("utf-8")
                    await self._room.local_participant.publish_data(
                        interrupt_payload,
                        reliable=True,
                        topic="interrupted"
                    )
                    await self._room.local_participant.publish_data(
                        interrupt_payload,
                        reliable=True,
                        topic="agent-ui"
                    )
                    logger.info("[interrupt] Sent interrupt signal to frontend UI")
                except Exception as e:
                    logger.error(f"[interrupt] Failed to send interrupt to frontend: {e}")
            asyncio.create_task(_send_ui_interrupt())
            self._current_task = None
            self.interrupted = True

        return was_active


    # STEP 7: process_question() has been deleted.
    # Its logic now lives in send_question_to_backend() (a standalone module-level
    # async function) which fires the WS send immediately — before generate_reply()
    # is called — so the filler never blocks the backend from receiving the question.


# ─────────────────────────────────────────────
# Prewarm — runs once per worker process
# ─────────────────────────────────────────────
def prewarm(proc: JobProcess):
    logger.info("Prewarming worker process: Loading Silero VAD model into memory...")
    proc.userdata["vad"] = silero.VAD.load(**DEFAULT_VAD_PARAMS)


class RAGLLMStream(LLMStream):
    def __init__(self, rag_llm, my_agent, text, chat_ctx):
        super().__init__(llm=rag_llm, chat_ctx=chat_ctx, conn_options=APIConnectOptions(), tools=[])
        self.my_agent = my_agent
        self.text = text
        self._id = str(uuid.uuid4())
        # STEP 5: record when __init__ ran so we can compare with _run_start_time
        self.my_agent._stream_init_time = time.time()
        logger.info(f"[RAGLLMStream] __init__ ran at {self.my_agent._stream_init_time:.3f} for: {text!r}")
        self.my_agent._current_stream = self
        
        # Reset flag for the next turn
        self.my_agent._voice_filler_played = False
                
        # STEP 5: flush any early chunks that arrived before _current_stream was set
        pending = getattr(self.my_agent, "_pending_chunks", [])
        if pending:
            logger.info(f"[RAGLLMStream] Flushing {len(pending)} early chunk(s) into _event_ch")
            for _chunk in pending:
                try:
                    self._event_ch.send_nowait(_chunk)
                except Exception as _e:
                    logger.debug(f"[RAGLLMStream] Error flushing pending chunk: {_e}")
            self.my_agent._pending_chunks = []

    async def _run(self) -> None:
        # STEP 5: record when _run() actually got the speech slot from AgentSession
        self.my_agent._run_start_time = time.time()
        logger.info(
            f"[RAGLLMStream] _run() started at {self.my_agent._run_start_time:.3f} "
            f"(init was at {getattr(self.my_agent, '_stream_init_time', '?'):.3f}) "
            f"for: {self.text!r}"
        )

        # ── Guards (mic muted / hallucination filter) ─────────────────────────
        # If this is an explicitly typed text query (_is_text_turn), we ALWAYS
        # process it, regardless of whether the user's mic is muted or if the
        # text happens to match a hallucination keyword.
        is_text = getattr(self.my_agent, "_is_text_turn", False)
        skip_filter = getattr(self.my_agent, "_skip_hallucination_filter", False) or is_text
        if hasattr(self.my_agent, "_skip_hallucination_filter"):
            self.my_agent._skip_hallucination_filter = False  # one-shot flag — consume immediately


        # ── Language resolution (one-shot per turn) ────────────────────────────
        try:
            stt_lang = resolve_target_language_code(self.my_agent, self.text)
            self.my_agent._stt_lang = stt_lang
            self.my_agent._tts_lang_switched = False
            logger.info(f"[tts] Computed STT lang for RAG answer: {stt_lang} (will apply on first chunk)")
        except Exception as e:
            logger.error(f"[tts] answer language resolution failed: {e}")

        # ── STEP 4: Wait for the backend answer (TTS is fed by ws_loop chunks) ──
        # ws_loop pushes each streaming chunk into _event_ch as it arrives.
        # _run() just waits here until the turn is done (_turn_future is resolved
        # by ws_loop on the final event), then closes _event_ch to signal TTS "done".
        # DO NOT push the full answer here — ws_loop already sent it chunk by chunk.
        # Pushing it again causes TTS to speak the answer twice and the second copy
        # survives interruption, playing at the start of the next turn.
        turn_future = getattr(self.my_agent, "_turn_future", None)

        # Guard: if the future is already DONE it's stale (left over from the previous
        # turn). _run() must NOT consume it — that would cause it to return immediately,
        # close _event_ch, and then drop all incoming chunks with ChanClosed once
        # conversation_item_added creates the real future and chunks start arriving.
        if turn_future is not None and turn_future.done():
            logger.info(
                "[RAGLLMStream] _turn_future is already DONE (stale from previous turn). "
                "Waiting for conversation_item_added to create a fresh one..."
            )
            turn_future = None

        if turn_future is None:
            logger.info("[RAGLLMStream] _turn_future is None, waiting for send_question_to_backend to fire...")
            for _ in range(40): # Wait up to 2 seconds
                await asyncio.sleep(0.05)
                turn_future = getattr(self.my_agent, "_turn_future", None)
                # Only accept a future that is NOT done (i.e., freshly created)
                if turn_future is not None and not turn_future.done():
                    break
                turn_future = None
                    
        if turn_future is None:
            logger.error("[RAGLLMStream] _turn_future is STILL None after waiting! Aborting turn.")
            return

        logger.info(f"[RAGLLMStream] Got fresh _turn_future, now awaiting backend answer...")
        self.my_agent._current_task = asyncio.current_task()
        try:
            answer = await turn_future
            self.my_agent._accepting_turn_events = False
            logger.info(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] RAG turn complete, answer len={len(answer)}")
            # If chunks were buffered while the filler was finishing, wait for
            # flush_after_filler to drain the buffer before we close _event_ch.
            # Without this wait, _event_ch closes before the flush runs → ChanClosed.
            is_flushing = getattr(self.my_agent, "_flushing_buffer", False)
            buffered_count = len(getattr(self.my_agent, "_chunk_buffer", []))
            if is_flushing or buffered_count > 0:
                logger.info(f"[RAGLLMStream] Waiting for flush_after_filler to drain {buffered_count} chunks before closing _event_ch...")
            
            for _ in range(60):  # wait up to 6 seconds
                if not getattr(self.my_agent, "_flushing_buffer", False) and not getattr(self.my_agent, "_chunk_buffer", []):
                    if is_flushing or buffered_count > 0:
                        logger.info("[RAGLLMStream] Buffer is now clear, proceeding to close _event_ch.")
                    break
                await asyncio.sleep(0.1)
            else:
                logger.warning("[RAGLLMStream] Timed out waiting for buffer flush after 6 seconds!")
        except asyncio.CancelledError:
            logger.info(f"[RAGLLMStream] _run cancelled for: {self.text}")
            return
        finally:
            self.my_agent._current_task = None
            # Close _event_ch so LiveKit TTS knows this stream is done
            try:
                if hasattr(self, "_event_ch"):
                    self._event_ch.close()
                    logger.debug("[RAGLLMStream] Closed _event_ch.")
            except Exception as e:
                logger.debug(f"[RAGLLMStream] Error closing _event_ch: {e}")



class RAGLLM(LLM):
    def __init__(self, my_agent):
        super().__init__()
        self.my_agent = my_agent

    def chat(self, chat_ctx: ChatContext, fnc_ctx=None, **kwargs) -> LLMStream:
        text = ""
        messages = chat_ctx.messages() if callable(chat_ctx.messages) else chat_ctx.messages
        if messages:
            last_msg = messages[-1]
            logger.info(f"RAGLLM.chat called with last_msg role={last_msg.role} content={last_msg.content}")
            if last_msg.role == "user":
                content = last_msg.content
                if isinstance(content, list):
                    text = "".join(str(c) for c in content)
                else:
                    text = str(content)
        else:
            logger.info("RAGLLM.chat called with empty chat_ctx.messages")

        # Store the actual STT transcript so conversation_item_added can reference it
        if text:
            self.my_agent._last_user_question = text
            logger.info(f"Stored last user question: {text}")

        logger.info(f"Creating RAGLLMStream with text: {text}")
        return RAGLLMStream(self, self.my_agent, text, chat_ctx)
# ─────────────────────────────────────────────
# STEP 1: Standalone WS sender — fires immediately when we have the question,
# independent of whether AgentSession has granted the speech slot to _run() yet.
# This breaks the filler→backend→filler circular deadlock.
# ─────────────────────────────────────────────
async def send_question_to_backend(my_agent, question: str):
    """Send the user question to the backend WS immediately.
    Sets _turn_future and _accepting_turn_events so ws_loop can route
    chunks/final events into the LLM stream as soon as they arrive,
    regardless of whether _run() has been scheduled by AgentSession yet."""
    if not question:
        question = "Hello"

    logger.info(f"[send_q] send_question_to_backend() called for: {question!r}")

    my_agent.turn_number += 1
    logger.info(f"[send_q] turn #{my_agent.turn_number} — session_id={my_agent.session_id}")

    v_gender = getattr(my_agent, "voice_gender", None)

    payload = {
        "call_id":                   getattr(my_agent, "ai_call_token", getattr(my_agent, "session_id", None)),
        "customer_id":               None,
        "transcript":                question,
        "turn_number":               my_agent.turn_number,
        "selected_product_id":       None if my_agent.product_id in (None, "", "null") else my_agent.product_id,
        "selected_feature_code":     None,
        "interrupted_previous_turn": my_agent.interrupted,
        "store_name":                my_agent.store_info.get("store_name", ""),
        "voice_name":                v_gender,
    }
    ws_payload = {"event": "question", "data": payload}
    logger.info(f"[send_q] Outgoing payload: {payload}")

    # Create the future BEFORE sending so ws_loop can resolve it the instant
    # the final event arrives. (For voice queries, it's pre-set in conversation_item_added).
    old_fut = getattr(my_agent, "_turn_future", None)
    if old_fut and not old_fut.done():
        old_fut.cancel()
    my_agent._turn_future = asyncio.Future()
    my_agent._accepting_turn_events = True
    my_agent._pending_chunks = []
    # Clear the filler chunk buffer so a stale flush_after_filler task from the
    # previous turn doesn't inject old content into this new turn's TTS stream.
    my_agent._chunk_buffer = []
    my_agent._flushing_buffer = False
    
    # Do not wipe the spoken text completely, otherwise trailing echoes from the 
    # previous turn will have a 0% overlap and instantly kill the new text turn!
    # Trim to last 50 words to maintain context for the echo filter.
    if hasattr(my_agent, "_agent_spoken_text") and my_agent._agent_spoken_text:
        words = my_agent._agent_spoken_text.split()
        my_agent._agent_spoken_text = " ".join(words[-50:])
    else:
        my_agent._agent_spoken_text = ""

    if my_agent.interrupted:
        my_agent.interrupted = False

    success = False
    backoff_delays = [1, 2, 3]  # Exponential backoff: 1s, 2s, 3s
    for attempt in range(3):
        wait_time = backoff_delays[attempt]

        if not (hasattr(my_agent, "ws") and my_agent.ws and not my_agent.ws.closed):
            logger.warning(f"[send_q] WS closed. Waiting {wait_time}s for reconnect (Attempt {attempt + 1}/3)...")
            await asyncio.sleep(wait_time)
            continue

        try:
            await my_agent.ws.send_json(ws_payload)
            logger.info(f"[send_q] Question sent to backend WS at {time.time():.3f}")
            success = True
            break
        except Exception as e:
            logger.error(f"[send_q] Failed to send question (Attempt {attempt + 1}/3): {e}")
            if attempt < 2:
                logger.info(f"[send_q] Retrying in {wait_time}s...")
                await asyncio.sleep(wait_time)

    # Last-chance attempt: if all 3 tries failed, wait a final 5 seconds and try one last time
    # This gives ws_loop extra time to fully reconnect if the backend was slow to restart.
    if not success:
        logger.warning("[send_q] All 3 attempts failed. Waiting 5s for a final last-chance attempt...")
        await asyncio.sleep(5)
        if hasattr(my_agent, "ws") and my_agent.ws and not my_agent.ws.closed:
            try:
                await my_agent.ws.send_json(ws_payload)
                logger.info(f"[send_q] Last-chance attempt succeeded! Question sent at {time.time():.3f}")
                success = True
            except Exception as e:
                logger.error(f"[send_q] Last-chance attempt also failed: {e}")

    if success:
        # Publish updated thinking state ONLY after successful send!
        if hasattr(my_agent, "_room") and my_agent._room:
            try:
                asyncio.create_task(
                    my_agent._room.local_participant.publish_data(
                        json.dumps({"status": "thinking", "question": question, "filler": ""}).encode("utf-8"),
                        reliable=True,
                        topic="agent-ui"
                    )
                )
                logger.info(f"[send_q] Published updated 'thinking' UI state for: {question!r}")
            except Exception as e:
                logger.error(f"[send_q] Failed to publish UI state: {e}")
    else:
        logger.error("[send_q] Failed to send question after all attempts. Giving up.")
        my_agent._accepting_turn_events = False
        if not my_agent._turn_future.done():
            my_agent._turn_future.cancel()

        # Stop the filler loop if it is running
        if hasattr(my_agent, "_filler_task") and my_agent._filler_task and not my_agent._filler_task.done():
            my_agent._filler_task.cancel()

        # Send error to UI
        if hasattr(my_agent, "_room") and my_agent._room:
            try:
                asyncio.create_task(
                    my_agent._room.local_participant.publish_data(
                        json.dumps({"status": "error", "message": "Connection lost, please try again."}).encode("utf-8"),
                        reliable=True,
                        topic="agent-ui"
                    )
                )
            except Exception:
                pass




# ─────────────────────────────────────────────
# Entrypoint — runs fresh for every job
# ─────────────────────────────────────────────
async def entrypoint(ctx: JobContext):
    ctx.log_context_fields = {"room": ctx.room.name}

    metadata = json.loads(ctx.job.metadata) if ctx.job.metadata else {}
    logger.info(f"dispatched with metadata: {metadata}")

    http_session = aiohttp.ClientSession()

    # Use prewarmed VAD instance or load optimized fallback with standard settings
    vad_plugin = ctx.proc.userdata.get("vad") or silero.VAD.load(**DEFAULT_VAD_PARAMS)

    my_agent = StructuredAgent(room=ctx.room, http_session=http_session)

    raw_stt = sarvam.STT(
        model="saaras:v3",
        mode="codemix",
        language="unknown"
    )
    # Pass raw_stt directly. Do not wrap it. LiveKit will natively handle
    # STT/VAD integration without self-interrupting via echo.
    # The START_OF_SPEECH monkey-patch was removed because Sarvam STT fires
    # this event on minor background noise AND on the agent's own TTS audio
    # (echo), causing the agent to instantly mute itself before a single
    # syllable could be heard. LiveKit's built-in agent_speech_interrupted
    # event handles true user interruptions with proper echo cancellation.

    session = AgentSession(
        llm=RAGLLM(my_agent),
        vad=vad_plugin,  # Re-enabled: prevents sentence fragmentation from micro-pauses
        stt=raw_stt,
        # Sarvam Bulbul v3 TTS via the official LiveKit plugin — reads SARVAM_API_KEY
        # from the environment automatically, no manual HTTP wiring needed.
        tts=sarvam.TTS(
            target_language_code=SARVAM_TTS_LANGUAGE_CODE,
            model=SARVAM_TTS_MODEL,
            speaker=SARVAM_TTS_SPEAKER,
            pace=1.0
        ),
        userdata={"http_session": http_session},
    )
    my_agent._custom_session = session
    
    # NEW: Isolate the filler TTS instance so it doesn't conflict with main session TTS
    my_agent.filler_tts = sarvam.TTS(
        target_language_code=SARVAM_TTS_LANGUAGE_CODE,
        model=SARVAM_TTS_MODEL,
        speaker=SARVAM_TTS_SPEAKER,
        pace=1.0
    )
    logger.info(f"[init] Created isolated filler_tts instance: {my_agent.filler_tts}")

    # ── Create Background Audio Track for Fillers ─────────────────────────
    # Sarvam TTS outputs 22050 Hz mono audio. The AudioSource sample_rate and
    # num_channels MUST match the TTS output exactly or we get an InvalidState error.
    filler_audio_source = rtc.AudioSource(22050, 1)
    filler_audio_track = rtc.LocalAudioTrack.create_audio_track("agent_filler_track", filler_audio_source)
    filler_publish_options = rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
    my_agent.filler_audio_source = filler_audio_source
    my_agent._filler_task = None
    
    def reset_inactivity_timer():
        my_agent.last_user_activity_time = time.time()
        my_agent.inactivity_step = 0

    reset_inactivity_timer()
    my_agent.idle_task_cancelled = False

    async def inactivity_watcher():
        while not getattr(my_agent, "idle_task_cancelled", False):
            await asyncio.sleep(1)
            
            # If the agent is actively talking or processing, pause/reset the timer!
            state = str(getattr(my_agent._custom_session, "agent_state", getattr(my_agent._custom_session, "_state", "")))
            is_processing = (getattr(my_agent, "_current_task", None) is not None and not my_agent._current_task.done())
            
            if "SPEAKING" in state or "THINKING" in state or is_processing:
                reset_inactivity_timer()
                continue
                
            elapsed = time.time() - getattr(my_agent, "last_user_activity_time", time.time())
            step = getattr(my_agent, "inactivity_step", 0)
            
            if step == 0 and elapsed >= 60:
                my_agent.inactivity_step = 1
                
                tts_lang = "en-IN"
                try:
                    tts_instance = getattr(my_agent._custom_session, "tts", None)
                    if tts_instance is not None:
                        tts_lang = getattr(tts_instance, "language", None) \
                                   or getattr(getattr(tts_instance, "_opts", None), "target_language_code", "en-IN")
                except Exception as e:
                    logger.error(f"[idle] Failed to read TTS language: {e}")
                    
                if tts_lang == "hi-IN":
                    prompt = "नमस्ते, मैं यहीं हूँ। क्या आप कुछ पूछना चाहते हैं?"
                else:
                    prompt = "Hi, I'm still here whenever you're ready. Do you have a question I can help you with?"
                    
                logger.info(f"[idle] 60s silence reached: {prompt}")
                if hasattr(my_agent._custom_session, "say"):
                    my_agent._custom_session.say(prompt, add_to_chat_ctx=False)
                    if not hasattr(my_agent, "_agent_spoken_text"):
                        my_agent._agent_spoken_text = ""
                    my_agent._agent_spoken_text += " " + prompt
                
                # Push the idle message to the frontend UI
                asyncio.create_task(
                    ctx.room.local_participant.publish_data(
                        json.dumps({"status": "success", "question": "", "answer": prompt}).encode("utf-8"),
                        reliable=True,
                        topic="agent-ui"
                    )
                )
                
            elif step == 1 and elapsed >= 120:
                my_agent.inactivity_step = 2
                
                tts_lang = "en-IN"
                try:
                    tts_instance = getattr(my_agent._custom_session, "tts", None)
                    if tts_instance is not None:
                        tts_lang = getattr(tts_instance, "language", None) \
                                   or getattr(getattr(tts_instance, "_opts", None), "target_language_code", "en-IN")
                except Exception as e:
                    logger.error(f"[idle] Failed to read TTS language: {e}")
                    
                if tts_lang == "hi-IN":
                    prompt = "ऐसा लगता है अभी कोई नहीं है, इसलिए मैं कॉल समाप्त कर रहा हूँ। कभी भी दोबारा संपर्क करें। नमस्ते!"
                else:
                    prompt = "It looks like no one's here right now, so I'll end the call. Feel free to reach out again anytime. Goodbye!"
                    
                logger.info(f"[idle] 120s silence reached: {prompt}")
                if hasattr(my_agent._custom_session, "say"):
                    my_agent._custom_session.say(prompt, add_to_chat_ctx=False)
                    if not hasattr(my_agent, "_agent_spoken_text"):
                        my_agent._agent_spoken_text = ""
                    my_agent._agent_spoken_text += " " + prompt
                
                asyncio.create_task(
                    ctx.room.local_participant.publish_data(
                        json.dumps({"status": "success", "question": "", "answer": prompt}).encode("utf-8"),
                        reliable=True,
                        topic="agent-ui"
                    )
                )
                
                # Allow 8 seconds for the goodbye message to finish playing before dropping the call
                await asyncio.sleep(8)
                
                # Send end_call event to the frontend via data channel
                try:
                    await ctx.room.local_participant.publish_data(
                        json.dumps({"event": "end_call"}).encode("utf-8"),
                        reliable=True,
                        topic="end_call"
                    )
                    logger.info("[idle] Sent end_call event to frontend via data channel.")
                except Exception as e:
                    logger.error(f"[idle] Failed to send end_call event: {e}")

                await ctx.room.disconnect()
                break

    async def send_welcome_message(identity: str):
        welcome_text = "Hi, How are you, I am your AI assistant. I will help you with products and their features. Feel free to ask anything"
        data_payload = json.dumps({
            "status": "success",
            "question": "",
            "answer": welcome_text,
            "products": [],
            "annotation": None
        })
        try:
            await ctx.room.local_participant.publish_data(
                data_payload.encode("utf-8"),
                reliable=True,
                topic="agent-ui",
            )
            logger.info(f"Sent welcome message to {identity}")
            if hasattr(session, 'say'):
                session.say(welcome_text, add_to_chat_ctx=False)
        except Exception as e:
            logger.error(f"Failed to send welcome message to {identity}: {e}")

    @ctx.room.on("participant_connected")
    def on_participant_connected(participant):
        logger.info(f"Participant connected: {participant.identity}")

        # Ignore the agent's own local participant re-connecting
        if participant.identity == ctx.room.local_participant.identity:
            return

        # Start the inactivity timer loop exactly once
        if not getattr(my_agent, "_watcher_started", False):
            my_agent._watcher_started = True
            asyncio.create_task(inactivity_watcher())

        # Only initialize once — reconnects / extra track events must not re-trigger welcome
        if getattr(my_agent, "_initialize_started", False) or getattr(my_agent, "is_validated", False):
            logger.info(f"[initialize] Already validated or starting, skipping re-init for {participant.identity}")
            return
            
        my_agent._initialize_started = True

        asyncio.create_task(_initialize_session(participant.identity))

    async def _initialize_session(identity: str):
        """Called on participant_connected. Immediately calls /initialize to
        validate the user and fetch the welcome payload. No token required."""

        # Hard guard: if another task already completed validation while this one
        # was waiting for tokens, bail out immediately so welcome is spoken only once.
        if getattr(my_agent, "is_validated", False):
            logger.info(f"[initialize] Already validated inside task, aborting for {identity}")
            return

        # Wait until the frontend sends the ai_call_token, language, and ai_id via data channels
        while not getattr(my_agent, "ai_call_token", None) or not getattr(my_agent, "default_language", None) or not getattr(my_agent, "ai_id", None):
            await asyncio.sleep(0.5)

        # Re-check after the wait — another task may have finished while we slept
        if getattr(my_agent, "is_validated", False):
            logger.info(f"[initialize] Validated while waiting for tokens, aborting for {identity}")
            return

        try:
            async with http_session.post(
                "http://localhost:8001/initialize",
                json={
                    "call_id": my_agent.ai_call_token,
                    "language": my_agent.default_language,
                    "ai_id": my_agent.ai_id
                }
            ) as resp:
                data = await resp.json()
                logger.info(f"[initialize] response: {data}")

                if data.get("status") != "ok":
                    logger.warning(
                        f"[initialize] validation failed for {identity}: {data}"
                    )
                    return

                # Store values on the agent
                my_agent.is_validated  = True
                my_agent.store_info    = data
                my_agent.welcome_text  = data.get("welcome_text")

                logger.info(
                    f"[initialize] OK — store keys={list(my_agent.store_info.keys())}"
                )

                # 1. Publish all store info (except welcome_text) to the frontend via 'welcome' channel
                try:
                    payload_to_send = dict(my_agent.store_info)
                    payload_to_send.pop("status", None) # Clean up internal status flag

                    await ctx.room.local_participant.publish_data(
                        json.dumps(payload_to_send).encode("utf-8"),
                        reliable=True,
                        topic="welcome",
                    )
                    logger.info(f"[initialize] Sent welcome store_info to frontend")
                except Exception as e:
                    logger.error(f"[initialize] Failed to publish welcome info: {e}")

                # 2. Speak the welcome text via TTS
                if my_agent.welcome_text and my_agent._custom_session and hasattr(my_agent._custom_session, 'say'):
                    try:
                        # Wait a tiny bit to ensure the voice-name data packet from the frontend arrived
                        await asyncio.sleep(0.5)

                        # Update TTS options for the welcome message (voice and language)
                        if hasattr(my_agent._custom_session, "tts") and my_agent._custom_session.tts:
                            tts_opts = {}
                            if getattr(my_agent, "voice_name", None):
                                tts_opts["speaker"] = my_agent.voice_name
                            if getattr(my_agent, "default_language", None):
                                tts_opts["target_language_code"] = my_agent.default_language
                            
                            if tts_opts:
                                my_agent._custom_session.tts.update_options(**tts_opts)
                                logger.info(f"[initialize] Switched welcome message TTS options: {tts_opts}")

                        my_agent._custom_session.say(my_agent.welcome_text, add_to_chat_ctx=False)
                        logger.info(f"[initialize] TTS welcome_text: {my_agent.welcome_text}")
                    except Exception as e:
                        logger.error(f"[initialize] Failed to TTS welcome_text: {e}")

        except Exception as e:
            logger.error(f"[initialize] Error for {identity}: {e}")

    @ctx.room.on("participant_disconnected")
    def on_participant_disconnected(participant):
        logger.info(f"Participant disconnected: {participant.identity}")
        
        # Stop the inactivity timer
        my_agent.idle_task_cancelled = True
        
        async def _cleanup_and_disconnect():
            # Prevent Zombie WebSockets! Close the connection when the user leaves.
            if hasattr(my_agent, "ws") and my_agent.ws and not my_agent.ws.closed:
                try:
                    await my_agent.ws.close()
                    logger.info(f"[cleanup] Successfully closed backend WebSocket for {participant.identity}")
                except Exception as e:
                    logger.error(f"[cleanup] Error closing WebSocket: {e}")
            
            # Forcefully disconnect the agent from the room
            try:
                await ctx.room.disconnect()
                logger.info(f"[cleanup] Agent manually disconnected from room after participant left")
            except Exception as e:
                logger.error(f"[cleanup] Error disconnecting agent: {e}")
                
        asyncio.create_task(_cleanup_and_disconnect())

    @ctx.room.on("track_published")
    def on_track_published(publication, participant):
        logger.info(f"Track published: {publication.sid} from {participant.identity}")

    @ctx.room.on("track_unpublished")
    def on_track_unpublished(publication, participant):
        logger.info(f"Track unpublished: {publication.sid} from {participant.identity}")

    @ctx.room.on("track_subscribed")
    def on_track_subscribed(track, publication, participant):
        logger.info(f"Subscribed to track {track.name} from {participant.identity}")

    @ctx.room.on("track_unsubscribed")
    def on_track_unsubscribed(track, publication, participant):
        logger.info(f"Unsubscribed from track {track.name} from {participant.identity}")

    # ── Layer 1: Mute guards ──────────────────────────────────────────────────
    @ctx.room.on("track_muted")
    def on_track_muted(participant, publication):
        if participant.identity == ctx.room.local_participant.identity:
            return
        my_agent.mic_muted = True
        logger.info(f"[mute] User muted mic → mic_muted=True ({participant.identity})")
      
    @ctx.room.on("track_unmuted")
    def on_track_unmuted(participant, publication):
        if participant.identity == ctx.room.local_participant.identity:
            return
        my_agent.mic_muted = False
        logger.info(f"[mute] User unmuted mic → mic_muted=False ({participant.identity})")




    @session.on("user_started_speaking")
    def on_user_started_speaking():
        reset_inactivity_timer()
        logger.info("[VAD] User started speaking.")

        # We DO NOT call my_agent.interrupt() here!
        # If the user is just breathing or making background noise while the
        # backend is computing a RAG answer, we must NOT cancel _turn_future.
        # LiveKit's agent_speech_interrupted event (below) handles true
        # interruptions safely, with proper AEC so agent TTS echo is ignored.
            



    @session.on("agent_speech_interrupted")
    def on_agent_speech_interrupted(msg):
        if getattr(my_agent, "_is_text_turn", False):
            logger.info("[VAD] Ignoring agent_speech_interrupted because this is a text turn (preventing echo/keyboard noise from killing TTS)")
            return
            
        # --- NEW CODE: Grace Period for Echo Cancellation ---
        run_start = getattr(my_agent, "_run_start_time", 0)
        if time.time() - run_start < 1.5:
            logger.info(f"[VAD] Ignoring interruption during 1.5s grace period (time delta: {time.time() - run_start:.2f}s)")
            return
        # ----------------------------------------------------
        
        logger.info("[VAD] Agent speech was interrupted by user, sending UI signal!")
        my_agent.interrupt()

    @session.on("user_input_transcribed")
    def on_user_input_transcribed(ev):
        reset_inactivity_timer()
                    
        # ev.language is Whisper's own detected language for this utterance —
        # more reliable than guessing from the (possibly romanized) text.
        try:
            lang = getattr(ev, "language", None)
            if lang:
                my_agent.stt_detected_language = str(lang)
                logger.info(f"[stt] user_input_transcribed language -> {lang}")
        except Exception as e:
            logger.error(f"[stt] Failed to read language from transcription event: {e}")

        # ── Start filler loop as fallback for Sarvam STT ─────────────────────
        # Sarvam STT has its own end-of-utterance detection and does NOT fire
        # the LiveKit user_stopped_speaking event. So the filler loop is only
        # started here (from user_input_transcribed is_final=True) when
        # user_stopped_speaking has NOT already started it.
        # This fires ~5ms BEFORE _run() is scheduled, so session.say() safely
        # claims the TTS slot first and _run() queues behind it.
        #
        # NOTE: We intentionally do NOT check mic_muted here. The frontend
        # auto-mutes the mic right when the user finishes speaking (to prevent
        # echo), so user_input_transcribed often fires while mic_muted=True even
        # though the user genuinely asked a question. The question WILL be sent
        # to the backend (conversation_item_added fires ~300ms later when the
        # mic is already unmuted). Blocking the filler on mic_muted here causes
        # the agent to answer silently with no filler. The real hallucination
        # guard is in conversation_item_added.
        try:
            is_final = getattr(ev, "is_final", False)
            logger.info(f"[stt] user_input_transcribed is_final={is_final}")
            if is_final:
                logger.info("[voice] Forcing early turn commit (stt_flush_duration=0.0) because is_final=True to bypass VAD delay")
                
                transcript = ""
                if hasattr(ev, "alternatives") and ev.alternatives:
                    transcript = getattr(ev.alternatives[0], "text", "")
                elif hasattr(ev, "text"):
                    transcript = getattr(ev, "text", "")
                    
                if transcript.strip():
                    clean_text = transcript.lower().replace(".", "").replace(",", "").replace("!", "").strip()
                    if getattr(my_agent, "_is_text_turn", False):
                        agent_text = getattr(my_agent, "_agent_spoken_text", "").lower()
                        agent_text = agent_text.replace(".", "").replace(",", "").replace("!", "").strip()
                        transcript_words = set(clean_text.split())
                        agent_words = set(agent_text.split())
                        if transcript_words:
                            overlap = len(transcript_words.intersection(agent_words)) / len(transcript_words)
                            if overlap >= 0.7:
                                logger.info(f"[voice] Ignoring STT transcript (Overlap {overlap:.2f} >= 0.7) — Likely Echo: {transcript!r}")
                                return
                
                my_agent._is_text_turn = False # Reset text guard for voice turns
                
                # PRE-EMPTIVE FIX 1: Clear any stale chunks from previous failed turns 
                # so the TTS engine doesn't spend 500ms processing garbage before playing the filler!
                my_agent._pending_chunks = []
                
                # PRE-EMPTIVE FIX 2: Start the backend request IMMEDIATELY here instead of waiting 
                # 250ms for LiveKit to dispatch conversation_item_added!
                if transcript.strip():
                    my_agent._last_aggressive_voice_prompt = transcript.strip().lower()
                    old_fut = getattr(my_agent, "_turn_future", None)
                    if old_fut and not old_fut.done():
                        old_fut.cancel()
                    my_agent._turn_future = asyncio.Future()
                    my_agent._accepting_turn_events = True
                    asyncio.create_task(send_question_to_backend(my_agent, transcript))
                    logger.info(f"[voice] Aggressively started backend request for: {transcript!r} (saved 250ms!)")
                    
                # ── START BACKGROUND FILLER ───────────────────────────
                # Always play the filler when we detect end of speech, even if the text payload hasn't arrived yet!
                async def play_background_filler():
                    try:
                        if not getattr(my_agent, "tts_status", True):
                            return
                        v_gender = getattr(my_agent, "voice_gender", "female")
                        target_lang = getattr(my_agent, "stt_detected_language", getattr(my_agent, "default_language", "en-IN"))
                        
                        lookup_key = f"{target_lang}_{v_gender}"
                        if lookup_key not in INITIAL_FILLERS:
                            lookup_key = f"en-IN_{v_gender}"
                        fillers = INITIAL_FILLERS.get(lookup_key, INITIAL_FILLERS.get(f"en-IN_{v_gender}", []))
                        if not fillers:
                            return
                        
                        # Update TTS options to match language once
                        if hasattr(my_agent.filler_tts, "update_options"):
                            target_speaker = getattr(my_agent, "voice_name", getattr(my_agent.filler_tts, "speaker", None))
                            my_agent.filler_tts.update_options(target_language_code=target_lang, speaker=target_speaker)
                            logger.info(f"[TESTING-FILLER] [BACKGROUND-FILLER] Updated isolated filler_tts options: lang={target_lang}, speaker={target_speaker}")
                        
                        # Loop through fillers until _stop_filler is set by the real answer arriving.
                        # This lets the current phrase finish gracefully instead of abruptly cutting off.
                        my_agent._stop_filler = False
                        filler_index = random.randint(0, len(fillers) - 1) if fillers else 0
                        first_frame_ever = True
                        while not getattr(my_agent, "_stop_filler", False):
                            filler_text = fillers[filler_index % len(fillers)]
                            if not hasattr(my_agent, "_agent_spoken_text"):
                                my_agent._agent_spoken_text = ""
                            my_agent._agent_spoken_text += " " + filler_text
                            logger.info(f"[TESTING-FILLER] [BACKGROUND-FILLER] Synthesizing filler #{filler_index}: {filler_text!r} (lang: {target_lang})")
                            
                            async for audio in my_agent.filler_tts.synthesize(filler_text):
                                f = audio.frame
                                if first_frame_ever:
                                    first_frame_ever = False
                                    actual_sr = f.sample_rate
                                    actual_ch = f.num_channels
                                    logger.info(f"[TESTING-FILLER] [BACKGROUND-FILLER] First frame: sample_rate={actual_sr}, num_channels={actual_ch}")
                                    if my_agent.filler_audio_source.sample_rate != actual_sr or my_agent.filler_audio_source.num_channels != actual_ch:
                                        logger.warning(f"[BACKGROUND-FILLER] sample_rate mismatch ({my_agent.filler_audio_source.sample_rate} vs {actual_sr}) — rebuilding AudioSource!")
                                        new_source = rtc.AudioSource(actual_sr, actual_ch)
                                        new_track = rtc.LocalAudioTrack.create_audio_track("agent_filler_track", new_source)
                                        publish_opts = rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
                                        await ctx.room.local_participant.publish_track(new_track, publish_opts)
                                        my_agent.filler_audio_source = new_source
                                        logger.info(f"[BACKGROUND-FILLER] Rebuilt AudioSource at {actual_sr} Hz / {actual_ch} ch.")
                                if not getattr(my_agent, "tts_status", True):
                                    return
                                await my_agent.filler_audio_source.capture_frame(f)
                            
                            filler_index += 1
                            # Wait 2 seconds before saying the next filler.
                            # Poll every 100ms so we exit the wait quickly when _stop_filler is set.
                            logger.info(f"[TESTING-FILLER] [BACKGROUND-FILLER] Filler done. Waiting 2s before next filler...")
                            for _ in range(20):
                                if getattr(my_agent, "_stop_filler", False):
                                    break
                                await asyncio.sleep(0.1)
                        logger.info("[TESTING-FILLER] [BACKGROUND-FILLER] Filler loop exited gracefully after finishing current phrase.")
                            
                    except asyncio.CancelledError:
                        logger.info("[TESTING-FILLER] [BACKGROUND-FILLER] Filler loop cancelled — real answer is arriving!")
                    except Exception as e:
                        logger.error(f"[TESTING-FILLER] [BACKGROUND-FILLER] Error in filler loop: {e}")
                
                # Cancel any existing filler task
                if getattr(my_agent, "_filler_task", None) and not my_agent._filler_task.done():
                    my_agent._filler_task.cancel()
                    
                my_agent._filler_task = asyncio.create_task(play_background_filler())
                
                try:
                    session.commit_user_turn(stt_flush_duration=0.0)
                except Exception as e:
                    logger.error(f"[voice] Failed to commit user turn: {e}")
        except Exception as e:
            logger.error(f"[stt] Failed to handle user_input_transcribed: {e}")

    @session.on("conversation_item_added")
    def on_conversation_item_added(item):
        logger.info(f"Conversation item added: {item}")

        # ── STEP 3: Voice path — fire WS question immediately ─────────────────
        # This runs BEFORE LiveKit calls RAGLLM.chat() / RAGLLMStream.__init__,
        # so the backend starts processing before the filler gets the speech slot.
        try:
            msg = getattr(item, "item", item)
            role = getattr(msg, "role", "unknown")
            content = getattr(msg, "content", "")
            if isinstance(content, list):
                content = "".join(str(c) for c in content)
            else:
                content = str(content)
            content = content.strip()

            if role == "user" and content:
                # STT transcripts have metrics (e.g. stt_metadata or started_speaking_at).
                # Typed text from the UI does not. We strictly only want to fire the 
                # voice-path WS logic for actual voice transcripts. (Text path is handled by data channel).
                metrics = getattr(msg, "metrics", None) or {}
                is_voice_transcript = "stt_metadata" in metrics or "started_speaking_at" in metrics
                
                if not is_voice_transcript:
                    logger.info("[voice/text] Skipping send_question_to_backend() in conversation_item_added — this is a typed text question.")
                else:
                    # Check for hallucinations BEFORE sending the question to the backend
                    clean_text = content.lower().replace(".", "").replace(",", "").replace("!", "")
                    hallucinations = {"thank you", "bye", "thanks", "yeah", "ok", "okay", "you", "amaraorg", "subscribe"}
                    if clean_text in hallucinations or len(clean_text) <= 1:
                        logger.info(f"[voice] Dropping likely STT hallucination early (not sending to backend): {content!r}")
                        # DO NOT call my_agent.interrupt() here! 
                        # If a text reply is actively generating and the open mic picks up a tiny background noise,
                        # the VAD commits an empty turn (hallucination). If we interrupt here, it kills the text reply!
                    elif getattr(my_agent, "_last_aggressive_voice_prompt", "") == clean_text:
                        logger.info(f"[voice] Skipping send_question_to_backend() in conversation_item_added because aggressive pre-fetch already started it!")
                        my_agent._last_aggressive_voice_prompt = "" # Reset
                    else:
                        logger.info(f"[voice] Firing send_question_to_backend() from conversation_item_added for: {content!r}")
                        # CRITICAL FIX: Pre-initialize the future synchronously here. 
                        # asyncio.create_task() yields to the event loop, meaning LiveKit might start RAGLLMStream._run() 
                        # before send_question_to_backend() runs. If that happens, _run() will grab the OLD completed future!
                        old_fut = getattr(my_agent, "_turn_future", None)
                        if old_fut and not old_fut.done():
                            old_fut.cancel()
                        my_agent._turn_future = asyncio.Future()
                        my_agent._accepting_turn_events = True
                        my_agent._pending_chunks = []
                        
                        asyncio.create_task(send_question_to_backend(my_agent, content))
                        # NOTE: filler_loop is started from user_input_transcribed (is_final=True)
                        # NOT from here. Starting it here causes session.say() to compete with
                        # the active LLM turn and LiveKit cancels _run() → ChanClosed on all chunks.
        except Exception as e:
            logger.error(f"[conversation_item_added] Failed to fire send_question_to_backend: {e}")
        # ─────────────────────────────────────────────────────────────────────

        async def post_transcript(event_obj):
            try:
                msg = getattr(event_obj, "item", event_obj)
                role = getattr(msg, "role", "unknown")
                
                if role == "assistant":
                    return
                
                content = getattr(msg, "content", "")
                
                if isinstance(content, list):
                    content = "".join(str(c) for c in content)
                else:
                    content = str(content)
                
                if not content.strip():
                    return
                
                payload = {
                    "ai_call_token": getattr(my_agent, "ai_call_token", ""),
                    "role": role,
                    "message": content
                }
                
                logger.info(f"Posting to /append_transcript: {payload}")
                async with http_session.post("https://smartshop.chqme.com/xai/append_transcript", json=payload) as resp:
                    resp_text = await resp.text()
                    
                    try:
                        with open("transcript_api.log", "a", encoding="utf-8") as f:
                            now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                            f.write(f"========== {now} POST /append_transcript ==========\n")
                            f.write(f"REQUEST:\n{json.dumps(payload, indent=2)}\n")
                            f.write(f"RESPONSE [{resp.status}]:\n{resp_text}\n\n")
                    except Exception as e:
                        logger.error(f"Failed to write transcript log: {e}")

                    if resp.status == 200:
                        try:
                            resp_data = json.loads(resp_text)
                            logger.info(f"[/append_transcript] response: {json.dumps(resp_data, indent=2)}")
                        except Exception:
                            pass
                    else:
                        logger.error(f"[/append_transcript] failed with status {resp.status}")
            except Exception as e:
                logger.error(f"Error calling /append_transcript: {e}")

        asyncio.create_task(post_transcript(item))

    @ctx.room.on("data_received")
    def on_data_received(dp: rtc.DataPacket):
        # 🎙️ Topic: voice-name 🎙️
        if dp.topic == "voice-name":
            try:
                payload = json.loads(dp.data.decode("utf-8"))
                my_agent.voice_name = payload.get("voice_name")
                if my_agent.voice_name in ("shubh", "sumit"):
                    my_agent.voice_gender = "male"
                elif my_agent.voice_name in ("ritu", "priya"):
                    my_agent.voice_gender = "female"
                else:
                    my_agent.voice_gender = payload.get("voice_gender", "female")
                logger.info(f"[data] voice-name updated -> {my_agent.voice_name} ({my_agent.voice_gender})")
            except Exception as e:
                logger.warning(f"[data] Failed to parse voice-name packet: {e}")
            return

        # 🎙️ Topic: ai_id 🎙️──────────────────────────────────────────────
        if dp.topic == "ai_id":
            try:
                payload = json.loads(dp.data.decode("utf-8"))
                my_agent.ai_id = payload.get("ai_id")
                logger.info(f"[data] ai_id updated → {my_agent.ai_id}")
            except Exception as e:
                logger.warning(f"[data] Failed to parse ai_id packet: {e}")
            return

        # 🎙️ Topic: language 🎙️──────────────────────────────────────────────
        if dp.topic == "language":
            try:
                payload = json.loads(dp.data.decode("utf-8"))
                my_agent.default_language = payload.get("language")
                logger.info(f"[data] language updated → {my_agent.default_language}")
            except Exception as e:
                logger.warning(f"[data] Failed to parse language packet: {e}")
            return

        # 🎙️ Topic: product-id 🎙️──────────────────────────────────────────────
        if dp.topic == "product-id":
            try:
                payload = json.loads(dp.data.decode("utf-8"))
                my_agent.product_id = payload.get("product_id")

                # Also capture the ai_call_token if sent by the frontend
                ai_token = payload.get("ai_call_token")
                if ai_token:
                    my_agent.session_id = ai_token
                    my_agent.ai_call_token = ai_token

                logger.info(f"[data] product_id updated → {my_agent.product_id}, ai_call_token → {getattr(my_agent, 'ai_call_token', None)}")
            except Exception as e:
                logger.warning(f"[data] Failed to parse product-id packet: {e}")
            return

        # ── Topic: mute-agent ──────────────────────────────────────────────
        if dp.topic == "mute-agent":
            try:
                payload = json.loads(dp.data.decode("utf-8"))
                my_agent.tts_status = payload.get("tts_status", False)
                logger.info(f"[data] Agent tts_status updated -> {my_agent.tts_status}")
            except Exception as e:
                logger.warning(f"[data] Failed to parse mute-agent packet: {e}")
            return

        # ── Topic: user-input ──────────────────────────────────────────────
        if dp.topic == "user-input":
            reset_inactivity_timer()
            try:
                payload = json.loads(dp.data.decode("utf-8"))
            except Exception as e:
                logger.error(f"[data] Failed to parse user-input packet: {e}")
                return

            question = payload.get("text", "").strip()
            logger.info(f"[data] user-input received: {question!r}")

            if not question:
                return

            # Clear the product_id so that text queries (like clicking a product card) rely purely on the text
            # and do not get stuck with the previous context's product_id
            my_agent.product_id = None
            logger.info("[data] Cleared my_agent.product_id for explicit text user-input.")

            is_programmatic = (
                question.lower().startswith("tell me more about") or 
                question.lower().startswith("tell me about the feature")
            )

            # NEW — don't let a stale voice-detected language leak into a typed turn,
            # EXCEPT for programmatic UI clicks where we want to preserve the language context!
            if not is_programmatic:
                my_agent.stt_detected_language = None
                logger.info("[data] Cleared my_agent.stt_detected_language for explicit text user-input.")
            else:
                logger.info(f"[data] Kept my_agent.stt_detected_language ({getattr(my_agent, 'stt_detected_language', None)}) for programmatic click.")

            # Unconditionally interrupt the agent to stop any ongoing speech/processing
            logger.info("[data] Forcing agent interruption for new text input.")
            interrupted_active = False
            try:
                interrupted_active = my_agent.interrupt()
            except Exception as e:
                logger.error(f"[data] Error interrupting agent on text input: {e}")

            async def handle_text_with_rag(prompt: str):
                # Capture whatever filler was running when this text turn STARTED.
                # The finally block must only cancel THIS specific task.
                # If a new voice question arrives while we await the speech_handle,
                # it will create a NEW _filler_task — we must NOT cancel that one.
                stale_filler_task = getattr(my_agent, "_filler_task", None)
                try:
                    # Give the session a moment to settle after interrupt().
                    await asyncio.sleep(0.3 if interrupted_active else 0.1)

                    # Store the question so agent-ui can reference it.
                    my_agent._last_user_question = prompt

                    # STEP 2: Fire WS question FIRST so the backend begins processing immediately.
                    logger.info(f"[text] Firing send_question_to_backend() for: {prompt!r}")
                    my_agent._is_text_turn = True # Guard against echo/keyboard noise interrupting this turn
                    await send_question_to_backend(my_agent, prompt)

                    # For text, we can safely use session.say() because it won't be interrupted by VAD transitions.
                    v_gender = getattr(my_agent, "voice_gender", "female")
                    target_lang = getattr(my_agent, "stt_detected_language") or getattr(my_agent, "default_language", "en-IN")
                    
                    lookup_key = f"{target_lang}_{v_gender}"
                    if lookup_key not in INITIAL_FILLERS:
                        lookup_key = f"en-IN_{v_gender}"
                    fillers = INITIAL_FILLERS.get(lookup_key, INITIAL_FILLERS.get(f"en-IN_{v_gender}", []))
                    if fillers and getattr(my_agent, "filler_audio_source", None):
                        # Use the same background audio track as voice fillers to avoid
                        # conflicting with session.generate_reply() on the main track.
                        # Loop through fillers with 2s gap until cancelled by the real answer.
                        async def _play_text_filler(filler_list=fillers, lang=target_lang):
                            try:
                                if not getattr(my_agent, "tts_status", True):
                                    return
                                # Use _stop_filler flag so the current phrase finishes gracefully.
                                my_agent._stop_filler = False
                                filler_index = random.randint(0, len(filler_list) - 1) if filler_list else 0
                                while not getattr(my_agent, "_stop_filler", False):
                                    filler_text = filler_list[filler_index % len(filler_list)]
                                    if not hasattr(my_agent, "_agent_spoken_text"):
                                        my_agent._agent_spoken_text = ""
                                    my_agent._agent_spoken_text += " " + filler_text
                                    logger.info(f"[TESTING-FILLER] [text] Synthesizing filler #{filler_index}: {filler_text!r}")
                                    if hasattr(my_agent.filler_tts, "update_options"):
                                        target_speaker = getattr(my_agent, "voice_name", getattr(my_agent.filler_tts, "speaker", None))
                                        my_agent.filler_tts.update_options(target_language_code=lang, speaker=target_speaker)
                                        logger.info(f"[TESTING-FILLER] [text] Updated isolated filler_tts options: lang={lang}, speaker={target_speaker}")
                                    async for audio in my_agent.filler_tts.synthesize(filler_text):
                                        if not getattr(my_agent, "tts_status", True):
                                            return
                                        await my_agent.filler_audio_source.capture_frame(audio.frame)
                                    filler_index += 1
                                    # Poll every 100ms during the 2s wait so we exit quickly on _stop_filler.
                                    logger.info(f"[TESTING-FILLER] [text] Filler done. Waiting 2s before next filler...")
                                    for _ in range(20):
                                        if getattr(my_agent, "_stop_filler", False):
                                            break
                                        await asyncio.sleep(0.1)
                                logger.info("[TESTING-FILLER] [text] Text filler loop exited gracefully after finishing current phrase.")
                            except asyncio.CancelledError:
                                logger.info("[TESTING-FILLER] [text] Text filler loop cancelled — real answer is arriving!")
                            except Exception as e:
                                logger.error(f"[TESTING-FILLER] [text] Text filler error: {e}")
                        # Cancel any previous text filler task before starting a new one
                        if getattr(my_agent, "_filler_task", None) and not my_agent._filler_task.done():
                            my_agent._filler_task.cancel()
                        my_agent._filler_task = asyncio.create_task(_play_text_filler())
                        my_agent._voice_filler_played = True
                        logger.info(f"[TESTING-FILLER] [text] Started filler loop via background track.")
                    # Cancel any stale filler loop task (the one we captured above)
                    if stale_filler_task and not stale_filler_task.done():
                        stale_filler_task.cancel()

                    # Now ask LiveKit to run the turn natively using generate_reply.
                    # We await the speech handle so this task completes cleanly.
                    logger.info(f"[text] Calling session.generate_reply(user_input={prompt!r})")
                    try:
                        speech_handle = session.generate_reply(user_input=prompt)
                        logger.info(f"[text] generate_reply() returned: {speech_handle!r}")
                        await speech_handle
                        logger.info(f"[text] SpeechHandle completed successfully for: {prompt!r}")
                    except RuntimeError as gen_err:
                        logger.warning(f"[text] generate_reply() skipped — {gen_err}")
                    except Exception as gen_err:
                        logger.error(f"[text] generate_reply() FAILED — {type(gen_err).__name__}: {gen_err}", exc_info=True)
                        raise

                except Exception as e:
                    logger.error(f"[data] Text handling error: {e}")
                finally:
                    # IMPORTANT: Only cancel the filler task that was running when
                    # THIS text turn started (stale_filler_task). Do NOT cancel the
                    # current _filler_task if it's a DIFFERENT (newer) task —
                    # that means a new voice question has already started its own
                    # filler and cancelling it would silence the voice filler.
                    current_filler = getattr(my_agent, "_filler_task", None)
                    if current_filler and not current_filler.done():
                        if current_filler is stale_filler_task:
                            current_filler.cancel()
                            logger.info("[text] Cancelled filler_loop after text turn completed.")
                        else:
                            logger.info("[text] Skipping filler cancel — a newer voice turn's filler is running.")
                    my_agent._current_stream = None

            my_agent._current_task = asyncio.create_task(handle_text_with_rag(question))


    await ctx.connect()
    
    # Publish the background filler track to the room
    await ctx.room.local_participant.publish_track(filler_audio_track, filler_publish_options)
    logger.info("[BACKGROUND-FILLER] Published dedicated filler audio track to the room.")

    for participant in ctx.room.remote_participants.values():
        if not getattr(my_agent, "_watcher_started", False):
            my_agent._watcher_started = True
            asyncio.create_task(inactivity_watcher())
        asyncio.create_task(_initialize_session(participant.identity))

    async def db_poll_loop():
        # Wait until ai_call_token is provided by the frontend
        while not getattr(my_agent, "ai_call_token", None):
            await asyncio.sleep(0.5)

        token = my_agent.ai_call_token
        expert_event_sent = False

        while not getattr(my_agent, "idle_task_cancelled", False):
            try:
                # Establish connection using .env variables
                db_host = os.getenv("DB_HOST", "")
                db_user = os.getenv("DB_USER", "")
                db_password = os.getenv("DB_PASSWORD", "").strip("'\"")
                db_name = os.getenv("DB_NAME", "")
                db_port = int(os.getenv("DB_PORT", "5432"))
                ssl_mode = os.getenv("SSL_MODE", "require")
                
                # In asyncpg, pass the string "require" to match standard libpq behavior
                # (which requires SSL but does not strictly verify the self-signed cert by default)
                # This matches how xai-backend configures asyncpg.create_pool.
                use_ssl = False if ssl_mode.lower() == "disable" else ssl_mode

                conn = await asyncpg.connect(
                    user=db_user,
                    password=db_password,
                    database=db_name,
                    host=db_host,
                    port=db_port,
                    ssl=use_ssl
                )
                
                while not getattr(my_agent, "idle_task_cancelled", False):
                    row = await conn.fetchrow(
                        "SELECT ai_status_code FROM public.ai_orders WHERE ai_call_token = $1",
                        token
                    )
                    
                    if row and row['ai_status_code'] == 15 and not expert_event_sent:
                        # Send event to frontend
                        expert_payload = json.dumps({"event": "expert_joined", "status": 15}).encode("utf-8")
                        await ctx.room.local_participant.publish_data(
                            expert_payload,
                            reliable=True,
                            topic="expert"
                        )
                        logger.info(f"[db_poll] Sent expert event for token {token}")
                        expert_event_sent = True
                    
                    await asyncio.sleep(3) # Poll every 3 seconds

                await conn.close()
            except Exception as e:
                logger.error(f"[db_poll] Connection/Query error: {e}")
                await asyncio.sleep(5) # Wait before reconnecting

    async def ws_loop():
        # Wait until ai_call_token is provided by the frontend
        while not getattr(my_agent, "ai_call_token", None):
            await asyncio.sleep(0.5)

        call_id = my_agent.ai_call_token
        uri = f"ws://localhost:8001/ws/{call_id}"
        while not getattr(my_agent, "idle_task_cancelled", False):
            try:
                async with http_session.ws_connect(uri) as ws:
                    my_agent.ws = ws
                    logger.info(f"Connected to websocket: {uri}")
                    async for msg in ws:
                        if msg.type == aiohttp.WSMsgType.TEXT:
                            logger.info(f"Received WS msg: {msg.data}")
                            try:
                                ws_payload = json.loads(msg.data)
                                if ws_payload.get("event") == "stream":
                                    logger.info(f"[{time.time()}] Received 'stream' event chunk from backend")
    
                                    chunk_turn_id_raw = ws_payload.get("turn_id")
    
                                    if chunk_turn_id_raw is None:
                                        logger.warning("[ws_loop] Discarding stream chunk with missing turn_id")
                                        continue
    
                                    # The backend sends turn_id as "{call_id}_{turn_number}" (e.g. "abc123_2").
                                    # Extract the numeric suffix and compare against my_agent.turn_number (int).
                                    try:
                                        chunk_turn_num = int(str(chunk_turn_id_raw).rsplit("_", 1)[-1])
                                    except (ValueError, IndexError):
                                        chunk_turn_num = None
    
                                    if chunk_turn_num is None or chunk_turn_num != getattr(my_agent, "turn_number", -1):
                                        logger.debug(f"[ws_loop] Discarding stale chunk from turn {chunk_turn_id_raw} (current turn is {getattr(my_agent, 'turn_number', -1)})")
                                        continue
    
                                    if getattr(my_agent, "_accepting_turn_events", False):
                                        chunk = ws_payload.get("chunk", "")
                                        if chunk:
                                            if not hasattr(my_agent, "_agent_spoken_text"):
                                                my_agent._agent_spoken_text = ""
                                            my_agent._agent_spoken_text += " " + chunk
    
                                            # Tell the background filler to stop gracefully after its current phrase
                                            # instead of hard-cancelling it mid-word.
                                            filler_task = getattr(my_agent, "_filler_task", None)
                                            if filler_task and not filler_task.done():
                                                my_agent._stop_filler = True
                                                logger.info("[TESTING-FILLER] [BACKGROUND-FILLER] Instructed filler to stop gracefully (real chunk arrived).")
    
                                            # Switch TTS to the STT-detected language (one-shot per turn)
                                            if not getattr(my_agent, "_tts_lang_switched", False):
                                                try:
                                                    stt_lang = getattr(my_agent, "_stt_lang", "en-IN")
                                                    tts_inst = my_agent._custom_session.tts if getattr(my_agent, "_custom_session", None) else None
                                                    if tts_inst and hasattr(tts_inst, "update_options"):
                                                        target_speaker = getattr(my_agent, "voice_name", getattr(tts_inst, "speaker", None))
                                                        tts_inst.update_options(target_language_code=stt_lang, speaker=target_speaker)
                                                        logger.info(f"[ws_loop] Switched TTS to stt_lang={stt_lang} and speaker={target_speaker} on first chunk.")
                                                    my_agent._tts_lang_switched = True
                                                except Exception: pass
    
                                            # STEP 5: Build the ChatChunk first
                                            chat_chunk = ChatChunk(
                                                id=getattr(getattr(my_agent, "_current_stream", None), "_id", str(uuid.uuid4())),
                                                delta=ChoiceDelta(role="assistant", content=chunk)
                                            )
    
                                            # If the filler is still finishing its phrase, buffer this chunk
                                            # and schedule a flush task to push all buffered chunks once the
                                            # filler track goes silent. This prevents audio overlap.
                                            filler_task = getattr(my_agent, "_filler_task", None)
                                            if filler_task and not filler_task.done():
                                                if not isinstance(getattr(my_agent, "_chunk_buffer", None), list):
                                                    my_agent._chunk_buffer = []
                                                my_agent._chunk_buffer.append(chat_chunk)
                                                logger.info(f"[ws_loop] Buffered chunk (total={len(my_agent._chunk_buffer)}) — filler is still finishing its phrase.")
    
                                                # Spawn a single flush task that waits for the filler to exit
                                                # and then drains the buffer into the LLM stream.
                                                if not getattr(my_agent, "_flushing_buffer", False):
                                                    my_agent._flushing_buffer = True
                                                    # Capture the turn number NOW so we can abort if a new
                                                    # turn starts before the filler finishes.
                                                    _flush_turn = getattr(my_agent, "turn_number", -1)
                                                    async def flush_after_filler(_ft=filler_task, _turn=_flush_turn):
                                                        try:
                                                            await _ft
                                                        except (asyncio.CancelledError, Exception):
                                                            pass
                                                        # Abort if a newer turn has already started — flushing
                                                        # stale chunks into the new turn's stream would corrupt it.
                                                        # Do NOT clear _chunk_buffer here — send_question_to_backend
                                                        # already cleared it for the new turn.
                                                        if getattr(my_agent, "turn_number", -1) != _turn:
                                                            logger.warning(f"[ws_loop] flush_after_filler: turn changed ({_turn} → {getattr(my_agent, 'turn_number', -1)}), aborting stale flush.")
                                                            my_agent._flushing_buffer = False
                                                            return
                                                        logger.info(f"[ws_loop] Filler finished — flushing {len(getattr(my_agent, '_chunk_buffer', []))} buffered chunks into TTS pipeline.")
                                                        while getattr(my_agent, "_chunk_buffer", []):
                                                            c = my_agent._chunk_buffer.pop(0)
                                                            if hasattr(my_agent, "_current_stream") and my_agent._current_stream:
                                                                try:
                                                                    if getattr(my_agent, "tts_status", True):
                                                                        my_agent._current_stream._event_ch.send_nowait(c)
                                                                        logger.info(f"[ws_loop] Flushed buffered chunk to _event_ch.")
                                                                except Exception as e:
                                                                    logger.error(f"[ws_loop] Failed to flush chunk to _event_ch: {type(e).__name__}: {e}")
                                                                    if "ChanClosed" in type(e).__name__ or "ChanClosed" in str(e):
                                                                        logger.warning("[ws_loop] flush_after_filler: _event_ch closed — stopping flush and marking turn as done.")
                                                                        my_agent._chunk_buffer = []
                                                                        my_agent._accepting_turn_events = False
                                                                        break
                                                            else:
                                                                if getattr(my_agent, "tts_status", True):
                                                                    if not isinstance(getattr(my_agent, "_pending_chunks", None), list):
                                                                        my_agent._pending_chunks = []
                                                                    my_agent._pending_chunks.append(c)
                                                                    logger.info(f"[ws_loop] Flushed buffered chunk to _pending_chunks.")
                                                        logger.info("[ws_loop] flush_after_filler completed successfully. _flushing_buffer set to False.")
                                                        my_agent._flushing_buffer = False
                                                    asyncio.create_task(flush_after_filler())
                                            else:
                                                # Filler is already done — pipe chunk immediately into LiveKit's
                                                # LLMStream, or buffer in _pending_chunks if stream not ready yet.
                                                if hasattr(my_agent, "_current_stream") and my_agent._current_stream:
                                                    logger.info(f"[{time.time()}] Pushing chunk to LLMStream _event_ch — stream_id={my_agent._current_stream._id!r} chunk_len={len(chunk)}")
                                                    try:
                                                        if getattr(my_agent, "tts_status", True):
                                                            my_agent._current_stream._event_ch.send_nowait(chat_chunk)
                                                    except Exception as e:
                                                        logger.error(f"[ws_loop] FAILED to push chunk to _event_ch: {type(e).__name__}: {e}")
                                                        # _event_ch is closed — _run() already exited (e.g. due to an interrupt).
                                                        # Stop processing all further chunks for this stale turn immediately.
                                                        if "ChanClosed" in type(e).__name__ or "ChanClosed" in str(e):
                                                            logger.warning("[ws_loop] _event_ch is closed — stopping chunk delivery for this turn (stale turn after interrupt).")
                                                            my_agent._accepting_turn_events = False
                                                else:
                                                    # _current_stream not ready yet — buffer the chunk.
                                                    # RAGLLMStream.__init__ flushes _pending_chunks into _event_ch when it runs.
                                                    if getattr(my_agent, "tts_status", True):
                                                        if not isinstance(getattr(my_agent, "_pending_chunks", None), list):
                                                            my_agent._pending_chunks = []
                                                        my_agent._pending_chunks.append(chat_chunk)
                                                        logger.info(f"[ws_loop] Buffered early chunk (total={len(my_agent._pending_chunks)}) — _current_stream not ready yet")
    
                                            # Forward to frontend UI
                                            chunk_payload = json.dumps({
                                                "chunk": chunk,
                                                "turn_id": chunk_turn_id_raw
                                            }).encode("utf-8")
                                            await my_agent._room.local_participant.publish_data(
                                                chunk_payload,
                                                reliable=True,
                                                topic="chunk"
                                            )
                                    else:
                                        logger.warning(f"[ws_loop] CHUNK DROPPED — _accepting_turn_events=False (turn={getattr(my_agent, 'turn_number', -1)}, chunk_turn={chunk_turn_num}). This means interrupt() was called before this chunk arrived.")
                                elif ws_payload.get("event") == "final":
                                    # Always ensure filler stops when turn completes
                                    filler_task = getattr(my_agent, "_filler_task", None)
                                    if filler_task and not filler_task.done():
                                        my_agent._stop_filler = True
                                    final_turn_id_raw = ws_payload.get("turn_id")
                                    if final_turn_id_raw is None:
                                        logger.warning("[ws_loop] Discarding final event with missing turn_id")
                                        continue
                                    
                                    try:
                                        final_turn_num = int(str(final_turn_id_raw).rsplit("_", 1)[-1])
                                    except (ValueError, IndexError):
                                        final_turn_num = None
                                        
                                    if final_turn_num is None or final_turn_num != getattr(my_agent, "turn_number", -1):
                                        logger.debug(f"[ws_loop] Discarding stale final event from turn {final_turn_id_raw}")
                                        continue
    
                                    # Discard stale final events that arrive after an interrupt
                                    if not getattr(my_agent, "_accepting_turn_events", False):
                                        logger.info("[ws_loop] Discarding stale final event (turn was interrupted)")
                                        # Cancel the future if still pending so no coroutine hangs
                                        if hasattr(my_agent, "_turn_future") and not my_agent._turn_future.done():
                                            my_agent._turn_future.cancel()
                                    else:
                                        final_data = ws_payload.get("data", {})
    
                                        assistant_full_text = final_data.get("message", "")
                                        if assistant_full_text.strip():
                                            async def post_assistant_transcript(txt):
                                                payload = {
                                                    "ai_call_token": getattr(my_agent, "ai_call_token", ""),
                                                    "role": "assistant",
                                                    "message": txt
                                                }
                                                try:
                                                    logger.info(f"Posting assistant to /append_transcript: {payload}")
                                                    async with http_session.post("https://smartshop.chqme.com/xai/append_transcript", json=payload) as resp:
                                                        resp_text = await resp.text()
                                                        try:
                                                            with open("transcript_api.log", "a", encoding="utf-8") as f:
                                                                now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                                                                f.write(f"========== {now} POST /append_transcript (assistant) ==========\n")
                                                                f.write(f"REQUEST:\n{json.dumps(payload, indent=2)}\n")
                                                                f.write(f"RESPONSE [{resp.status}]:\n{resp_text}\n\n")
                                                        except Exception as e:
                                                            logger.error(f"Failed to write transcript log: {e}")
                                                except Exception as e:
                                                    logger.error(f"Error calling /append_transcript for assistant: {e}")
                                            
                                            asyncio.create_task(post_assistant_transcript(assistant_full_text))
    
                                        buying_intent = final_data.get("buying_intent")
                                        if buying_intent:
                                            async def post_buying_intent(intent_payload):
                                                payload = {
                                                    "ai_call_token": getattr(my_agent, "ai_call_token", ""),
                                                    "intent_data": intent_payload
                                                }
                                                try:
                                                    logger.info(f"Posting buying intent to /update_intent: {payload}")
                                                    async with http_session.post("http://localhost:8000/update_intent", json=payload) as resp:
                                                        resp_text = await resp.text()
                                                        logger.info(f"RESPONSE from /update_intent [{resp.status}]: {resp_text}")
                                                except Exception as e:
                                                    logger.error(f"Error calling /update_intent: {e}")
                                            
                                            asyncio.create_task(post_buying_intent(buying_intent))
    
                                        product_ids = final_data.get("product_ids", [])
                                        feature_id = final_data.get("feature_id")
                                        media_id = final_data.get("media_id")
                                        raw_products = []
    
                                        try:
                                            if len(product_ids) == 1:
                                                pid = product_ids[0]
                                                if feature_id is not None:
                                                    prod_url = f"http://localhost:8000/products/{pid}?feature_id={feature_id}"
                                                else:
                                                    prod_url = f"http://localhost:8000/products/{pid}"
                                                logger.info(f"[ws_loop] GET product — request URL: {prod_url}")
                                                async with http_session.get(prod_url) as resp:
                                                    logger.info(f"[ws_loop] GET product — response status: {resp.status}")
                                                    if resp.status == 200:
                                                        prod_data = await resp.json()
                                                        logger.info(f"[ws_loop] GET product — response body: {json.dumps(prod_data, indent=2)}")
                                                        try:
                                                            with open("api_responses.log", "a", encoding="utf-8") as f:
                                                                f.write(f"========== GET /products/{product_ids[0]} ==========\n")
                                                                f.write(json.dumps(prod_data, indent=2) + "\n\n")
                                                        except Exception as e:
                                                            logger.error(f"Failed to write API response to file: {e}")
                                                        if isinstance(prod_data, list):
                                                            raw_products.extend(prod_data)
                                                        else:
                                                            raw_products.append(prod_data)
                                                    else:
                                                        logger.error(f"[ws_loop] Failed to fetch product from {prod_url}. Status: {resp.status}")
                                            elif len(product_ids) > 1:
                                                bulk_payload = {"product_ids": [str(pid) for pid in product_ids]}
                                                logger.info(f"[ws_loop] POST /products/bulk — request payload: {json.dumps(bulk_payload, indent=2)}")
                                                async with http_session.post("http://localhost:8000/products/bulk", json=bulk_payload) as resp:
                                                    logger.info(f"[ws_loop] POST /products/bulk — response status: {resp.status}")
                                                    if resp.status == 200:
                                                        bulk_data = await resp.json()
                                                        logger.info(f"[ws_loop] POST /products/bulk — response body: {json.dumps(bulk_data, indent=2)}")
                                                        try:
                                                            with open("api_responses.log", "a", encoding="utf-8") as f:
                                                                f.write("========== POST /products/bulk ==========\n")
                                                                f.write(json.dumps(bulk_data, indent=2) + "\n\n")
                                                        except Exception as e:
                                                            logger.error(f"Failed to write API response to file: {e}")
                                                        raw_products = bulk_data.get("products", [])
                                                    else:
                                                        logger.error(f"[ws_loop] Failed to fetch bulk products. Status: {resp.status}")
                                        except Exception as e:
                                            logger.error(f"[ws_loop] Error fetching product details: {e}")
    
                                        media_hotspots_data = None
                                        if media_id is not None:
                                            try:
                                                media_url = f"http://localhost:8000/media/{media_id}/hotspots"
                                                logger.info(f"[ws_loop] GET media hotspots — request URL: {media_url}")
                                                async with http_session.get(media_url) as resp:
                                                    if resp.status == 200:
                                                        media_hotspots_data = await resp.json()
                                                        logger.info(f"[ws_loop] GET media hotspots — response: {json.dumps(media_hotspots_data)}")
                                                    else:
                                                        logger.error(f"[ws_loop] Failed to fetch media hotspots. Status: {resp.status}")
                                            except Exception as e:
                                                logger.error(f"[ws_loop] Error fetching media hotspots: {e}")

                                        mapped_products = []
                                        feature_media = None
                                        for p in raw_products:
                                            logger.info(f"the product {p}")
                                            feature_media = p.get("feature_media")
                                            logger.info(f"the feature image {feature_media}")
                                            mapped_products.append({
                                                "title": p.get("product_title"),
                                                "min_price": p.get("min_price"),
                                                "aip_id": p.get("aip_id"),
                                                "shopify_product_id": p.get("shopify_product_id"),
                                                "feature_image": p.get("feature_image"),
                                                "featured_image": p.get("feature_image"),
                                                "view_product_url": p.get("view_product_url"),
                                                "add_to_cart_url": p.get("add_to_cart_url"),
                                                "media_gallery": p.get("media_gallery", [])
                                                
                                            })
                                            
                                        if media_hotspots_data is not None:
                                            feature_media = media_hotspots_data
    
                                        highlighted_feature = None
                                        if len(product_ids) == 1 and raw_products:
                                            first_prod = raw_products[0]                                    
                                            media_gallery = first_prod.get("media_gallery", [])
                                            default_image_id = first_prod.get("default_image_id")
    
                                            if media_gallery and isinstance(media_gallery, list):
                                                highlighted_feature = None
    
                                                target_media_id = media_id if media_id is not None else default_image_id
                                                if target_media_id is not None:
                                                    highlighted_feature = next(
                                                        (
                                                            m for m in media_gallery
                                                            if m.get("media_id") == target_media_id
                                                        ),
                                                        None,
                                                    )
                                        
                                                if highlighted_feature is None and media_gallery:
                                                    highlighted_feature = media_gallery[0]
    
                                        agent_ui_payload = {
                                            "status": "success",
                                            "question": getattr(my_agent, "_last_user_question", ""),
                                            "answer": final_data.get("message", ""),
                                            "products": mapped_products,
                                            "feature_media": [feature_media] if feature_media is not None else None,
                                            "highlighted_feature": highlighted_feature,
                                            "media_hotspots": media_hotspots_data,
                                            "is_context_change": final_data.get("is_context_change", False),
                                            "question_for_you": final_data.get("question_for_you", [])
                                        }
    
                                        logger.info(f"[agent-ui] Sending payload to frontend:\n{json.dumps(agent_ui_payload, indent=2)}")
                                        
                                        try:
                                            with open("agent_ui_responses.log", "a", encoding="utf-8") as f:
                                                f.write("========== AGENT UI PAYLOAD ==========\n")
                                                f.write(json.dumps(agent_ui_payload, indent=2) + "\n\n")
                                        except Exception as e:
                                            logger.error(f"Failed to write agent_ui_payload to file: {e}")
    
                                        await my_agent._room.local_participant.publish_data(
                                            json.dumps(agent_ui_payload).encode("utf-8"),
                                            reliable=True,
                                            topic="agent-ui"
                                        )
                                        logger.info("[agent-ui] Published final response to frontend successfully.")
    
                                        # Signal process_question that the turn is complete
                                        if hasattr(my_agent, "_turn_future") and not my_agent._turn_future.done():
                                            my_agent._turn_future.set_result(final_data.get("message", ""))
                            except Exception as e:
                                logger.error(f"Error processing WS message: {e}")
                        elif msg.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                            break
            except Exception as e:
                logger.error(f"WebSocket connection failed: {e}")
            logger.info("Reconnecting WS in 1 second...")
            await asyncio.sleep(1)

    asyncio.create_task(db_poll_loop())
    asyncio.create_task(ws_loop())

    a = await session.start(
        room=ctx.room,
        agent=my_agent,
    )
    logger.info(a)
    logger.info("session start")

    async def cleanup():
        logger.info("job ending, cleaning up")
        await http_session.close()

    ctx.add_shutdown_callback(cleanup)


if __name__ == "__main__":
    agents.cli.run_app(
        agents.WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
            agent_name="simli-tutor",
            port=3002,
        )
    )