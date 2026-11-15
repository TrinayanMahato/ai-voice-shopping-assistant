import { useState } from 'react';
import AIAgentTile from './AIAgentTile';
import ChatPanel from './ChatPanel';
import CaptionBar from './CaptionBar';
import ProductCardsComponent from './ProductCardsComponent';
import ImageComponent from './ImageComponent';
import Mp4Component from './Mp4Component';
import GifComponent from './GifComponent';
import WelcomeScreen from './WelcomeScreen';
import { toRgba } from '../utils/color';
import { SUGGESTION_CHIPS } from '../constants';

// ─────────────────────────────────────────────────────────────────────────────
// Rotate notice — disabled (no longer instructing user to rotate device)
// ─────────────────────────────────────────────────────────────────────────────
function RotateNotice() {
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hotspot list panel — occupies the transcript slot after an area is selected.
// ─────────────────────────────────────────────────────────────────────────────
function HotspotListPanel({ regions, onPick, onClose, theme, textColor, bgColor }) {
  return (
    <div className="flex-1 flex flex-col relative min-h-0 bg-white">
      {/* Header */}
      <div className="px-[12px] py-[10px] bg-white border-b border-gray-100 flex items-center gap-[7px] shrink-0">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={theme} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
        </svg>
        <h2 className="text-[12px] font-bold tracking-tight" style={{ color: textColor || '#111827' }}>
          Selected area <span className="text-gray-400 font-semibold">({regions.length})</span>
        </h2>
        <button
          type="button"
          onClick={onClose}
          title="Close"
          className="ml-auto w-[26px] h-[26px] rounded-full flex items-center justify-center text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-[10px] py-[12px] flex flex-col gap-[7px]" style={{ background: bgColor || '#f6f5f3' }}>
        <p className="text-[10px] text-gray-500 px-1 mb-0.5">Tap a label to ask about it:</p>
        {regions.map((r, i) => (
          <button
            key={i}
            onClick={() => onPick(r.label)}
            className="text-left w-full bg-white rounded-[9px] border border-gray-200 px-[10px] py-[8px] text-[11.5px] font-medium text-gray-800 shadow-sm transition-all hover:-translate-y-[1px] active:scale-[0.99] flex items-center gap-1.5"
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = toRgba(theme, 0.5); }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgb(229,231,235)'; }}
          >
            <span className="w-[5px] h-[5px] rounded-full shrink-0" style={{ background: theme }} />
            <span className="flex-1 leading-tight">{r.label}</span>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Compact control-bar button (icon only) reused for the mobile left column.
// ─────────────────────────────────────────────────────────────────────────────
function CtrlButton({ onClick, title, activeStyle, children }) {
  return (
    <button onClick={onClick} title={title} className="flex items-center justify-center transition-opacity hover:opacity-80">
      <span className="w-[clamp(30px,5.4vh,38px)] h-[clamp(30px,5.4vh,38px)] rounded-full flex items-center justify-center transition-colors" style={activeStyle}>
        {children}
      </span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MobileMeeting — landscape 3-column layout (20% / 60% / 20%).
// Desktop layout in App.jsx is untouched; this renders only when isMobile.
// ─────────────────────────────────────────────────────────────────────────────
export default function MobileMeeting({
  theme, onTheme, themeText, themeBg, brandLogo, displayName, welcomeImage,
  localVideoRef, isMicOn, isCameraOn, customerName,
  toggleMic, toggleCamera, handleLeave,
  chatMessages, isAgentThinking, interimTranscript, caption, handleSendMessage,
  agentUIState, handleFeatureClick,
  aiAgentJoined, aiAgentSpeaking, isPortrait,
  authActive, authMessages, authBusy, authStep, onAuthSubmit,
}) {
  // Right slot: 'transcript' | 'hotspots' | null
  const [rightPanel, setRightPanel] = useState(null);
  const [selectedRegions, setSelectedRegions] = useState([]);
  const [sentChip, setSentChip] = useState(null); // suggestion chip just tapped → brief "Sent" feedback

  // Before the call connects, the transcript pins open to run verification.
  const effectiveRight = authActive ? 'transcript' : rightPanel;

  // Send a suggestion chip and briefly confirm it on the chip itself.
  const handleChip = (chip) => {
    handleSendMessage(chip);
    setSentChip(chip);
    setTimeout(() => setSentChip((c) => (c === chip ? null : c)), 1200);
  };

  const products = agentUIState?.products || [];
  const annotation = agentUIState?.annotation || null;
  const hasProducts = products.length > 0;

  const toggleTranscript = () => setRightPanel((p) => (p === 'transcript' ? null : 'transcript'));

  const handleAreaSelected = (regions) => {
    setSelectedRegions(regions);
    setRightPanel('hotspots');
  };

  const rightOpen = effectiveRight !== null;

  return (
    <div
      className="flex overflow-hidden min-h-0 w-full h-[100dvh] gap-[clamp(6px,1.4vh,12px)]"
      style={{
        background: '#f4f4f6',
        paddingTop: 'max(env(safe-area-inset-top), clamp(6px, 1.4vh, 12px))',
        paddingBottom: 'max(env(safe-area-inset-bottom), clamp(6px, 1.4vh, 12px))',
        paddingLeft: 'max(env(safe-area-inset-left), clamp(6px, 1.4vh, 12px))',
        paddingRight: 'max(env(safe-area-inset-right), clamp(6px, 1.4vh, 12px))',
      }}
    >

      {/* ── Left column (fluid, capped): AI tile + user video + controls ──── */}
      <div className="flex flex-col gap-[clamp(6px,1.4vh,12px)] w-[clamp(120px,20%,220px)] shrink-0 h-full min-h-0">
        {/* AI Agent Tile */}
        <div className="w-full flex-1 min-h-0 bg-gray-100 rounded-2xl overflow-hidden shadow-[0_4px_16px_rgba(0,0,0,0.12)] relative">
          {aiAgentJoined ? (
            <div className="absolute inset-0">
              <div className="absolute inset-0 z-0">
                <AIAgentTile isSpeaking={aiAgentSpeaking} theme={theme} logo={brandLogo} name={displayName} />
              </div>
              <div id="remote-tracks" className="absolute inset-0 z-10 w-full h-full [&_video]:w-full [&_video]:h-full [&_video]:object-cover" />
              <div className="absolute top-1.5 right-1.5 z-20 text-[clamp(7px,2vh,9px)] font-extrabold px-1.5 py-0.5 rounded-md tracking-[0.08em] uppercase text-white shadow-sm" style={{ background: toRgba(theme, 0.92) }}>
                AI
              </div>
              <div className="absolute bottom-1.5 left-1.5 right-1.5 z-20 flex items-center justify-between">
                <span className="text-white text-[clamp(9px,2.6vh,12px)] font-bold tracking-tight drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)] truncate">
                  {displayName} <span className="opacity-80">AI</span>
                </span>
                {aiAgentSpeaking && (
                  <span className="flex items-end gap-[2px] h-[12px] shrink-0">
                    {[0, 1, 2, 3].map((i) => (
                      <span key={i} className="w-[2px] rounded-full animate-pulse" style={{ background: theme, height: `${5 + (i % 2) * 5}px`, animationDelay: `${i * 120}ms` }} />
                    ))}
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center w-full h-full text-gray-500 text-[clamp(10px,2.8vh,13px)] text-center px-2 font-medium bg-white/80 backdrop-blur-md">Waiting for AI...</div>
          )}
        </div>

        {/* Local User Tile */}
        <div className="w-full aspect-[4/3] shrink-0 bg-black rounded-2xl overflow-hidden shadow-[0_4px_16px_rgba(0,0,0,0.12)] border border-white/60 relative">
          <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover transform -scale-x-100" />
          {!isMicOn && (
            <div className="absolute top-1.5 right-1.5 z-10 bg-red-500 rounded-full p-1 shadow-md">
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="1" x2="23" y2="23" /><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" /><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>
            </div>
          )}
          <div className="absolute bottom-1 left-1.5 right-1.5 z-10">
            <span className="text-white text-[clamp(9px,2.6vh,12px)] font-bold tracking-tight drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)] truncate block">
              {customerName || 'user'}
            </span>
          </div>
        </div>

        {/* Control bar (icons only) */}
        <div className="w-full bg-white rounded-2xl shadow-[0_4px_16px_rgba(0,0,0,0.06)] px-[clamp(4px,1vh,8px)] py-[clamp(6px,1.4vh,10px)] flex items-center justify-around gap-1 shrink-0">
          {/* Mic */}
          <CtrlButton onClick={toggleMic} title={isMicOn ? 'Mute' : 'Unmute'} activeStyle={isMicOn ? { background: theme, color: onTheme } : { background: '#fef2f2', color: '#ef4444' }}>
            {isMicOn ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[clamp(14px,4vh,18px)] h-[clamp(14px,4vh,18px)]"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[clamp(14px,4vh,18px)] h-[clamp(14px,4vh,18px)]"><line x1="1" y1="1" x2="23" y2="23" /><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" /><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" /><line x1="12" y1="19" x2="12" y2="23" /></svg>
            )}
          </CtrlButton>

          {/* Camera */}
          <CtrlButton onClick={toggleCamera} title={isCameraOn ? 'Stop Camera' : 'Start Camera'} activeStyle={isCameraOn ? { background: theme, color: onTheme } : { background: '#fef2f2', color: '#ef4444' }}>
            {isCameraOn ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[clamp(14px,4vh,18px)] h-[clamp(14px,4vh,18px)]"><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[clamp(14px,4vh,18px)] h-[clamp(14px,4vh,18px)]"><line x1="1" y1="1" x2="23" y2="23" /><path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m3-3h6l2 3h2a2 2 0 0 1 2 2v9.34m-7.72-2.06A4 4 0 1 1 7.72 7.72" /></svg>
            )}
          </CtrlButton>

          {/* Chat / transcript toggle */}
          <CtrlButton onClick={toggleTranscript} title="Toggle Transcript" activeStyle={effectiveRight === 'transcript' ? { background: theme, color: onTheme } : { background: '#f3f4f6', color: '#374151' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[clamp(14px,4vh,18px)] h-[clamp(14px,4vh,18px)]"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
          </CtrlButton>

          {/* End */}
          <CtrlButton onClick={() => handleLeave()} title="End Call" activeStyle={{ background: '#ef4444', color: '#ffffff' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="w-[clamp(14px,4vh,18px)] h-[clamp(14px,4vh,18px)]"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" /></svg>
          </CtrlButton>
        </div>
      </div>

      {/* ── Center 60% (grows when right panel closed): product visual ─────── */}
      <div className="flex-1 min-w-0 h-full bg-white rounded-2xl shadow-[0_4px_16px_rgba(0,0,0,0.06)] flex flex-col overflow-hidden">
        <div className="flex-1 min-h-0 overflow-hidden p-2">
          {!hasProducts && (
            <WelcomeScreen theme={theme} onTheme={onTheme} displayName={displayName} welcomeImage={welcomeImage} />
          )}
          {products.length > 1 && (
            <ProductCardsComponent
              products={products}
              annotation={annotation}
              mobile
              onProductTap={(product) => handleSendMessage(`Tell me more about ${product.title}`)}
            />
          )}
          {products.length === 1 && (() => {
            const product = products[0];
            const ext = product.featured_image ? product.featured_image.split('.').pop().toLowerCase() : '';
            if (ext === 'mp4') {
              return <Mp4Component product={product} annotation={annotation} onFeatureClick={handleFeatureClick} />;
            } else if (ext === 'gif') {
              return <GifComponent product={product} annotation={annotation} onFeatureClick={handleFeatureClick} />;
            }
            return (
              <ImageComponent
                product={product}
                annotation={annotation}
                onFeatureClick={handleFeatureClick}
                theme={theme}
                onTheme={onTheme}
                areaSelectEnabled
                onAreaSelected={handleAreaSelected}
              />
            );
          })()}
        </div>

        {/* Live caption (subtitles) — just above the suggestion chips */}
        <CaptionBar caption={caption} compact />

        {/* Most asked questions (live call only) */}
        {!authActive && (
        <div className="px-[clamp(10px,2vh,18px)] pt-1.5 pb-2 shrink-0 flex items-center gap-2">
          <span className="flex items-center gap-1 shrink-0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="#f59e0b" stroke="none" className="w-[clamp(12px,2.6vh,15px)] h-[clamp(12px,2.6vh,15px)]">
              <path d="M12 2l1.9 5.8L20 9.6l-4.9 3.6 1.9 5.9L12 15.5 7 19.1l1.9-5.9L4 9.6l6.1-1.8z" />
            </svg>
            <span className="text-[clamp(11px,3vh,14px)] font-semibold text-gray-800 whitespace-nowrap hidden sm:inline">Most asked</span>
          </span>
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide">
            {SUGGESTION_CHIPS.map((chip) => {
              const isSent = sentChip === chip;
              return (
                <button
                  key={chip}
                  onClick={() => handleChip(chip)}
                  className={`text-[clamp(10px,2.8vh,13px)] font-medium px-[clamp(8px,1.8vh,14px)] py-[clamp(3px,0.9vh,6px)] rounded-full whitespace-nowrap transition-all shrink-0 flex items-center gap-1 ${isSent ? 'animate-chip-pop' : ''}`}
                  style={isSent
                    ? { background: theme, color: onTheme, border: `1px solid ${theme}` }
                    : { background: '#ffffff', color: '#374151', border: '1px solid rgba(0,0,0,0.08)' }}
                >
                  {isSent && (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                  )}
                  {isSent ? 'Sent' : chip}
                </button>
              );
            })}
          </div>
        </div>
        )}
      </div>

      {/* ── Right 20%: verification / transcript OR selected-area hotspot list ── */}
      <div className={`transition-all duration-300 ease-in-out flex flex-col rounded-2xl overflow-hidden shadow-[0_4px_16px_rgba(0,0,0,0.06)] z-10 shrink-0 h-full ${rightOpen ? 'w-[clamp(150px,22%,230px)] opacity-100' : 'w-0 opacity-0'}`}>
        {effectiveRight === 'transcript' && (
          <ChatPanel
            messages={chatMessages}
            isAgentThinking={isAgentThinking}
            interimTranscript={interimTranscript}
            onSendMessage={handleSendMessage}
            onClose={authActive ? undefined : () => setRightPanel(null)}
            compact
            theme={theme}
            textColor={themeText}
            onThemeText={onTheme}
            bgColor={themeBg}
            authMode={authActive}
            authMessages={authMessages}
            authBusy={authBusy}
            authStep={authStep}
            onAuthSubmit={onAuthSubmit}
            brandName={displayName}
          />
        )}
        {effectiveRight === 'hotspots' && (
          <HotspotListPanel
            regions={selectedRegions}
            onPick={handleFeatureClick}
            onClose={() => setRightPanel(null)}
            theme={theme}
            textColor={themeText}
            bgColor={themeBg}
          />
        )}
      </div>
    </div>
  );
}
