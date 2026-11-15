import { toRgba } from '../utils/color';

// ─────────────────────────────────────────────────────────────────────────────
// WelcomeScreen — branded placeholder shown in the meeting's center product
// area while no products have been shared yet. Fills its (relative) parent.
//
// Soft light gradient + decorative waves and a curved accent line, a themed
// brand badge and a "Welcome to {brand} AI" headline. Fully responsive
// (clamp-based type scale) so it reads well on both phones and laptops.
// ─────────────────────────────────────────────────────────────────────────────
export default function WelcomeScreen({
  theme = '#2563eb',
  onTheme = '#ffffff',
  displayName = 'Foxin',
  welcomeImage = '',
  annotations = [],
}) {
  const brandTitle = `${displayName} AI`;

  // ── Store-provided hero (welcome_image_url) ───────────────────────────────────
  // When the /store API supplies a welcome image, show it clean and full-bleed —
  // the welcome copy lives in the transcript panel, not on top of the image.
  // Falls back to the decorative screen below when no image is configured.
  if (welcomeImage) {
    return (
      <div className="relative w-full h-full overflow-hidden rounded-xl sm:rounded-2xl bg-[#f8fafd] flex items-center justify-center">
        {/* Ambient background filling the entire div so there is zero white space or border */}
        <img
          src={welcomeImage}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover blur-2xl opacity-60 scale-110 pointer-events-none select-none"
        />
        
        {/* Aspect Ratio Preserving Container for Accurate Overlay Coordinates */}
        <div className="relative transition-all duration-700 ease-in-out w-full h-full flex items-center justify-center overflow-hidden z-10">
          <img
            src={welcomeImage}
            alt={displayName}
            className="block max-w-full max-h-full w-full h-full object-contain object-center drop-shadow-sm"
          />

          {/* Annotations */}
          {annotations && annotations.length > 0 && annotations.map((ann, i) => {
            const params = ann.media_params;
            if (!params || !params.image || !params.image.width || !params.image.height) return null;
            
            const imgWidth = params.image.width;
            const imgHeight = params.image.height;
            
            const centerLeft = (params.center.x / imgWidth) * 100;
            const centerTop = (params.center.y / imgHeight) * 100;
            
            const bboxLeft = (params.bbox.x / imgWidth) * 100;
            const bboxTop = (params.bbox.y / imgHeight) * 100;
            const bboxWidth = (params.bbox.width / imgWidth) * 100;
            const bboxHeight = (params.bbox.height / imgHeight) * 100;

            return (
              <div key={i} className="contents">
                {/* Bounding Box */}
                <div
                  className="absolute rounded-[4px] pointer-events-none transition-all duration-300 border-[1.5px] border-black/10"
                  style={{
                    left: `${bboxLeft}%`,
                    top: `${bboxTop}%`,
                    width: `${bboxWidth}%`,
                    height: `${bboxHeight}%`,
                  }}
                />
                {/* Center Dot Hotspot */}
                <div 
                  className="absolute z-10 w-[24px] h-[24px] flex items-center justify-center group/spot"
                  style={{
                    left: `${centerLeft}%`,
                    top: `${centerTop}%`,
                    transform: 'translate(-50%, -50%)',
                  }}
                >
                  <div className="w-[6px] h-[6px] rounded-full bg-[#6366f1] shadow-[0_0_10px_rgba(99,102,241,0.5)] transition-all duration-300 group-hover/spot:scale-[1.8]" />
                  <div className="absolute inset-0 rounded-full border border-[#6366f1] transition-all duration-300 scale-50 opacity-0 group-hover/spot:scale-100 group-hover/spot:opacity-100" />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full overflow-hidden rounded-2xl flex items-center justify-center bg-gradient-to-b from-white via-[#f7f9fe] to-[#e9eefb]">

      {/* ── Decorative curved accent line + dot (right side) ─────────────── */}
      <svg
        className="pointer-events-none absolute inset-y-0 right-0 h-full w-[58%] max-w-[720px]"
        viewBox="0 0 600 700"
        fill="none"
        preserveAspectRatio="xMaxYMid slice"
        aria-hidden="true"
      >
        <path
          d="M600 30 C 360 170, 520 360, 180 700"
          stroke={toRgba(theme, 0.28)}
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        <circle cx="452" cy="238" r="4.5" fill={theme} />
      </svg>

      {/* ── Decorative soft waves (bottom) ──────────────────────────────── */}
      <svg
        className="pointer-events-none absolute bottom-0 left-0 w-full h-[40%]"
        viewBox="0 0 1440 320"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path
          d="M0,224 C240,180 480,288 720,256 C960,224 1200,150 1440,208 L1440,320 L0,320 Z"
          fill={toRgba(theme, 0.12)}
        />
        <path
          d="M0,272 C240,240 480,320 720,288 C960,256 1200,220 1440,272 L1440,320 L0,320 Z"
          fill={toRgba(theme, 0.18)}
        />
      </svg>

      {/* ── Center content ──────────────────────────────────────────────── */}
      <div className="relative z-10 flex flex-col items-center text-center px-6 animate-fadein">

        {/* Brand badge */}
        <div
          className="mb-4 flex items-center justify-center rounded-2xl w-[clamp(46px,5vw,60px)] h-[clamp(46px,5vw,60px)]"
          style={{ background: `linear-gradient(135deg, ${theme}, ${toRgba(theme, 0.72)})`, boxShadow: `0 10px 24px ${toRgba(theme, 0.35)}` }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke={onTheme} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-[clamp(24px,2.6vw,30px)] h-auto">
            <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
            <line x1="3" y1="6" x2="21" y2="6" />
            <path d="M16 10a4 4 0 0 1-8 0" />
          </svg>
        </div>

        {/* Greeting */}
        <p className="font-normal leading-none text-slate-500 text-[clamp(15px,2.2vw,24px)]">
          Welcome to
        </p>

        {/* Brand */}
        <h1 className="mt-1.5 font-extrabold uppercase leading-[1.05] tracking-tight text-slate-800 text-[clamp(28px,5vw,52px)]">
          {brandTitle}
        </h1>

        {/* Subtitle */}
        <p className="mt-5 max-w-[400px] leading-relaxed text-slate-400 text-[clamp(12px,1.5vw,15px)]">
          I'm here to help you explore, compare,<br className="hidden sm:block" /> and find the right products for you.
        </p>
      </div>
    </div>
  );
}
