import { useEffect, useRef, useState } from 'react';

// ── Icons ───────────────────────────────────────────────────────────────────
const MicIcon = (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>);
const MicOffIcon = (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><line x1="1" y1="1" x2="23" y2="23" /><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" /><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>);
const CameraIcon = (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>);
const CameraOffIcon = (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><line x1="1" y1="1" x2="23" y2="23" /><path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m3-3h6l2 3h2a2 2 0 0 1 2 2v9.34m-7.72-2.06A4 4 0 1 1 7.72 7.72" /></svg>);
const LockIcon = (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>);
const ArrowRightIcon = (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...p}><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>);
const RefreshIcon = (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>);
const MaleIcon = (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="10" cy="14" r="5" /><line x1="19" y1="5" x2="14.14" y2="9.86" /><polyline points="15 5 19 5 19 9" /></svg>);
const FemaleIcon = (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="8" r="5" /><line x1="12" y1="13" x2="12" y2="21" /><line x1="9" y1="18" x2="15" y2="18" /></svg>);
const CheckBadge = (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="20 6 9 17 4 12" /></svg>);
const ChevronDownIcon = (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="6 9 12 15 18 9" /></svg>);

export default function ReadyToJoinScreen({ userName, meetingDetails, sellerConfig, onJoin }) {
  const [isMicOn, setIsMicOn] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [mediaStream, setMediaStream] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [perm, setPerm] = useState('prompt');
  const [error, setError] = useState(null);
  const [selectedVoice, setSelectedVoice] = useState({ gender: 'female', id: 'ritu' });
  const [selectedLanguage, setSelectedLanguage] = useState({ id: 'en-IN', label: 'English (India)' });
  const [openDropdown, setOpenDropdown] = useState(null);
  const [dropDirection, setDropDirection] = useState({ language: 'down', voice: 'down' });
  const [selectedMic, setSelectedMic] = useState('');
  const [selectedCam, setSelectedCam] = useState('');
  const [attemptedJoin, setAttemptedJoin] = useState(false);
  const videoRef = useRef(null);
  const langTriggerRef = useRef(null);
  const voiceTriggerRef = useRef(null);

  const toggleDropdown = (name, triggerRef) => {
    if (openDropdown === name) { setOpenDropdown(null); return; }
    if (triggerRef?.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const DROPDOWN_HEIGHT = 220;
      const dir = spaceBelow >= DROPDOWN_HEIGHT || spaceBelow >= spaceAbove ? 'down' : 'up';
      setDropDirection(prev => ({ ...prev, [name]: dir }));
    }
    setOpenDropdown(name);
  };

  const themeHex = sellerConfig?.theme_color || '#f4b73c';
  const onThemeHex = sellerConfig?.text_color || '#1a1a1a';
  const logoUrl = sellerConfig?.logo_url || meetingDetails?.brand_logo;
  const brandName = sellerConfig?.seller_name || meetingDetails?.brand_name || 'Smart Experience';
  const initial = (userName || 'U').trim().charAt(0).toUpperCase();

  const toRgba = (hex, alpha) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  };

  const enumDevices = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices.filter((d) => d.kind === 'videoinput' && d.deviceId);
      const mics_ = devices.filter((d) => d.kind === 'audioinput' && d.deviceId);
      if (cams.length && !selectedCam) setSelectedCam(cams[0].deviceId);
      if (mics_.length && !selectedMic) setSelectedMic(mics_[0].deviceId);
    } catch { }
  };

  const startPreview = async (camId, micId) => {
    if (mediaStream) mediaStream.getTracks().forEach((t) => t.stop());
    const stream = await navigator.mediaDevices.getUserMedia({
      video: camId ? { deviceId: { exact: camId } } : true,
      audio: micId ? { deviceId: { exact: micId } } : true,
    });
    setMediaStream(stream);
    if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play().catch(() => { }); }
    await enumDevices();
    return stream;
  };

  const reqPerm = async () => {
    setIsLoading(true); setError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Media not supported.');
      await startPreview(selectedCam || undefined, selectedMic || undefined);
      setPerm('granted');
    } catch (e) {
      setError(e.name === 'NotFoundError' ? 'No camera or microphone found.' : e.name === 'NotReadableError' ? 'Camera is in use by another app.' : 'Please allow camera & microphone access to continue.');
      setPerm('denied');
    }
    setIsLoading(false);
  };

  useEffect(() => {
    if (!navigator.mediaDevices) { setPerm('denied'); setError('Media not available. Use HTTPS.'); return; }
    (async () => {
      let initial_ = 'prompt';
      if (navigator.permissions?.query) {
        try {
          const [cam, mic] = await Promise.all([navigator.permissions.query({ name: 'camera' }), navigator.permissions.query({ name: 'microphone' })]);
          if (cam.state === 'granted' && mic.state === 'granted') initial_ = 'granted';
          else if (cam.state === 'denied' || mic.state === 'denied') initial_ = 'denied';
        } catch { }
      }
      await enumDevices();
      if (initial_ === 'granted') { try { await startPreview(); setPerm('granted'); } catch { setPerm('prompt'); } }
      else { setPerm(initial_); }
    })();
    return () => { mediaStream?.getTracks().forEach((t) => t.stop()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [isJoining, setIsJoining] = useState(false);

  const toggleMic = () => { const next = !isMicOn; setIsMicOn(next); mediaStream?.getAudioTracks().forEach((t) => { t.enabled = next; }); };
  const toggleCamera = () => { const next = !isCameraOn; setIsCameraOn(next); mediaStream?.getVideoTracks().forEach((t) => { t.enabled = next; }); };

  const handleJoin = async () => {
    if (isJoining) return;
    setIsJoining(true);
    setAttemptedJoin(true);
    if (perm !== 'granted') { await reqPerm(); setIsJoining(false); return; }
    if (!selectedVoice) { setIsJoining(false); return; }
    mediaStream?.getTracks().forEach((t) => t.stop());
    onJoin({ isMicOn, isCameraOn, wantMic: isMicOn, wantCamera: isCameraOn, audioDeviceId: selectedMic || undefined, videoDeviceId: selectedCam || undefined, voiceGender: selectedVoice?.gender, voiceId: selectedVoice?.id, language: selectedLanguage?.id });
  };

  const missingVoice = attemptedJoin && !selectedVoice?.gender;

  return (
    <div
      onClick={() => setOpenDropdown(null)}
      className="h-[100dvh] w-full flex items-stretch justify-center"
      style={{ background: `linear-gradient(135deg, ${toRgba(themeHex, 0.08)} 0%, #f9fafb 50%, ${toRgba(themeHex, 0.04)} 100%)`, fontFamily: "'Inter', system-ui, -apple-system, sans-serif" }}
    >
      {/* Ambient glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -top-40 -right-40 w-[500px] h-[500px] rounded-full opacity-20" style={{ background: `radial-gradient(circle, ${themeHex} 0%, transparent 70%)`, filter: 'blur(80px)' }} />
        <div className="absolute -bottom-40 -left-40 w-[400px] h-[400px] rounded-full opacity-15" style={{ background: `radial-gradient(circle, ${themeHex} 0%, transparent 70%)`, filter: 'blur(60px)' }} />
      </div>

      {/* ── Main Card ── */}
      <div
        className="relative w-full max-w-[390px] h-full bg-white/92 backdrop-blur-xl flex flex-col overflow-hidden"
        style={{ boxShadow: `0 0 0 1px ${toRgba(themeHex, 0.15)}` }}
      >
        <div className="px-8 pt-6 pb-6 flex flex-col h-full">

          {/* Brand header */}
          <div className="flex items-center justify-between mb-4 shrink-0">
            {logoUrl
              ? <img src={logoUrl} alt={brandName} className="h-12 object-contain" style={{ maxWidth: '180px' }} />
              : <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold" style={{ background: themeHex, color: onThemeHex }}>{brandName.charAt(0)}</div>
            }
            <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold tracking-wide border" style={{ color: themeHex, borderColor: toRgba(themeHex, 0.3), background: toRgba(themeHex, 0.08) }}>
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: themeHex }} />
              LIVE
            </div>
          </div>

          {/* Camera preview — flex-1 fills all remaining vertical space */}
          <div className="flex flex-col mb-3 flex-1 min-h-0">
            <div className="relative w-full h-full rounded-xl overflow-hidden bg-gray-950">
              <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-contain [transform:scaleX(-1)]" style={{ display: perm === 'granted' && isCameraOn ? 'block' : 'none' }} />

              {perm === 'prompt' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: toRgba(themeHex, 0.2), border: `1.5px solid ${toRgba(themeHex, 0.5)}` }}>
                    <CameraIcon width={16} height={16} style={{ stroke: themeHex }} />
                  </div>
                  <p className="text-[11.5px] font-semibold text-white">Camera & Microphone Required</p>
                  <button onClick={reqPerm} disabled={isLoading} className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[11.5px] font-semibold transition-all hover:brightness-110 active:scale-95 disabled:opacity-60" style={{ background: themeHex, color: onThemeHex }}>
                    {isLoading ? <><RefreshIcon width={11} height={11} className="animate-spin" /> Requesting…</> : 'Allow access'}
                  </button>
                </div>
              )}

              {perm === 'denied' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
                  <div className="w-9 h-9 rounded-xl bg-red-500/15 border border-red-500/30 flex items-center justify-center">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
                  </div>
                  <p className="text-[11px] text-white/60 max-w-[200px]">{error || 'Access blocked. Allow permissions in your browser.'}</p>
                  <button onClick={reqPerm} className="text-[11px] font-semibold px-3 py-1.5 rounded-lg" style={{ background: themeHex, color: onThemeHex }}>Try again</button>
                </div>
              )}

              {perm === 'granted' && !isCameraOn && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-gray-950">
                  <div className="w-11 h-11 rounded-full flex items-center justify-center text-base font-bold" style={{ background: themeHex, color: onThemeHex }}>{initial}</div>
                  <span className="text-[10px] text-white/40">Camera off</span>
                </div>
              )}

              {perm === 'granted' && (
                <div className="absolute bottom-2 left-2 z-10 px-2 py-0.5 rounded-md bg-black/40 backdrop-blur-sm">
                  <span className="text-[10px] text-white font-medium">{userName || 'You'}</span>
                </div>
              )}

              {/* Overlay Mic/Camera Toggles */}
              {perm === 'granted' && (
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5">
                  <button
                    onClick={toggleMic}
                    title={isMicOn ? "Mute Microphone" : "Unmute Microphone"}
                    className={`w-8 h-8 rounded-full flex items-center justify-center transition-all shadow-sm backdrop-blur-md ${!isMicOn ? 'bg-red-500/90 text-white hover:bg-red-600' : 'bg-black/50 text-white hover:bg-black/70'}`}
                  >
                    {isMicOn ? <MicIcon width={14} height={14} /> : <MicOffIcon width={14} height={14} />}
                  </button>
                  <button
                    onClick={toggleCamera}
                    title={isCameraOn ? "Turn off Camera" : "Turn on Camera"}
                    className={`w-8 h-8 rounded-full flex items-center justify-center transition-all shadow-sm backdrop-blur-md ${!isCameraOn ? 'bg-red-500/90 text-white hover:bg-red-600' : 'bg-black/50 text-white hover:bg-black/70'}`}
                  >
                    {isCameraOn ? <CameraIcon width={14} height={14} /> : <CameraOffIcon width={14} height={14} />}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* AI Experience Description (Professional Box) */}
          <div className="mb-3 shrink-0 flex items-start gap-3 p-3 bg-gray-50/80 border border-gray-200/60 rounded-xl shadow-sm">
            <div className="mt-0.5 shrink-0" style={{ color: themeHex }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" />
              </svg>
            </div>
            <p className="text-[11.5px] text-gray-600 leading-[1.5]">
              Welcome to the <strong className="text-gray-900">{brandName}</strong> AI experience. You can ask about any product, explore detailed features, or compare items.
            </p>
          </div>

          {/* Language and Voice Selection Row */}
          <div className="mb-3 shrink-0 flex flex-col gap-2">
            
            {/* Language Selection */}
            <div>
              <div className="flex items-center justify-between mb-1.5 px-1">
                <p className="text-[11px] font-bold text-gray-700 uppercase tracking-widest">Speaking Language</p>
              </div>

              <div
                ref={langTriggerRef}
                className="relative w-full group"
                onClick={(e) => { e.stopPropagation(); toggleDropdown('language', langTriggerRef); }}
              >
                <div
                  className={`flex items-center justify-between w-full px-3 py-2.5 rounded-[14px] transition-all cursor-pointer border ${openDropdown === 'language' ? 'bg-white shadow-[0_8px_24px_rgba(0,0,0,0.06)]' : 'bg-white shadow-sm hover:shadow-md'}`}
                  style={{ borderColor: openDropdown === 'language' ? toRgba(themeHex, 0.4) : '#e5e7eb' }}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: toRgba(themeHex, 0.1), color: themeHex }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="2" y1="12" x2="22" y2="12" />
                        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                      </svg>
                    </div>
                    <span className="text-[13px] text-gray-900 font-bold tracking-tight">
                      {selectedLanguage?.label || 'Select Language'}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold" style={{ color: themeHex }}>Change</span>
                    <ChevronDownIcon width={14} height={14} className={`text-gray-400 transition-transform duration-200 ${openDropdown === 'language' ? 'rotate-180' : ''}`} />
                  </div>
                </div>

                {openDropdown === 'language' && (
                  <div className={`absolute left-0 right-0 bg-white border border-gray-100 rounded-[16px] z-40 overflow-y-auto max-h-[220px] flex flex-col py-1.5 animate-in fade-in zoom-in-95 duration-150 scrollbar-hide ${dropDirection.language === 'up' ? 'bottom-full mb-2 shadow-[0_-16px_40px_-8px_rgba(0,0,0,0.12)]' : 'top-full mt-2 shadow-[0_16px_40px_-8px_rgba(0,0,0,0.12)]'}`}>
                    {[
                      { id: 'hi-IN', label: 'Hindi' },
                      { id: 'en-IN', label: 'English (India)' },
                      { id: 'bn-IN', label: 'Bengali' },
                      { id: 'kn-IN', label: 'Kannada' },
                      { id: 'ml-IN', label: 'Malayalam' },
                      { id: 'mr-IN', label: 'Marathi' },
                      { id: 'or-IN', label: 'Odia' },
                      { id: 'pa-IN', label: 'Punjabi' },
                      { id: 'ta-IN', label: 'Tamil' },
                      { id: 'te-IN', label: 'Telugu' },
                      { id: 'gu-IN', label: 'Gujarati' }
                    ].map(lang => (
                      <button
                        key={lang.id}
                        className="text-left px-4 py-3 text-[13px] font-semibold transition-colors flex items-center justify-between hover:bg-gray-50"
                        onClick={(e) => { e.stopPropagation(); setSelectedLanguage({ id: lang.id, label: lang.label }); setOpenDropdown(null); }}
                      >
                        <span className={selectedLanguage?.id === lang.id ? 'text-gray-900' : 'text-gray-600'}>
                          {lang.label}
                        </span>
                        {selectedLanguage?.id === lang.id && (
                          <div className="w-4 h-4 rounded-full flex items-center justify-center shrink-0" style={{ background: themeHex }}>
                            <CheckBadge width={9} height={9} style={{ stroke: 'white' }} />
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Voice selection */}
            <div>
            <div className="flex items-center justify-between mb-2 px-1">
              <p className="text-[11px] font-bold text-gray-700 uppercase tracking-widest">Voice Agent</p>
            </div>

            <div
              ref={voiceTriggerRef}
              className="relative w-full group"
              onClick={(e) => { e.stopPropagation(); toggleDropdown('voice', voiceTriggerRef); }}
            >
              <div
                className={`flex items-center justify-between w-full px-3 py-2.5 rounded-[14px] transition-all cursor-pointer border ${openDropdown === 'voice' ? 'bg-white shadow-[0_8px_24px_rgba(0,0,0,0.06)]' : 'bg-white shadow-sm hover:shadow-md'}`}
                style={{ borderColor: openDropdown === 'voice' ? toRgba(themeHex, 0.4) : '#e5e7eb' }}
              >

                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: toRgba(themeHex, 0.1), color: themeHex }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    </svg>
                  </div>
                  <span className="text-[13px] text-gray-900 font-bold tracking-tight">
                    {selectedVoice?.id === 'shubh' ? 'Trinayan' :
                      selectedVoice?.id === 'sumit' ? 'Aman' :
                        selectedVoice?.id === 'ritu' ? 'Heli' :
                          selectedVoice?.id === 'priya' ? 'Tanya' : 'Select Voice'}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold" style={{ color: themeHex }}>Change</span>
                  <ChevronDownIcon width={14} height={14} className={`text-gray-400 transition-transform duration-200 ${openDropdown === 'voice' ? 'rotate-180' : ''}`} />
                </div>
              </div>

              {openDropdown === 'voice' && (
                <div className={`absolute left-0 right-0 bg-white border border-gray-100 rounded-[16px] z-50 overflow-y-auto max-h-[220px] py-1.5 animate-in fade-in zoom-in-95 duration-150 ${dropDirection.voice === 'up' ? 'bottom-full mb-2 shadow-[0_-16px_40px_-8px_rgba(0,0,0,0.12)]' : 'top-full mt-2 shadow-[0_16px_40px_-8px_rgba(0,0,0,0.12)]'}`}>
                  {[{ id: 'shubh', label: 'Trinayan', gender: 'male' }, { id: 'sumit', label: 'Aman', gender: 'male' }, { id: 'ritu', label: 'Heli', gender: 'female' }, { id: 'priya', label: 'Tanya', gender: 'female' }].map(voice => (
                    <button
                      key={voice.id}
                      className="w-full text-left px-4 py-3 text-[13px] font-semibold transition-colors flex items-center justify-between hover:bg-gray-50"
                      onClick={(e) => { e.stopPropagation(); setSelectedVoice({ gender: voice.gender, id: voice.id }); setOpenDropdown(null); }}
                    >
                      <span className={selectedVoice?.id === voice.id ? 'text-gray-900' : 'text-gray-600'}>
                        {voice.label}
                      </span>
                      {selectedVoice?.id === voice.id && (
                        <div className="w-4 h-4 rounded-full flex items-center justify-center shrink-0" style={{ background: themeHex }}>
                          <CheckBadge width={9} height={9} style={{ stroke: 'white' }} />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {missingVoice && (
              <div className="mt-2 flex items-center gap-1.5 px-3 py-2 bg-red-50 border border-red-100 rounded-xl">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                <p className="text-[11.5px] text-red-600 font-semibold">Please select a voice to continue</p>
              </div>
            )}
          </div>
        </div>

          {/* Non-permission error */}
          {error && perm !== 'denied' && (
            <div className="shrink-0 flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-100 rounded-xl text-red-600 text-[11px] mb-2">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
              {error}
            </div>
          )}

          {/* CTA */}
          <button
            id="join-experience-btn"
            onClick={handleJoin}
            disabled={isLoading || isJoining}
            className="shrink-0 group w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-[14px] font-bold transition-all duration-150 hover:brightness-105 hover:-translate-y-[1px] active:translate-y-0 disabled:opacity-50 animate-pulse-glow"
            style={{ background: themeHex, color: onThemeHex, '--glow-color': toRgba(themeHex, 0.45) }}
          >
            {(isLoading || isJoining)
              ? <><RefreshIcon width={14} height={14} className="animate-spin" /> Setting up…</>
              : <>{perm === 'granted' ? 'Start Smart Experience' : 'Allow Access & Continue'} <ArrowRightIcon width={14} height={14} className="transition-transform duration-150 group-hover:translate-x-0.5" /></>
            }
          </button>

          {/* Privacy */}
          <div className="shrink-0 flex items-center justify-center gap-1.5 mt-2">
            <p className="text-[10px] text-gray-400 text-center">
              Powered by <a href="https://chqme.com/" target="_blank" rel="noopener noreferrer" className="hover:underline font-medium">ChQMe</a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
