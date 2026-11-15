// Browser-native speech engine — ported verbatim (TS→JS) from the SMART widget's
// speech.ts. Pure Web Speech API, zero dependencies, framework-agnostic.
//
//   TTSQueue      — streaming phrase/sentence text-to-speech (markdown-stripped,
//                   voice-picked, mute-able).
//   STTController — push-to-talk + always-on speech-to-text with auto-restart and
//                   typed error kinds.
//
// aivideocall addition: TTSQueue.setCallbacks({ onSpeakStart, onSpeakEnd }) — an
// additive, optional hook so the host can suppress mic echo and sync captions
// around actual audio. It is a no-op unless callbacks are supplied, so the class
// still behaves identically to the widget original for any other consumer.

export const VOICE_DEFAULTS = {
  enabled: true,
  auto_speak: true,
  rate: 1.05,
  pitch: 1.0,
  volume: 1.0,
  voice_name: '',
  tts_lang: 'en-US',
  stt_lang: 'en-US',
  speak_mode: 'phrase', // "phrase" | "sentence"
};

// Phrase mode = type+speak in sync: split on any pause-worthy punctuation.
// Sentence mode = wait for full stop / question mark / newline.
const PHRASE_RE = /[.!?,;:\n]/;
const SENTENCE_RE = /[.!?\n]/;
const SOFT_FLUSH_AT = 80; // phrase mode: flush a phrase if no punctuation by here
const HARD_FLUSH_AT = 160; // sentence mode: never wait longer than this

