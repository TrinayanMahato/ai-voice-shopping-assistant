import { toRgba } from '../utils/color';

// ─────────────────────────────────────────────────────────────────────────────
// AI Agent Tile — shown in grid when ai-tutor joins
// ─────────────────────────────────────────────────────────────────────────────
export default function AIAgentTile({ isSpeaking, theme, logo, name = 'Assistant' }) {
  const themeColor = theme || '#6366f1';
  return (
    <div className="w-full h-full video-card group relative bg-[#0d0d1a] rounded-[16px] overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.25)] transition-all duration-300 flex flex-col items-center justify-center"
      style={{ border: `1px solid ${toRgba(themeColor, 0.35)}` }}>
      {/* Animated background glow */}
      <div className={`absolute inset-0 transition-opacity duration-500 ${isSpeaking ? 'opacity-100' : 'opacity-40'}`}
        style={{ background: `radial-gradient(ellipse at 50% 45%, ${toRgba(themeColor, 0.22)} 0%, transparent 70%)` }} />

      {/* Pulse rings when speaking */}
      {isSpeaking && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="absolute w-[120%] aspect-square rounded-full animate-ping" style={{ border: `1px solid ${toRgba(themeColor, 0.4)}`, animationDuration: '1.2s' }} />
          <div className="absolute w-[160%] aspect-square rounded-full animate-ping" style={{ border: `1px solid ${toRgba(themeColor, 0.2)}`, animationDuration: '1.6s', animationDelay: '0.2s' }} />
        </div>
      )}

      {/* Center content */}
      <div className="relative flex flex-col items-center justify-center w-full h-full gap-1 min-[1200px]:gap-3 z-10 px-1">
        {/* Avatar — store logo if available, otherwise a shopping-bag glyph */}
        <div className={`w-[80%] min-[1200px]:w-[35%] max-w-[74px] aspect-square rounded-full flex items-center justify-center overflow-hidden shadow-[0_8px_24px_rgba(0,0,0,0.35)] transition-transform duration-300 ${isSpeaking ? 'scale-110' : 'scale-100'}`}
          style={{ background: `linear-gradient(135deg, ${themeColor}, ${toRgba(themeColor, 0.75)})` }}>
          {logo ? (
            <img src={logo} alt={name} className="w-[75%] h-[75%] object-contain" />
          ) : (
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-[50%] h-[50%]">
              <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <path d="M16 10a4 4 0 0 1-8 0" />
            </svg>
          )}
        </div>

        <div className="hidden min-[1200px]:block text-white text-[15px] font-bold tracking-tight text-center leading-tight px-1 line-clamp-1">{name}</div>

        {/* Status line */}
        <div className="hidden min-[1200px]:block text-[12px] font-semibold" style={{ color: toRgba(themeColor, 0.95) }}>
          {isSpeaking ? 'Speaking…' : 'Listening…'}
        </div>
      </div>

      {/* AI badge top-right */}
      <div className="absolute top-[12px] right-[12px] text-[9px] font-extrabold px-[8px] py-[3px] rounded-[6px] tracking-[0.08em] uppercase z-10"
        style={{ background: toRgba(themeColor, 0.18), border: `1px solid ${toRgba(themeColor, 0.35)}`, color: 'white' }}>
        AI
      </div>
    </div>
  );
}
