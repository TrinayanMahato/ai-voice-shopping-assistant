import { useState, useRef, useEffect } from 'react';
import AudioWaveform from './AudioWaveform';

function TypewriterText({ text, isStreaming, isInterrupted, themeColor }) {
  const [displayed, setDisplayed] = useState(isStreaming ? '' : text);
  const textRef = useRef(text);

  // Keep textRef in sync
  useEffect(() => {
    textRef.current = text;
  }, [text]);

  // If interrupted, snap to whatever chunks were received and stop
  useEffect(() => {
    if (isInterrupted) {
      setDisplayed(textRef.current);
    }
  }, [isInterrupted]);

  // Typewriter effect runs unless interrupted
  useEffect(() => {
    if (isInterrupted) return;
    
    const interval = setInterval(() => {
      setDisplayed((prev) => {
        const fullText = textRef.current;
        if (prev.length < fullText.length) {
          return fullText.slice(0, prev.length + 1);
        }
        return prev;
      });
    }, 50);
    return () => clearInterval(interval);
  }, [isInterrupted]);

  const isTyping = displayed.length < text.length;
  // Show cursor if still typing, or if the backend is still streaming. Stop if interrupted.
  const showCursor = (!isInterrupted && isTyping) || (!isInterrupted && isStreaming);

  return (
    <>
      {displayed}
      {showCursor && (
        <span className="animate-caret ml-[1px] font-normal" style={{ color: themeColor }}>▍</span>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Chat Panel — displays STT and AI answers (Live Transcript).
//
// Optional props (desktop passes none, so its layout stays identical):
//   onClose          → shows a close (X) button in the header (mobile).
//   compact          → smaller fonts / tighter padding (mobile).
//   interimTranscript → live provisional caption of what the user is currently
//                       saying (shown as a faded bubble at the bottom).
// A message with `streaming: true` renders a blinking caret after its text so the
// AI response reads as if it is being spoken line-by-line.
// ─────────────────────────────────────────────────────────────────────────────
export default function ChatPanel({
  messages, isAgentThinking, aiAgentSpeaking, isMicOn, userVolume, agentVolume, combinedVolume, onSendMessage, onClose, compact = false, interimTranscript = '',
  theme, textColor, onThemeText, bgColor,
  // Auth mode — before the call connects, the transcript collects phone + OTP.
  authMode = false, authMessages = [], authBusy = false, authStep = 'phone', onAuthSubmit, brandName,
  faqChips = [], sentChip = null, onChipClick, hideInput = false,
}) {
  const messagesEndRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const [inputText, setInputText] = useState('');
  const themeColor = theme || '#6366f1';
  const onThemeColor = onThemeText || '#ffffff';

  // Source + labels differ while verifying vs. the live transcript.
  const list = authMode ? authMessages : messages;
  const agentLabel = authMode ? (brandName || 'Assistant') : 'Assistant';
  const showThinking = authMode ? authBusy : isAgentThinking;
  const thinkingLabel = authMode ? `${brandName || 'Assistant'} is verifying…` : 'Assistant is thinking…';
  const heading = authMode ? 'Verify to continue' : 'Live Transcript';
  // Placeholders are concise on the narrow mobile (compact) panel so they stay
  // fully visible, and verbose on the wider desktop panel where there's room.
  const inputPlaceholder = authMode
    ? (authStep === 'otp'
      ? (compact ? 'Enter OTP' : 'Enter the OTP — e.g. 123456')
      : (compact ? 'Mobile number' : 'Enter your mobile number'))
    : (compact ? 'Message…' : 'Type your message...');
  const inputDisabled = authMode && authBusy;

  // Size tokens. compact (mobile) is fluid — vh-anchored clamp() so the transcript
  // scales with the viewport (tiny phone → large tablet) and stays legible instead
  // of being pinned at ~11px. Desktop (non-compact) keeps its fixed scale.
  const t = {
    header: compact ? 'text-[clamp(12px,2.9vh,15px)]' : 'text-[14px]',
    sender: compact ? 'text-[clamp(8.5px,1.9vh,10.5px)]' : 'text-[10px]',
    bubble: compact ? 'text-[clamp(11.5px,2.7vh,14px)]' : 'text-[13.5px]',
    time: compact ? 'text-[clamp(8px,1.7vh,9.5px)]' : 'text-[9px]',
    input: compact ? 'text-[clamp(11.5px,2.7vh,14px)]' : 'text-[13.5px]',
    listPadX: compact ? 'px-[clamp(10px,2vh,14px)]' : 'px-[14px]',
    listPadY: compact ? 'py-[clamp(12px,2.4vh,16px)]' : 'py-[16px]',
    gap: compact ? 'gap-[clamp(10px,2vh,14px)]' : 'gap-[14px]',
    bubblePad: compact ? 'px-[clamp(10px,2vh,13px)] py-[clamp(7px,1.4vh,9px)]' : 'px-[13px] py-[9px]',
    headPad: compact ? 'px-[clamp(12px,2.4vh,18px)] py-[clamp(10px,2vh,14px)]' : 'px-[18px] py-[14px]',
  };

  const prevMsgCountRef = useRef(0);
  const userScrolledUpRef = useRef(false);

  // Detect if the user manually scrolled up
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const handleScroll = () => {
      const distFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      userScrolledUpRef.current = distFromBottom > 80;
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  // Auto-scroll: always snap down when a NEW message is added
  useEffect(() => {
    const currentCount = (authMode ? authMessages : messages).length;
    const isNewMessage = currentCount > prevMsgCountRef.current;
    prevMsgCountRef.current = currentCount;

    if (isNewMessage) {
      // New message always scrolls to bottom
      userScrolledUpRef.current = false;
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    } else if (!userScrolledUpRef.current) {
      // Thinking indicator / streaming update — only scroll if user hasn't scrolled up
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, authMessages, isAgentThinking, authBusy, interimTranscript]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const val = inputText.trim();
    if (!val) return;
    if (authMode) {
      if (inputDisabled) return;
      onAuthSubmit?.(val);
    } else {
      onSendMessage?.(val);
    }
    setInputText('');
  };

  return (
    <div className="w-full h-full flex flex-col relative min-h-0 bg-white">
      {/* Header */}
      <div className={`${t.headPad} bg-white border-b border-gray-100 flex items-center gap-[8px] z-10 relative shrink-0`}>
        <span className={compact ? 'text-[clamp(13px,3vh,16px)]' : 'text-[16px]'}>{authMode ? '🔒' : '💬'}</span>
        <h2 className={`${t.header} font-bold tracking-tight`} style={{ color: textColor || '#111827' }}>{heading}</h2>
        {onClose && (
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
        )}
      </div>

      {/* Messages */}
      <div ref={scrollContainerRef} className={`flex-1 min-h-0 overflow-y-auto ${t.listPadX} ${t.listPadY} flex flex-col ${t.gap} scroll-smooth relative z-10`}
        style={{ background: bgColor || '#f6f5f3' }}>

        {!authMode && messages.length === 0 && !interimTranscript && (
          <div className={`${compact ? 'text-[clamp(10px,2.3vh,12px)]' : 'text-[12px]'} text-gray-500 bg-white px-[14px] py-[6px] rounded-full self-center mt-4 shadow-sm`}>
            Listening for speech…
          </div>
        )}

        {list.map((msg, i) => {
          const isUser = msg.sender === 'user';
          return (
            <div key={i} className={`flex flex-col max-w-[88%] ${isUser ? 'self-end items-end' : 'self-start items-start'}`}>
              <span className={`${t.sender} text-gray-400 mb-[3px] uppercase tracking-wider font-bold px-1`}>
                {isUser ? 'You' : agentLabel}
              </span>
              <div
                className={`${t.bubblePad} ${t.bubble} leading-relaxed shadow-sm ${isUser ? 'rounded-[12px] rounded-tr-[3px]' : 'rounded-[12px] rounded-tl-[3px]'}`}
                style={isUser
                  ? { background: themeColor, color: onThemeColor }
                  : { background: '#ffffff', color: textColor || '#111827', border: '1px solid rgba(0,0,0,0.06)' }}
              >
                {!isUser ? <TypewriterText text={msg.text} isStreaming={msg.isStreaming} isInterrupted={msg.isInterrupted} themeColor={themeColor} /> : msg.text}
              </div>
              <span className={`${t.time} text-gray-400 mt-[3px] px-1 flex items-center gap-[3px]`}>
                {msg.time || ''}
                {isUser && (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={themeColor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </span>
            </div>
          );
        })}

        {/* Live user caption (interim STT — not yet finalized) */}
        {!authMode && interimTranscript && (
          <div className="flex flex-col max-w-[88%] self-end items-end opacity-70">
            <span className={`${t.sender} text-gray-400 mb-[3px] uppercase tracking-wider font-bold px-1`}>You</span>
            <div
              className={`${t.bubblePad} ${t.bubble} leading-relaxed shadow-sm rounded-[12px] rounded-tr-[3px] italic`}
              style={{ background: themeColor, color: onThemeColor }}
            >
              {interimTranscript}
              <span className="animate-caret ml-[1px] not-italic">▍</span>
            </div>
          </div>
        )}

        {showThinking && (
          <div className="flex flex-col max-w-[88%] self-start items-start animate-fadein mt-1">
            <span className={`${t.sender} text-gray-400 mb-[3px] uppercase tracking-wider font-bold px-1`}>
              {thinkingLabel}
            </span>
            <div className="px-[14px] py-[10px] bg-white rounded-[12px] rounded-tl-[3px] shadow-sm flex items-center gap-[6px]">
              <div className="w-[6px] h-[6px] rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }} />
              <div className="w-[6px] h-[6px] rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '150ms' }} />
              <div className="w-[6px] h-[6px] rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} className="h-1" />
      </div>

      {/* FAQ Chips above input when split-screen (<1200px) */}
      {!hideInput && !authMode && faqChips && faqChips.length > 0 && (
        <div className="max-[1199px]:flex hidden items-center gap-1.5 px-3 py-1.5 bg-white border-t border-gray-100 overflow-x-auto scrollbar-hide z-10 shrink-0">
          <div className="flex items-center gap-1.5 shrink-0">
            {faqChips.map((chip) => {
              const isSent = sentChip === chip;
              return (
                <button
                  key={chip}
                  type="button"
                  onClick={() => onChipClick?.(chip)}
                  onMouseEnter={(e) => { if (!isSent) { e.currentTarget.style.borderColor = themeColor; e.currentTarget.style.color = themeColor; } }}
                  onMouseLeave={(e) => { if (!isSent) { e.currentTarget.style.borderColor = 'rgba(0,0,0,0.08)'; e.currentTarget.style.color = '#374151'; } }}
                  className={`text-[11px] font-medium px-2.5 py-1 rounded-full whitespace-nowrap transition-all shrink-0 flex items-center gap-1 ${isSent ? 'animate-chip-pop' : ''}`}
                  style={isSent
                    ? { background: themeColor, color: onThemeColor, border: `1px solid ${themeColor}` }
                    : { background: '#ffffff', color: '#374151', border: '1px solid rgba(0,0,0,0.08)' }}
                >
                  {isSent && (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                  )}
                  {isSent ? 'Sent' : chip}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Input */}
      {!hideInput && (
        <div className={`${compact ? 'p-2' : 'p-3'} bg-white border-t border-gray-100 z-10 shrink-0`}>
          <form onSubmit={handleSubmit} className={`flex items-center relative bg-gray-50 rounded-full border border-gray-200 ${compact ? 'gap-1.5 px-2.5 py-[6px]' : 'gap-2 px-4 py-[9px]'} shadow-sm focus-within:border-gray-300`}>
            {!authMode && isMicOn ? (
              <div className="flex-1 min-w-0 flex items-center h-[28px] overflow-hidden">
                <AudioWaveform
                  volume={combinedVolume}
                  isAgentSpeaking={aiAgentSpeaking || isAgentThinking}
                  isUserSpeaking={isMicOn && userVolume > 0.01}
                  theme={themeColor}
                />
              </div>
            ) : (
              <>
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder={inputPlaceholder}
                  disabled={inputDisabled}
                  inputMode={authMode ? 'numeric' : 'text'}
                  className={`flex-1 min-w-0 bg-transparent outline-none ${t.input} text-gray-800 placeholder-gray-400 disabled:opacity-50`}
                />
                {!authMode && (
                  <button type="button" className="text-gray-400 hover:text-gray-600 transition-colors shrink-0" title="Voice">
                    <svg width={compact ? '15' : '18'} height={compact ? '15' : '18'} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                      <line x1="12" y1="19" x2="12" y2="23" />
                    </svg>
                  </button>
                )}
              </>
            )}
            {!isMicOn && !authMode && (
              <button
                type="submit"
                disabled={!inputText.trim() || inputDisabled}
                className={`shrink-0 ${compact ? 'w-[clamp(28px,5.6vh,34px)] h-[clamp(28px,5.6vh,34px)]' : 'w-[32px] h-[32px]'} rounded-full flex items-center justify-center shadow-sm transition-all disabled:opacity-40`}
                style={{ background: themeColor, color: onThemeColor }}
              >
                <svg width={compact ? '14' : '16'} height={compact ? '14' : '16'} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={compact ? 'w-[clamp(14px,2.8vh,17px)] h-[clamp(14px,2.8vh,17px)]' : ''}>
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            )}
            {authMode && (
              <button
                type="submit"
                disabled={!inputText.trim() || inputDisabled}
                className={`shrink-0 ${compact ? 'w-[clamp(28px,5.6vh,34px)] h-[clamp(28px,5.6vh,34px)]' : 'w-[32px] h-[32px]'} rounded-full flex items-center justify-center shadow-sm transition-all disabled:opacity-40`}
                style={{ background: themeColor, color: onThemeColor }}
              >
                <svg width={compact ? '14' : '16'} height={compact ? '14' : '16'} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={compact ? 'w-[clamp(14px,2.8vh,17px)] h-[clamp(14px,2.8vh,17px)]' : ''}>
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            )}
          </form>
        </div>
      )}
    </div>
  );
}
