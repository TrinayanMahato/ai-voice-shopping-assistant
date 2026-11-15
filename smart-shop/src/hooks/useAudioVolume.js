import { useState, useEffect, useRef } from 'react';

/**
 * A hook that takes a MediaStreamTrack (audio) and returns a smoothed volume
 * value between 0.0 and 1.0 using the Web Audio API.
 * 
 * @param {MediaStreamTrack} track - The audio track to analyze.
 * @param {boolean} isActive - If false, halts processing to save CPU.
 * @returns {number} The current volume level (0.0 to 1.0).
 */
export function useAudioVolume(track, isActive = true) {
  const [volume, setVolume] = useState(0);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const sourceRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    if (!track || !isActive) {
      setVolume(0);
      return;
    }

    // Initialize Web Audio API
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    try {
      const audioCtx = new AudioContext();
      audioContextRef.current = audioCtx;
      
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8; // Smooth out jittery volume changes
      analyserRef.current = analyser;

      const mediaStream = new MediaStream([track]);
      const source = audioCtx.createMediaStreamSource(mediaStream);
      source.connect(analyser);
      sourceRef.current = source;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const updateVolume = () => {
        if (!analyserRef.current) return;
        
        analyser.getByteFrequencyData(dataArray);
        
        // Calculate average volume across all frequencies
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        
        const average = sum / dataArray.length;
        // Normalize to 0.0 - 1.0 based on a max value of 255
        // We boost it slightly (* 1.5) so quiet voices still animate well
        const normalized = Math.min((average / 255) * 1.5, 1.0);
        
        setVolume(normalized);
        rafRef.current = requestAnimationFrame(updateVolume);
      };

      updateVolume();
    } catch (err) {
      console.warn("Failed to initialize audio visualizer:", err);
    }

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      if (sourceRef.current) {
        sourceRef.current.disconnect();
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, [track, isActive]);

  return volume;
}
