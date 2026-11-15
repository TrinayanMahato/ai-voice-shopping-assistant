import { useEffect, useRef, useState } from 'react';
import { MicVAD } from '@ricky0123/vad-web';

export function useMuteReminderVAD({ phase, isMicOn }) {
  const [showMuteReminder, setShowMuteReminder] = useState(false);
  const vadRef = useRef(null);
  const isMicOnRef = useRef(isMicOn);
  const hideTimerRef = useRef(null);
  const audioCtxRef = useRef(null);

  // Keep ref in sync so the VAD callback has the latest value
  useEffect(() => {
    isMicOnRef.current = isMicOn;
    // If mic turns on, immediately hide the reminder
    if (isMicOn) {
      setShowMuteReminder(false);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    }
  }, [isMicOn]);

  useEffect(() => {
    // Only run this background VAD when connected to a room
    if (phase !== 'connected') return;

    let cancelled = false;

    const initVAD = async () => {
      try {
        console.log('[MuteReminderVAD] Initializing VAD...');
        
        // Create AudioContext explicitly to avoid autoplay suspension after async model loading
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        const ctx = new AudioContext();
        audioCtxRef.current = ctx;
        if (ctx.state === 'suspended') {
          await ctx.resume();
        }

        const vad = await MicVAD.new({
          audioContext: ctx,
          baseAssetPath: "/",
          onnxWASMBasePath: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/",
          positiveSpeechThreshold: 0.8,
          negativeSpeechThreshold: 0.4,
          minSpeechMs: 250,
          preSpeechPadMs: 250,
          redemptionMs: 900,
          onSpeechRealStart: () => {
            console.log('[MuteReminderVAD] Speech detected! isMicOn:', isMicOnRef.current);
            // Speech detected!
            if (!isMicOnRef.current) {
              console.log('[MuteReminderVAD] Showing tooltip!');
              setShowMuteReminder(true);
              
              // Hide it automatically after 4 seconds
              if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
              hideTimerRef.current = setTimeout(() => {
                setShowMuteReminder(false);
              }, 4000);
            }
          },
          onVADMisfire: () => {
            console.log('[MuteReminderVAD] VAD misfire (ignored)');
          }
        });

        if (cancelled) {
          vad.destroy();
          return;
        }

        vadRef.current = vad;
        vad.start();
      } catch (err) {
        console.error('[MuteReminderVAD] Failed to initialize:', err);
      }
    };

    initVAD();

    return () => {
      cancelled = true;
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      vadRef.current?.destroy();
      vadRef.current = null;
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(console.error);
        audioCtxRef.current = null;
      }
    };
  }, [phase]);

  return showMuteReminder;
}
