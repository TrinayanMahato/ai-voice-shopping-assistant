import React from 'react';

/**
 * A ChatGPT-style audio visualizer that renders a sleek, organic glowing orb.
 * It scales and morphs its shape dynamically based on the current volume level.
 */
export default function AudioOrb({ volume, isAgentSpeaking, isUserSpeaking, theme = '#6366f1' }) {
  // Ensure volume is clamped between 0 and 1 just in case
  const safeVolume = Math.min(Math.max(volume || 0, 0), 1);
  
  // Base scale. The volume determines how much it expands.
  const scale = 1 + (safeVolume * 0.9); // Expands up to 1.9x its original size
  
  // Create a blob effect that becomes more pronounced at higher volumes
  const isActive = isAgentSpeaking || isUserSpeaking;
  const isPulsing = isActive && safeVolume > 0.05;
  
  // Morphing border radius to give it an organic "blob" feel like ChatGPT
  const borderRadius = isPulsing 
    ? '40% 60% 70% 30% / 40% 50% 60% 50%'
    : '50%';
    
  // The orb is black for the AI (like ChatGPT) and uses the theme color for the user
  const baseColor = isUserSpeaking ? theme : '#111827';
    
  return (
    <div className="flex flex-col items-center justify-center gap-10 w-full animate-fadein">
      <div 
        className="relative flex items-center justify-center"
        style={{ width: '90px', height: '90px' }}
      >
        {/* Outer glowing aura that reacts heavily to volume */}
        <div 
          className="absolute inset-0 transition-all duration-75 ease-out"
          style={{
            background: baseColor,
            transform: `scale(${scale})`,
            borderRadius: borderRadius,
            opacity: isPulsing ? 0.4 + (safeVolume * 0.3) : 0.2,
            filter: `blur(${4 + (safeVolume * 10)}px)`,
          }}
        />
        
        {/* Mid-layer shape shifter */}
        <div 
          className="absolute inset-0 transition-all duration-100 ease-out"
          style={{
            background: baseColor,
            transform: `scale(${1 + safeVolume * 0.5})`,
            borderRadius: isPulsing ? '60% 40% 50% 50% / 50% 50% 60% 40%' : '50%',
            opacity: isPulsing ? 0.7 : 0.4,
          }}
        />

        {/* Core solid circle to anchor it visually */}
        <div 
          className="absolute inset-0 transition-all duration-300 ease-out shadow-lg"
          style={{
            background: baseColor,
            transform: `scale(${1 + safeVolume * 0.1})`,
            borderRadius: '50%',
          }}
        />
      </div>
      
      {/* Optional status text below the orb */}
      <div className="text-gray-400 text-[13px] font-medium tracking-widest uppercase flex items-center gap-2">
        {isUserSpeaking ? (
          <span className="flex items-center gap-2" style={{ color: theme }}>
            <span className="w-1.5 h-1.5 rounded-full bg-current animate-ping" />
            Listening
          </span>
        ) : isAgentSpeaking ? (
          'Speaking'
        ) : (
          'Ready'
        )}
      </div>
    </div>
  );
}
