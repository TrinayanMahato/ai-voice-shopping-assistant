// One-time "tap to start" gate shown on mobile before the demo begins.
//
// Browsers refuse to enter fullscreen without a user gesture, so we can't
// collapse the address bar at load time. This overlay turns the user's very
// first interaction into that gesture: tapping it requests fullscreen (the same
// proven click→requestFullscreen path as the control-bar button) and then
// dismisses, revealing the already-fullscreen experience underneath.
export default function FullscreenGate({ theme, onTheme, brandLogo, displayName, onStart }) {
  return (
    <div
      onClick={onStart}
      role="button"
      tabIndex={0}
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-6 px-8 text-center cursor-pointer select-none"
      style={{ background: '#0d0d1a' }}
    >
      {/* Brand mark */}
      {brandLogo ? (
        <img
          src={brandLogo}
          alt={displayName}
          className="h-16 w-16 rounded-2xl object-contain bg-white/10 p-2"
        />
      ) : (
        <span
          className="h-16 w-16 rounded-2xl flex items-center justify-center"
          style={{ background: theme }}
        >
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={onTheme || '#fff'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </span>
      )}

      <div>
        <p className="text-white text-[20px] font-bold tracking-tight">{displayName}</p>
        <p className="text-white/60 text-[14px] mt-1">Tap anywhere to start your AI demo</p>
      </div>

      {/* Pulsing CTA — reinforces that a tap is required to go full-screen */}
      <span
        className="mt-1 inline-flex items-center gap-2 px-6 py-3 rounded-full font-bold text-[15px] shadow-lg animate-pulse"
        style={{ background: theme, color: onTheme || '#fff' }}
      >
        Tap to start
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h14" /><path d="M13 6l6 6-6 6" />
        </svg>
      </span>
    </div>
  );
}
