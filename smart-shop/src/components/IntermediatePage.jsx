import { useState } from 'react';
import ReadyToJoinScreen from './ReadyToJoinScreen';

// ── Icons — kept as plain inline SVG (this app's existing convention; no icon
// library dependency), standing in for lucide-react's ShieldAlert/AlertTriangle
// used by chqme-meetings-frontend's status screens. ──────────────────────────
const ShieldAlertIcon = (props) => (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);

const AlertTriangleIcon = (props) => (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

const ArrowRightIcon = (props) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </svg>
);

// ─────────────────────────────────────────────────────────────────────────────
// IntermediatePage — everything before the live call: validating the link,
// the access-denied / error dead-ends, and the ready-to-join confirmation.
//
// Modeled directly on chqme-meetings-frontend's UnifiedMeetingStatusScreen and
// its "isValidating" spinner card (dark radial-gradient backdrop, glass card,
// icon in a glowing circle, "Close Tab" dead-ends) so both apps' pre-join
// experience read as one product, even though the underlying stacks differ.
// ─────────────────────────────────────────────────────────────────────────────
const ROOT = 'fixed inset-0 flex items-center justify-center p-4 bg-gray-50';
const CARD = 'w-full max-w-[440px] bg-white border border-gray-200 rounded-[24px] px-8 py-10 shadow-xl flex flex-col items-center text-center animate-fadein';

function Spinner({ label, sellerConfig }) {
  return (
    <div className={ROOT}>
      <div className={CARD}>
        <div className="w-9 h-9 rounded-full border-[3px] border-gray-200 border-t-[#6366f1] animate-spin-fast" />
        <p className="mt-6 text-[15px] font-semibold text-gray-900">{label}</p>
        <span className="mt-2 text-[11px] font-bold tracking-[0.08em] text-gray-400">
          Powered by <a href="https://chqme.com/" target="_blank" rel="noopener noreferrer" className="hover:text-indigo-500 transition-colors">ChQMe</a>
        </span>
      </div>
    </div>
  );
}

function StatusScreen({ icon: Icon, iconColor, glow, title, subtitle, children }) {
  return (
    <div className={ROOT}>
      <div className={CARD}>
        <div
          className="w-[72px] h-[72px] rounded-full flex items-center justify-center mb-6 border border-gray-200"
          style={{ background: glow, boxShadow: `0 0 30px ${glow}` }}
        >
          <Icon style={{ color: iconColor }} />
        </div>
        <h1 className="text-[22px] font-bold text-gray-900 mb-2.5 tracking-tight">{title}</h1>
        <p className="text-[14px] text-gray-500 mb-7 leading-relaxed">{subtitle}</p>
        {children}
      </div>
    </div>
  );
}

function CloseTabButton() {
  const [attempted, setAttempted] = useState(false);
  return (
    <>
      <button
        onClick={() => { setAttempted(true); try { window.close(); } catch { } }}
        className="inline-flex items-center justify-center gap-2 w-full bg-gray-100 text-gray-800 border border-gray-200 rounded-[14px] px-6 py-3 text-sm font-semibold hover:bg-gray-200 transition-colors"
      >
        Close Tab <ArrowRightIcon />
      </button>
      {attempted && (
        <p className="mt-4 text-[13px] text-[#f87171]">If the tab didn't close, please close it manually.</p>
      )}
    </>
  );
}

export default function IntermediatePage({ phase, errMsg, userName, meetingDetails, sellerConfig, handleJoinRoom }) {
  if (phase === 'validating') {
    return <Spinner label="Preparing your meeting…" sellerConfig={sellerConfig} />;
  }

  if (phase === 'joining') {
    return <Spinner label="Generating token & connecting…" sellerConfig={sellerConfig} />;
  }

  if (phase === 'denied') {
    return (
      <StatusScreen
        icon={ShieldAlertIcon}
        iconColor="#ef4444"
        glow="rgba(239, 68, 68, 0.15)"
        title="Cannot access this meeting room"
        subtitle="You don't have permission to join this session. If you believe this is a mistake, please reach out to our team."
      >
        <CloseTabButton />
      </StatusScreen>
    );
  }

  if (phase === 'error') {
    return (
      <StatusScreen
        icon={AlertTriangleIcon}
        iconColor="#ef4444"
        glow="rgba(239, 68, 68, 0.15)"
        title="Meeting link not found"
        subtitle={errMsg || "We couldn't verify this meeting link. It might have expired or is invalid."}
      >
        <CloseTabButton />
      </StatusScreen>
    );
  }

  if (phase === 'ready') {
    return (
      <ReadyToJoinScreen
        userName={userName}
        meetingDetails={meetingDetails}
        sellerConfig={sellerConfig}
        onJoin={handleJoinRoom}
      />
    );
  }

  if (phase === 'ended') {
    return (
      <StatusScreen
        icon={(props) => (
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
        )}
        iconColor="#10b981"
        glow="rgba(16, 185, 129, 0.15)"
        title="Meeting Ended"
        subtitle="Thank you for joining. The session has concluded and you can safely close this tab."
      >
        <CloseTabButton />
      </StatusScreen>
    );
  }

  return null;
}
