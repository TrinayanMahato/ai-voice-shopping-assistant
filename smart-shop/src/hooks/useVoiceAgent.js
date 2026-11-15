import { useEffect, useRef, useState } from 'react';
import { TTSQueue, STTController, onVoicesReady } from '../speech';

// ── Pipeline switch ────────────────────────────────────────────────────────────
// false → use the agent's server-side Whisper STT + Silero VAD (recommended).
//         The browser SpeechRecognition, @ricky0123/vad-web, and browser TTS are
//         all disabled. The mic audio track is published to LiveKit and the agent
//         transcribes it server-side. Agent TTS plays back via the LiveKit audio track.
// true  → legacy browser-only pipeline (browser STT + browser VAD + browser TTS).
const USE_BROWSER_STT_VAD = false;

// NOTE: don't bother setting env.wasm.wasmPaths here — MicVAD.new() overwrites it
// with its `onnxWASMBasePath` option right before loading the model. That option is
// set to '/' at the call site so ORT loads the .wasm + .mjs glue from /public.

export function useVoiceAgent({ roomRef, phase, isMicOn, setChatMessages, agentIdentity = 'ai-tutor' }) {
  // Browser-native speech engine (ported from the SMART widget's speech.ts).
  // TTSQueue = phrase-streamed, markdown-stripped text-to-speech.
  // STTController = always-on speech-to-text with auto-restart.
  const ttsRef = useRef(null);
  const sttRef = useRef(null);
  const vadRef = useRef(null);

  const isMicOnRef = useRef(isMicOn);
  const phaseRef = useRef(phase);
  const agentIdentityRef = useRef(agentIdentity);

  // Single source of truth for "is the agent doing anything for me right now"
  const isAgentBusyRef = useRef(false);
  const isAgentSpeakingRef = useRef(false);

  // What the TTS engine is currently voicing, so onSpeakEnd knows whether to
  // release "busy" (real answer) or just "speaking" (thinking filler).
  const ttsPurposeRef = useRef('answer');
  const lastAnswerRef = useRef('');

  const vadHadSpeechRef = useRef(false);
  const vadHadSpeechTimeoutRef = useRef(null);
  // True only once the VAD engine actually initialised. When it fails to load
  // (e.g. the ORT wasm 404s), we must NOT gate sends on VAD corroboration —
  // otherwise every transcript is silently dropped and nothing reaches the agent.
  const vadReadyRef = useRef(false);

  // Drives the word-by-word ("typewriter") reveal of the agent's spoken answer.
  const agentStreamTimerRef = useRef(null);

  const [isAgentThinking, setIsAgentThinking] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  // Live rolling caption of the AI's current speech (last few spoken words only).
  const [agentCaption, setAgentCaption] = useState('');

  useEffect(() => { isMicOnRef.current = isMicOn; }, [isMicOn]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { agentIdentityRef.current = agentIdentity; }, [agentIdentity]);

  // Stop the rolling caption reveal and clear the live caption. The transcript
  // itself already holds the full answer (pushed at once in handleAgentAnswer),
  // so there's nothing to finalize there. Declared up here so the VAD interrupt
  // handler (below) can call it.
  const stopAgentStream = () => {
    if (agentStreamTimerRef.current) {
      clearInterval(agentStreamTimerRef.current);
      agentStreamTimerRef.current = null;
    }
    setAgentCaption('');   // AI stopped speaking → clear the live caption
  };

  // ---------------------------------------------------------------------
  // 0. Speech engine (TTS) — one instance for the hook's lifetime.
  //    The onSpeak* callbacks keep isAgentSpeakingRef accurate so STT can
  //    suppress echo, and finalize the caption when real speech ends.
  // ---------------------------------------------------------------------
  useEffect(() => {
    const tts = new TTSQueue({ tts_lang: 'en-US', rate: 1.0 });
    tts.setCallbacks({
      onSpeakStart: () => {
        isAgentSpeakingRef.current = true;
        isAgentBusyRef.current = true;
      },
      onSpeakEnd: () => {
        isAgentSpeakingRef.current = false;
        // Filler ("thinking") speech ending must NOT clear busy — the real
        // answer may still be on its way. Only a finished answer releases busy.
        if (ttsPurposeRef.current === 'answer') {
          isAgentBusyRef.current = false;
          stopAgentStream();   // speech done → clear the live caption
        }
      },
    });
    // Voices load async in most browsers — re-pick once they're available.
    onVoicesReady(() => tts.applySettings({}));
    ttsRef.current = tts;
    return () => { try { tts.cancel(); } catch { /* noop */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------
  // 1. Speech-to-text (STTController) — one instance for the hook's lifetime.
  // ---------------------------------------------------------------------
  // Final transcript handler, gated by the same trust rules as before:
  //   - drop anything captured while the agent is speaking (echo)
  //   - drop anything the VAD did not corroborate as real speech
  const handleFinalTranscript = async (rawText) => {
    setInterimTranscript('');
    const finalText = (rawText || '').trim();
    if (!finalText) return;

    if (isAgentSpeakingRef.current || ttsRef.current?.isSpeaking()) {
      console.log('[STT] Discarding result — agent is actively speaking (preventing echo):', finalText);
      return;
    }
    // Only enforce VAD corroboration when the VAD is actually running. If it
    // failed to initialise, fall back to trusting the STT so speech still sends.
    if (vadReadyRef.current && !vadHadSpeechRef.current) {
      console.log('[STT] Discarding result — no VAD speech detected recently:', finalText);
      return;
    }

    // Genuine customer speech

    setChatMessages((prev) => [...prev, { sender: 'user', text: finalText, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }]);

    if (roomRef.current) {
      try {
        const encoder = new TextEncoder();
        const data = encoder.encode(JSON.stringify({ text: finalText }));
        await roomRef.current.localParticipant.publishData(data, {
          reliable: true,
          topic: 'user-input',
        });
        console.log('[STT] Transmitted to data channel (user-input):', finalText);
      } catch (err) {
        console.error('[STT] Failed to publish data:', err);
      }
    }
  };

  useEffect(() => {
    const stt = new STTController();
    sttRef.current = stt;
    return () => { try { stt.abort(); } catch { /* noop */ } };
  }, []);

  // Start/stop browser recognition with mic + connection state.
  // Only active when USE_BROWSER_STT_VAD is true — when false the agent's
  // server-side Whisper STT processes the LiveKit audio track instead.
  useEffect(() => {
    if (!USE_BROWSER_STT_VAD) return;
    const stt = sttRef.current;
    if (!stt) return;

    if (phase === 'connected' && isMicOn) {
      if (!STTController.isSupported()) {
        console.warn('[STT] SpeechRecognition API is not supported in this browser.');
        return;
      }
      if (stt.isRunning()) return;
      stt.start({
        lang: 'en-US',
        alwaysOn: true,
        onInterim: (text) => setInterimTranscript(text),
        onFinal: (text) => handleFinalTranscript(text),
        onSpeechStart: () => {},
        onError: (kind, detail) => {
          if (kind === 'no-speech' || kind === 'aborted') return;
          console.error('[STT] Speech recognition error:', kind, detail || '');
        },
        onEnd: () => setInterimTranscript(''),
      });
    } else {
      stt.stop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, isMicOn]);

  // ---------------------------------------------------------------------
  // 2. VAD — gatekeeper for STT trust + interruption trigger
  // Only active when USE_BROWSER_STT_VAD is true — when false the agent's
  // server-side Silero VAD handles interrupts and speech detection.
  // The agent sends {"status": "interrupted"} via agent-ui when it cancels,
  // which clears the thinking state on the frontend automatically.
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (!USE_BROWSER_STT_VAD) return;
    let cancelled = false;

    const initVAD = async () => {
      try {
        const vadInstance = await MicVAD.new({
          // VAD worklet + silero onnx live in public/, served from the site root.
          baseAssetPath: "/",
          // vad-web overwrites ort.env.wasm.wasmPaths with THIS value right before loading
          // the model. It can't point at /public: ORT loads the .mjs glue via a dynamic
          // import(), and Vite's dev server refuses to serve /public files as modules
          // ("can only be referenced via HTML tags"). Load the .wasm + .mjs glue from a
          // CDN pinned to our exact onnxruntime-web version instead — works in dev & prod.
          onnxWASMBasePath: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/",
          // ── Sensitivity tuning ─────────────────────────────────────────────
          // High confidence bar so only a real, close-mic human voice barges in —
          // faint background noise and the AI's own (echo-cancelled, attenuated)
          // voice bleeding back through the speakers stay under the threshold.
          positiveSpeechThreshold: 0.85,
          negativeSpeechThreshold: 0.5,
          // NOTE: this vad-web (0.0.30) takes *Ms* options, not *Frames*. The
          // previous minSpeechFrames/preSpeechPadFrames/redemptionFrames keys were
          // silently ignored (wrong names) so the VAD ran on library defaults.
          // Require ~300ms of sustained speech before it counts as real — a single
          // syllable / cough / click no longer qualifies.
          minSpeechMs: 300,
          preSpeechPadMs: 300,
          redemptionMs: 900,
          // getStream is left at the library default, which already requests
          // echoCancellation + noiseSuppression + autoGainControl on the mic —
          // the first line of defence against picking up the AI's own voice.

          onSpeechStart: () => {
            // First frame over threshold — NOT confirmed speech yet. Only use it
            // as a loose corroboration signal for the STT trust gate; the actual
            // barge-in is deferred to onSpeechRealStart (below) so a brief noise
            // burst or the AI's own voice can't cut it off.
            console.log('[VAD] speech start detected (tentative)');
            vadHadSpeechRef.current = true;
            if (vadHadSpeechTimeoutRef.current) {
              clearTimeout(vadHadSpeechTimeoutRef.current);
              vadHadSpeechTimeoutRef.current = null;
            }
          },

          // Fires only after the segment exceeds minSpeechMs — i.e. the customer
          // is genuinely speaking, not a click/cough. This is the real barge-in.
          onSpeechRealStart: () => {
            console.log('[VAD] real speech start confirmed');

            // Fire interrupt whenever the agent is busy — thinking OR speaking
            if (isAgentBusyRef.current) {
              console.log('[VAD] Interrupting active agent (busy/speaking)...');
              ttsRef.current?.cancel();
              isAgentSpeakingRef.current = false;
              isAgentBusyRef.current = false;
              setIsAgentThinking(false);
              stopAgentStream();   // freeze the caption at whatever was revealed

              if (roomRef.current) {
                console.log('[VAD] Interrupt detected — agent was interrupted by user speech.');
              }
            }
          },

          onSpeechEnd: () => {
            console.log('[VAD] speech end detected');
            vadHadSpeechTimeoutRef.current = setTimeout(() => {
              vadHadSpeechRef.current = false;
            }, 12000);
          },

          onVADMisfire: () => {
            console.log('[VAD] misfire — ignoring noise burst');
            vadHadSpeechRef.current = false;
          },
        });

        if (cancelled) {
          vadInstance.destroy();
          return;
        }
        vadRef.current = vadInstance;
        vadReadyRef.current = true;
        vadInstance.start();
      } catch (err) {
        vadReadyRef.current = false;
        console.error('[VAD] Failed to initialize MicVAD:', err);
      }
    };

    if (phase === 'connected' && isMicOn) {
      initVAD();
    }

    return () => {
      cancelled = true;
      if (vadHadSpeechTimeoutRef.current) clearTimeout(vadHadSpeechTimeoutRef.current);
      vadRef.current?.destroy();
      vadRef.current = null;
      vadReadyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, isMicOn, roomRef]);

  // ---------------------------------------------------------------------
  // 3. Status updates from the agent ("thinking" / "error")
  // ---------------------------------------------------------------------
  const setAgentStatus = (status, fillerText) => {
    if (status === 'thinking') {
      // A new question is being processed — always kill any running subtitle stream first.
      // This covers the audio-interrupt case where the 'thinking' signal from the new turn
      // arrives BEFORE the async 'interrupted' signal from the previous turn.
      stopAgentStream();
      isAgentBusyRef.current = true;
      setIsAgentThinking(true);

      // Browser TTS filler only in legacy browser pipeline.
      // In server-side mode the agent speaks the filler via LiveKit audio.
      if (USE_BROWSER_STT_VAD && fillerText && ttsRef.current?.isSupported()) {
        ttsPurposeRef.current = 'filler';
        ttsRef.current.speak(fillerText);
      }
    } else if (status === 'error') {
      isAgentBusyRef.current = false;
      isAgentSpeakingRef.current = false;
      setIsAgentThinking(false);
      if (USE_BROWSER_STT_VAD) ttsRef.current?.cancel();
    } else if (status === 'answering') {
      setIsAgentThinking(false);
    }
  };

  // ---------------------------------------------------------------------
  // 4. Incoming agent answer -> stream as a caption + speak via TTSQueue
  // ---------------------------------------------------------------------
  const handleAgentAnswer = (answerText) => {
    setIsAgentThinking(false);
    stopAgentStream();   // stop any previous caption reveal before starting a new one

    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    // Update the streaming message with the final text if it exists, otherwise add a new message
    setChatMessages((prev) => {
      const newArr = [...prev];
      const lastMsg = newArr[newArr.length - 1];
      if (lastMsg && lastMsg.sender === 'agent' && lastMsg.isStreaming) {
        lastMsg.text = String(answerText);
        lastMsg.isStreaming = false;
        return newArr;
      }
      return [...prev, { sender: 'agent', text: String(answerText), time }];
    });

    // Only the live caption reveals word-by-word, rolling in step with the speech.
    const words = String(answerText).split(/\s+/).filter(Boolean);
    let i = 0;
    const revealStep = () => {
      i += 1;
      // Show up to the last 25 words to fill a fixed-width 2-line box comfortably
      setAgentCaption(words.slice(Math.max(0, i - 25), i).join(' '));
      if (i >= words.length && agentStreamTimerRef.current) {
        clearInterval(agentStreamTimerRef.current);
        agentStreamTimerRef.current = null;
        // Clear the subtitle box shortly after the stream ends
        setTimeout(() => {
          if (!agentStreamTimerRef.current) {
            setAgentCaption('');
          }
        }, 1500);
      }
    };

    // Slower streaming speed (~2.2 words/sec) so it is easier to read
    if (words.length > 0) {
      agentStreamTimerRef.current = setInterval(revealStep, 450);
    }

    if (USE_BROWSER_STT_VAD) {
      // Legacy browser TTS path — speaks the answer locally.
      lastAnswerRef.current = answerText;
      ttsPurposeRef.current = 'answer';
      const tts = ttsRef.current;
      if (!tts || !tts.isSupported()) {
        isAgentBusyRef.current = false;
        return;
      }
      tts.cancel();
      tts.enqueue(answerText);
      tts.flush();
      if (!tts.isSpeaking()) {
        isAgentSpeakingRef.current = false;
        isAgentBusyRef.current = false;
        stopAgentStream();
      }
    } else {
      // Server-side TTS path — agent speaks via LiveKit audio track.
      // Release busy immediately (no browser onSpeakEnd will fire).
      isAgentBusyRef.current = false;
      isAgentSpeakingRef.current = false;
    }
  };

  return {
    isAgentThinking,
    setAgentStatus,
    handleAgentAnswer,
    stopAgentStream,
    interimTranscript,
    agentCaption,
  };
}
