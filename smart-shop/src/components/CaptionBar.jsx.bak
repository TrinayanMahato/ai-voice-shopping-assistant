// ─────────────────────────────────────────────────────────────────────────────
// CaptionBar — live subtitle strip shown in the center column, just above the
// suggestion chips. Displays whatever is being spoken right now: the user's live
// speech (interim STT) or the AI's answer as it streams. Renders nothing when idle.
// ─────────────────────────────────────────────────────────────────────────────
export default function CaptionBar({ caption, compact = false }) {
  if (!caption || !caption.text) return null;
  return (
    <div className={`shrink-0 ${compact ? 'px-3 pb-1' : 'px-8 pb-1.5'}`}>
      <div className={`flex items-start gap-2 rounded-[10px] bg-gray-900/85 text-white shadow-sm animate-scale-in ${compact ? 'px-2.5 py-1.5' : 'px-4 py-2'}`}>
        <span className={`shrink-0 mt-[2px] font-extrabold uppercase tracking-wider text-white/50 ${compact ? 'text-[8px]' : 'text-[9px]'}`}>
          {caption.who}
        </span>
        <span className={`leading-snug line-clamp-2 ${compact ? 'text-[11px]' : 'text-[13px]'}`}>
          {caption.text}
        </span>
      </div>
    </div>
  );
}