function stripMarkdown(s) {
  return s
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    // Belt-and-braces: when streaming token-by-token, a phrase often flushes
    // before the closing markdown delimiter arrives, leaving stray symbols
    // that some TTS engines (Windows SAPI) read aloud as "asterisk", etc.
    // Strip any leftover markdown noise + leading bullet glyphs.
    .replace(/[*_`~#]+/g, '')
    .replace(/^\s*[-•·]+\s*/gm, '')
    .replace(/\s{2,}/g, ' ');
}

export function listVoices() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return [];
  return window.speechSynthesis.getVoices();
}

export function onVoicesReady(cb) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  const synth = window.speechSynthesis;
  if (synth.getVoices().length > 0) { cb(); return; }
  const handler = () => { cb(); synth.removeEventListener('voiceschanged', handler); };
  synth.addEventListener('voiceschanged', handler);
}

export class TTSQueue {
  constructor(initial) {
    this.buf = '';
    this.muted = false;
    this.settings = { ...VOICE_DEFAULTS };
    this.synth = typeof window !== 'undefined' ? window.speechSynthesis : null;

    // aivideocall addition — idle→speaking / speaking→idle notifications.
    this._cb = {};
    this._pending = 0;
    this._announcedSpeaking = false;

    if (initial) this.applySettings(initial);
  }

  // aivideocall addition — additive, optional. Pass { onSpeakStart, onSpeakEnd }.
  setCallbacks(cb) { this._cb = cb || {}; }

  isSupported() { return !!this.synth; }
  isMuted() { return this.muted; }
  isSpeaking() {
    if (!this.synth) return false;
    return this.synth.speaking || this.synth.pending || this.buf.length > 0;
  }

  setMuted(muted) {
    this.muted = muted;
    if (muted) this.cancel();
  }

  applySettings(patch) {
    this.settings = { ...this.settings, ...patch };
  }

  getSettings() { return { ...this.settings }; }

  enqueue(token) {
    if (!this.synth || this.muted || !token) return;
    this.buf += token;

    const boundaryRe = this.settings.speak_mode === 'sentence' ? SENTENCE_RE : PHRASE_RE;
    const softCap = this.settings.speak_mode === 'sentence' ? HARD_FLUSH_AT : SOFT_FLUSH_AT;

    while (true) {
      const m = this.buf.match(boundaryRe);
      if (m && m.index !== undefined) {
        const end = m.index + 1;
        const chunk = this.buf.slice(0, end).trim();
        this.buf = this.buf.slice(end);
        if (chunk) this.speakNow(chunk);
        continue;
      }
      if (this.buf.length >= softCap) {
        const cut = this.buf.lastIndexOf(' ', softCap);
        const at = cut > 30 ? cut : softCap;
        const chunk = this.buf.slice(0, at).trim();
        this.buf = this.buf.slice(at);
        if (chunk) this.speakNow(chunk);
        continue;
      }
      break;
    }
  }

  speak(text) {
    // One-shot speak (used by the "thinking" filler phrase).
    if (!this.synth) return;
    this.cancel();
    this.speakNow(text);
  }

  flush() {
    if (!this.synth || this.muted) { this.buf = ''; return; }
    const tail = this.buf.trim();
    this.buf = '';
    if (tail) this.speakNow(tail);
  }

  cancel() {
    this.buf = '';
    // Reset speaking bookkeeping silently — callers that barge in do their own
    // UI cleanup, and any late onend from cancelled utterances must not fire
    // onSpeakEnd (guarded by _announcedSpeaking below).
    this._pending = 0;
    this._announcedSpeaking = false;
    if (this.synth) { try { this.synth.cancel(); } catch { /* noop */ } }
  }

  pickVoice() {
    const voices = listVoices();
    if (voices.length === 0) return null;
    const wanted = this.settings.voice_name;
    if (wanted) {
      const exact = voices.find((v) => v.name === wanted);
      if (exact) return exact;
    }
    const lang = this.settings.tts_lang;
    const langMatch = voices.find((v) => v.lang === lang)
      || voices.find((v) => v.lang.toLowerCase().startsWith(lang.toLowerCase().split('-')[0]));
    return langMatch || null;
  }

  speakNow(text) {
    if (!this.synth) return;
    const clean = stripMarkdown(text).trim();
    if (!clean) return;
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = this.settings.tts_lang;
    u.rate = this.settings.rate;
    u.pitch = this.settings.pitch;
    u.volume = this.settings.volume;
    const v = this.pickVoice();
    if (v) u.voice = v;

    u.onstart = () => {
      if (!this._announcedSpeaking) {
        this._announcedSpeaking = true;
        try { this._cb.onSpeakStart && this._cb.onSpeakStart(); } catch { /* noop */ }
      }
    };
    const done = () => {
      this._pending = Math.max(0, this._pending - 1);
      if (this._pending === 0 && this.buf.length === 0 && this._announcedSpeaking) {
        this._announcedSpeaking = false;
        try { this._cb.onSpeakEnd && this._cb.onSpeakEnd(); } catch { /* noop */ }
      }
    };
    u.onend = done;
    u.onerror = done;

    this._pending += 1;
    try { this.synth.speak(u); } catch { this._pending = Math.max(0, this._pending - 1); }
  }
}

// ---------------------------------------------------------------------------

function getRecognitionCtor() {
  if (typeof window === 'undefined') return null;
  const w = window;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export async function isBraveBrowser() {
  try {
    const nav = navigator;
    if (nav?.brave?.isBrave) return !!(await nav.brave.isBrave());
  } catch { /* noop */ }
  return false;
}

export class STTController {
  constructor() {
    this.rec = null;
    this.running = false;
    this.finalText = '';
    this.alwaysOn = false;
    this.stopRequested = false;
    this.lastOpts = null;
    this.restartTimer = null;
  }

  static isSupported() { return !!getRecognitionCtor(); }

  isRunning() { return this.running; }
  isAlwaysOn() { return this.alwaysOn; }

  start(opts) {
    const Ctor = getRecognitionCtor();
    if (!Ctor) { opts.onError('unsupported'); return; }
    if (this.running) return;

    this.alwaysOn = !!opts.alwaysOn;
    this.stopRequested = false;
    this.lastOpts = opts;

    const rec = new Ctor();
    rec.lang = opts.lang || 'en-US';
    rec.continuous = !!opts.alwaysOn;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    this.finalText = '';

    rec.onspeechstart = () => {
      try { opts.onSpeechStart?.(); } catch { /* noop */ }
    };

    rec.onresult = (ev) => {
      let interim = '';
      let finalChunk = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        const t = r[0]?.transcript || '';
        if (r.isFinal) finalChunk += t;
        else interim += t;
      }
      if (finalChunk) {
        this.finalText += finalChunk;
        if (this.alwaysOn) {
          const finalSoFar = this.finalText.trim();
          this.finalText = '';
          if (finalSoFar) opts.onFinal(finalSoFar);
          return;
        }
      }
      const live = (this.finalText + interim).trim();
      if (live) opts.onInterim(live);
    };

    rec.onerror = (ev) => {
      const code = ev?.error || 'error';
      // In always-on mode, no-speech fires constantly during silence — swallow it.
      if (code === 'no-speech') {
        if (!this.alwaysOn) opts.onError('no-speech');
        return;
      }
      if (code === 'not-allowed' || code === 'service-not-allowed') opts.onError('denied', code);
      else if (code === 'network') opts.onError('network', code);
      else if (code === 'aborted') { /* deliberate abort, ignore */ }
      else opts.onError('error', code);
    };

    rec.onend = () => {
      this.running = false;
      this.rec = null;
      const final = this.finalText.trim();
      this.finalText = '';
      if (final && !this.alwaysOn) opts.onFinal(final);
      // Auto-restart in always-on mode unless caller explicitly stopped.
      if (this.alwaysOn && !this.stopRequested) {
        this.restartTimer = window.setTimeout(() => {
          this.restartTimer = null;
          if (this.alwaysOn && !this.stopRequested && this.lastOpts) {
            this.start(this.lastOpts);
          }
        }, 150);
        return;
      }
      opts.onEnd();
    };

    try {
      rec.start();
      this.rec = rec;
      this.running = true;
    } catch (e) {
      opts.onError('error', String(e));
    }
  }

  stop() {
    this.stopRequested = true;
    this.alwaysOn = false;
    if (this.restartTimer !== null) {
      window.clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.rec && this.running) { try { this.rec.stop(); } catch { /* noop */ } }
  }

  abort() {
    this.stopRequested = true;
    this.alwaysOn = false;
    if (this.restartTimer !== null) {
      window.clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.rec && this.running) { try { this.rec.abort(); } catch { /* noop */ } }
    this.running = false;
    this.rec = null;
  }
}
