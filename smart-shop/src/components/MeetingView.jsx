import ControlBar from './ControlBar';
import IntermediatePage from './IntermediatePage';
import React, { useState, useEffect } from 'react';

export default function MeetingView({
  phase,
  errMsg,
  userName,
  meetingDetails,
  localVideoRef,
  participants,
  isMicOn,
  isCameraOn,
  isScreenSharing,
  viewMode,
  handleJoinRoom,
  toggleMic,
  toggleCamera,
  toggleScreenShare,
  toggleViewMode,
  handleLeave,
}) {
  const [remoteTrackCount, setRemoteTrackCount] = useState(0);

  useEffect(() => {
    if (phase === 'connected') {
      const target = document.getElementById('remote-tracks');
      if (target) {
        setRemoteTrackCount(target.childElementCount);
        const observer = new MutationObserver(() => {
          setRemoteTrackCount(target.childElementCount);
        });
        observer.observe(target, { childList: true });
        return () => observer.disconnect();
      }
    }
  }, [phase]);

  // Everything before the live call (validating / denied / error / ready / joining)
  // lives in IntermediatePage — see that file for the CDE-style status screens.
  if (phase !== 'connected') {
    return (
      <IntermediatePage
        phase={phase}
        errMsg={errMsg}
        userName={userName}
        meetingDetails={meetingDetails}
        handleJoinRoom={handleJoinRoom}
      />
    );
  }

  // ── CONNECTED — live video room ──────────────────────────────────────────
  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden bg-[#06060a]">
      {/* Header */}
      <div className="flex justify-between items-center px-[24px] py-[14px] bg-[rgba(10,10,16,0.75)] border-b border-[rgba(255,255,255,0.05)] backdrop-blur-[16px] z-10">
        <div className="flex items-center gap-[12px]">
          {meetingDetails.brand_logo && (
            <img src={meetingDetails.brand_logo} alt="" className="w-[34px] h-[34px] rounded-[8px] object-contain bg-[rgba(255,255,255,0.07)] p-[4px]" />
          )}
          <div>
            {meetingDetails.product_name && (
              <p className="text-[11px] font-semibold text-[rgba(255,255,255,0.45)] uppercase tracking-[0.05em] mb-[1px]">{meetingDetails.product_name}</p>
            )}
            <div className="flex flex-col">
              <span className="text-[15px] font-bold text-white tracking-[-0.01em]">CHQME Meeting</span>
              <img src={`${import.meta.env.BASE_URL}chqme-logo.png.ico`} alt="Powered by ChQMe" className="h-[40px] object-contain opacity-95 mt-[4px]" style={{ transformOrigin: 'left center' }} />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-[10px]">
          <span className="text-[12px] font-semibold text-[rgba(255,255,255,0.65)] bg-[rgba(255,255,255,0.05)] px-[12px] py-[5px] rounded-[8px] border border-[rgba(255,255,255,0.03)] mr-[8px]">👤 {userName}</span>
          {participants.length > 0 && (
            <span className="text-[12px] font-semibold text-[rgba(255,255,255,0.65)] bg-[rgba(255,255,255,0.05)] px-[12px] py-[5px] rounded-[8px] border border-[rgba(255,255,255,0.03)]">👥 {participants.length + 1}</span>
          )}
          <span className="text-[10px] font-extrabold text-[#f87171] bg-[rgba(248,113,113,0.1)] px-[12px] py-[5px] rounded-[8px] border border-[rgba(248,113,113,0.2)] tracking-[0.04em]">● LIVE</span>
        </div>
      </div>

      {/* Video grid */}
      {(() => {
        const totalVideos = 1 + remoteTrackCount;
        let cols = 1;
        let rows = 1;
        const isPortrait = typeof window !== 'undefined' && window.innerHeight > window.innerWidth;

        if (totalVideos === 1) { cols = 1; rows = 1; }
        else if (totalVideos === 2) {
          if (isPortrait) { cols = 1; rows = 2; }
          else { cols = 2; rows = 1; }
        }
        else if (totalVideos === 3 || totalVideos === 4) { cols = 2; rows = 2; }
        else if (totalVideos > 4 && totalVideos <= 6) { cols = 3; rows = 2; }
        else if (totalVideos > 6 && totalVideos <= 9) { cols = 3; rows = 3; }
        else if (totalVideos > 9 && totalVideos <= 16) { cols = 4; rows = 4; }
        else if (totalVideos > 16) { cols = 5; rows = Math.ceil(totalVideos / 5); }

        const isGallery = viewMode === 'gallery';
        const focusedGridClass = "flex flex-row items-end md:flex-col md:items-end gap-[12px] overflow-x-auto overflow-y-hidden md:overflow-x-hidden md:overflow-y-auto [&_.video-card]:w-[120px] md:[&_.video-card]:w-[240px] [&_.video-card]:h-[100px] md:[&_.video-card]:h-[160px] [&_.video-card]:shrink-0 [&_.video-card.is-focused]:!absolute [&_.video-card.is-focused]:!top-[16px] [&_.video-card.is-focused]:!left-[16px] [&_.video-card.is-focused]:!w-[calc(100%-32px)] md:[&_.video-card.is-focused]:!w-[calc(100%-288px)] [&_.video-card.is-focused]:!h-[calc(100%-148px)] md:[&_.video-card.is-focused]:!h-[calc(100%-32px)] [&_.video-card.is-focused]:!z-10";

        return (
          <div className="flex-1 relative w-full h-full min-h-0 bg-[#09090f] overflow-hidden">

            <div
              className={`video-grid w-full h-full p-[16px] ${isGallery ? 'overflow-y-auto grid gap-[12px] items-stretch justify-items-stretch' : focusedGridClass}`}
              style={isGallery ? {
                gridTemplateColumns: `repeat(${cols}, 1fr)`,
                gridTemplateRows: `repeat(${rows}, 1fr)`,
              } : {}}
            >
              {/* Local tile */}
              <div
                className={`video-card group relative bg-[#14141f] rounded-[14px] overflow-hidden border border-[rgba(255,255,255,0.04)] shadow-[0_8px_24px_rgba(0,0,0,0.2)] transition-all duration-300 ease-in cursor-pointer hover:border-[rgba(255,255,255,0.15)]`}
                onClick={(e) => {
                  if (!isGallery) {
                    document.querySelectorAll('.video-card').forEach(c => c.classList.remove('is-focused'));
                    e.currentTarget.classList.add('is-focused');
                  }
                }}
              >
                <video ref={localVideoRef} autoPlay playsInline muted className="local-video w-full h-full object-contain bg-black" />
                <button
                  className="maximize-btn absolute top-[12px] right-[12px] bg-[rgba(10,10,16,0.65)] backdrop-blur-[8px] border border-[rgba(255,255,255,0.05)] text-white w-[28px] h-[28px] rounded-[8px] cursor-pointer text-[14px] flex items-center justify-center z-10 opacity-100 md:opacity-0 transition-opacity duration-200 md:group-hover:opacity-100 hover:bg-[rgba(255,255,255,0.1)]"
                  onClick={(e) => {
                    e.stopPropagation();
                    const p = e.currentTarget.parentElement;
                    if (p.classList.contains('is-maximized')) {
                      p.classList.remove('is-maximized');
                      p.style.cssText = '';
                    } else {
                      p.classList.add('is-maximized');
                      p.style.cssText = 'position: fixed !important; top: 0 !important; left: 0 !important; width: 100vw !important; height: 100dvh !important; z-index: 9999 !important; border-radius: 0 !important; margin: 0 !important;';
                    }
                  }}
                  title="Toggle Fullscreen"
                >⛶</button>
                <div className="absolute bottom-[12px] left-[12px] bg-[rgba(10,10,16,0.65)] backdrop-blur-[8px] text-white text-[11px] font-semibold px-[12px] py-[5px] rounded-[8px] border border-[rgba(255,255,255,0.05)] z-10 pointer-events-none">
                  {userName}&nbsp;(You)&nbsp;
                  {!isMicOn && '🔇'}
                  {!isCameraOn && '📷'}
                </div>
              </div>

              {/* Remote tracks — injected by renderRemoteTrack() */}
              <div id="remote-tracks" className="contents" />
            </div>
          </div>
        );
      })()}

      {/* Control bar */}
      <ControlBar
        isMicOn={isMicOn}
        isCameraOn={isCameraOn}
        isScreenSharing={isScreenSharing}
        viewMode={viewMode}
        toggleMic={toggleMic}
        toggleCamera={toggleCamera}
        toggleScreenShare={toggleScreenShare}
        toggleViewMode={toggleViewMode}
        handleLeave={handleLeave}
      />
    </div>
  );
}
