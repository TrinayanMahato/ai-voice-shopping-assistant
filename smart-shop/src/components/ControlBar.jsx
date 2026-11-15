import React from 'react';

export default function ControlBar({
  isMicOn,
  isCameraOn,
  isScreenSharing,
  viewMode,
  toggleMic,
  toggleCamera,
  toggleScreenShare,
  toggleViewMode,
  handleLeave,
}) {
  const exactBtnClass = "flex items-center justify-center w-[46px] h-[46px] rounded-[12px] bg-gray-100 text-gray-700 cursor-pointer transition-all duration-200 border border-gray-200 hover:bg-gray-200 hover:-translate-y-[1px] active:translate-y-0 shadow-sm";

  return (
    <div className="flex justify-center items-center gap-[12px] p-[16px] bg-white border-t border-gray-200 z-10 shadow-[0_-4px_20px_rgba(0,0,0,0.02)]">
      {/* Mic Button */}
      <button
        id="ctrl-mic"
        className={`${exactBtnClass} ${!isMicOn ? '!bg-[#ef4444] hover:!bg-[#dc2626] !text-white' : ''} touch-none`}
        onPointerDown={(e) => { e.preventDefault(); toggleMic(true); }}
        onPointerUp={(e) => { e.preventDefault(); toggleMic(false); }}
        onPointerLeave={(e) => { toggleMic(false); }}
        onContextMenu={(e) => e.preventDefault()}
        title={isMicOn ? 'Release to Mute' : 'Hold to Speak'}
      >
        {isMicOn ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="1" y1="1" x2="23" y2="23" />
            <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
            <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        )}
      </button>

      {/* Camera Button */}
      <button
        id="ctrl-cam"
        className={`${exactBtnClass} ${!isCameraOn ? '!bg-[#ef4444] hover:!bg-[#dc2626] !text-white' : ''}`}
        onClick={toggleCamera}
        title={isCameraOn ? 'Stop Camera' : 'Start Camera'}
      >
        {isCameraOn ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="23 7 16 12 23 17 23 7" />
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="1" y1="1" x2="23" y2="23" />
            <path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m3-3h6l2 3h2a2 2 0 0 1 2 2v9.34m-7.72-2.06A4 4 0 1 1 7.72 7.72" />
          </svg>
        )}
      </button>

      {/* Screen Share Button */}
      <button
        id="ctrl-screen"
        className={`${exactBtnClass} ${isScreenSharing ? '!bg-[#10b981] hover:!bg-[#059669] !text-white' : ''}`}
        onClick={toggleScreenShare}
        title={isScreenSharing ? 'Stop Screen Share' : 'Share Screen'}
      >
        {isScreenSharing ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
            <polyline points="12 12 12 7 9 10" />
            <line x1="12" y1="7" x2="15" y2="10" />
          </svg>
        )}
      </button>

      {/* View Mode Button */}
      <button
        id="ctrl-view"
        className={exactBtnClass}
        onClick={toggleViewMode}
        title={viewMode === 'gallery' ? 'Switch to Focused View' : 'Switch to Gallery View'}
      >
        {viewMode === 'gallery' ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <rect x="7" y="7" width="10" height="10" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="14" y="14" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
          </svg>
        )}
      </button>

      <div className="w-[1px] h-[38px] bg-gray-300" />

      {/* Leave Button */}
      <button
        id="ctrl-leave"
        className={`${exactBtnClass} !bg-[#ef4444] hover:!bg-[#dc2626] !text-white !px-[22px] !w-auto !rounded-full gap-[6px] shadow-md`}
        onClick={() => handleLeave()}
        title="Leave meeting"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
        <span className="text-[14px] font-semibold tracking-wide">Leave</span>
      </button>
    </div>
  );
}
