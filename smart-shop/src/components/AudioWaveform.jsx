import React, { useRef, useEffect, useState } from 'react';

export default function AudioWaveform({ volume, isAgentSpeaking, isUserSpeaking, theme = '#6366f1' }) {
  const containerRef = useRef(null);
  const [barCount, setBarCount] = useState(30);
  const animFrameRef = useRef(null);
  const [heights, setHeights] = useState([]);

  const safeVolume = Math.min(Math.max(volume || 0, 0), 1);
  const isActive = isAgentSpeaking || isUserSpeaking;
  const barColor = isUserSpeaking ? theme : '#9ca3af';

  // Dynamically calculate number of bars based on container width
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const width = el.offsetWidth;
      const count = Math.max(10, Math.floor(width / 6)); // 1 bar per 6px
      setBarCount(count);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Animate heights using requestAnimationFrame for smooth live motion
  useEffect(() => {
    let frame;
    const animate = () => {
      const now = Date.now();
      const newHeights = Array.from({ length: barCount }, (_, i) => {
        if (!isActive) return 15;
        // Each bar gets a unique sine wave based on its index + time
        const wave1 = Math.sin(now / 120 + i * 0.5) * 0.5 + 0.5;
        const wave2 = Math.sin(now / 80 + i * 0.8) * 0.3 + 0.3;
        // Center bars get a multiplier to create the classic mountain shape
        const centerWeight = 1 - Math.abs((i / barCount) - 0.5) * 1.4;
        const combined = (wave1 * 0.6 + wave2 * 0.4) * Math.max(0.1, centerWeight);
        return 10 + combined * safeVolume * 90;
      });
      setHeights(newHeights);
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [isActive, safeVolume, barCount]);

  return (
    <div
      ref={containerRef}
      className="flex items-center w-full h-full gap-[2px] px-1"
    >
      {heights.map((h, i) => (
        <div
          key={i}
          className="flex-1 rounded-full transition-none"
          style={{
            height: `${Math.min(h, 100)}%`,
            minHeight: '3px',
            backgroundColor: barColor,
            opacity: isActive ? 0.75 + safeVolume * 0.25 : 0.3,
          }}
        />
      ))}
    </div>
  );
}
