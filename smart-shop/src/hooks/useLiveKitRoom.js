import { useState, useRef, useEffect } from 'react';
import { Room, RoomEvent, Track, createLocalTracks } from 'livekit-client';
import { renderRemoteTrack } from '../utils/trackRenderer';
import { useLocalVideoReattach } from './useLocalVideoReattach';

// Proxied to d2capis (see vite.config.js '/cart/api' -> https://d2capis.chqme.com).
const GEN_TOKEN_URL = '/cart/api/chqme/generate_meeting_token';

const LIVEKIT_WS_URL = 'wss://smartshop.chqme.com/connect';

/**
 * useLiveKitRoom
 *
 * Encapsulates all LiveKit meeting logic, WebRTC event listeners,
 * device toggles (mic, camera, screen share), layout mode, and room cleanup.
 *
 * generate_meeting_token derives both the room and the participant identity
 * from `callToken` alone (room = call token, identity = CUST_<call token>) —
 * so this hook only ever needs to send the token, never a separate roomid/userid.
 */
export function useLiveKitRoom({
  phase,
  setPhase,
  setErrMsg,
  callToken,
  setUserName,
  setMeetingDetails,
}) {
  const roomRef = useRef(null);
  const localVideoRef = useRef(null);
  const [participants, setParticipants] = useState([]);
  const [isMicOn, setIsMicOn] = useState(true);
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [viewMode, setViewMode] = useState('gallery');
  const [copied, setCopied] = useState(false);

  // Call the re-attach hook internally so the page doesn't have to worry about it
  useLocalVideoReattach(phase, isCameraOn, roomRef, localVideoRef);

  // Helper to ensure a remote card is focused when in focused layout mode
  const ensureFocus = () => {
    setTimeout(() => {
      if (!document.querySelector('.is-focused')) {
        document.querySelector('.video-card')?.classList.add('is-focused');
      }
    }, 50);
  };

  // ── Step 3: WebSocket connect + LiveKit room setup ────────────────────────
  // `initialDevices` carries the mic/camera choice made on the pre-join preview
  // screen (ReadyToJoinScreen) through to the actual room join, instead of
  // always publishing both regardless of what the user picked.
  const connectToLiveKit = async (token, initialDevices = {}) => {
    const wantMic = initialDevices.isMicOn !== false;
    const wantCamera = initialDevices.isCameraOn !== false;
    setIsMicOn(wantMic);
    setIsCameraOn(wantCamera);

    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
    });

    roomRef.current = room;

    // Always start in gallery mode when connecting
    setViewMode('gallery');
    // Remove any stale is-focused classes from previous session
    document.querySelectorAll('.video-card').forEach((c) => c.classList.remove('is-focused'));

    // Handle LiveKit server responses / events
    room.on(RoomEvent.Connected, () => {
      console.log('[LiveKit] Connected to room:', room.name);
      setPhase('connected');
    });

    room.on(RoomEvent.Disconnected, (reason) => {
      console.log('[LiveKit] Disconnected:', reason);
      setPhase('ready');
      setParticipants([]);
      const el = document.getElementById('remote-tracks');
      if (el) el.innerHTML = '';
    });

    room.on(RoomEvent.Reconnecting, () => {
      console.log('[LiveKit] Reconnecting…');
    });

    room.on(RoomEvent.Reconnected, () => {
      console.log('[LiveKit] Reconnected to room:', room.name);
    });

    room.on(RoomEvent.ParticipantConnected, (participant) => {
      console.log('[LiveKit] Participant joined:', participant.identity);
      setParticipants((prev) => [...prev, participant.identity]);
    });

    room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      console.log('[LiveKit] Participant left:', participant.identity);
      setParticipants((prev) => prev.filter((id) => id !== participant.identity));
      participant.trackPublications.forEach((pub) => {
        document.getElementById(`track-${pub.trackSid}-container`)?.remove();
        document.getElementById(`track-${pub.trackSid}-audio`)?.remove();
      });
      ensureFocus();
    });

    room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      console.log(`[LiveKit] Track subscribed: ${track.kind} from ${participant.identity}`);
      renderRemoteTrack(publication, participant);
    });

    room.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
      console.log(`[LiveKit] Track unsubscribed: ${track.kind}`);
      track.detach();
      document.getElementById(`track-${publication.trackSid}-container`)?.remove();
      document.getElementById(`track-${publication.trackSid}-audio`)?.remove();
      ensureFocus();
    });

    room.on(RoomEvent.MediaDevicesError, (err) => {
      console.error('[LiveKit] Media device error:', err);
    });

    room.on(RoomEvent.ConnectionQualityChanged, (quality, participant) => {
      console.log(`[LiveKit] Connection quality for ${participant.identity}: ${quality}`);
    });

    room.on(RoomEvent.DataReceived, (payload, participant) => {
      const text = new TextDecoder().decode(payload);
      console.log(`[LiveKit] Data from ${participant?.identity}:`, text);
    });

    room.on(RoomEvent.LocalTrackPublished, (publication, participant) => {
      console.log('[LiveKit] Local track published:', publication.trackSid);
      if (publication.track && publication.source === Track.Source.ScreenShare) {
        setIsScreenSharing(true);
        const wrapper = document.createElement('div');
        wrapper.className = 'video-card local-screen-card group relative bg-[#14141f] rounded-[14px] overflow-hidden border border-[rgba(255,255,255,0.04)] shadow-[0_8px_24px_rgba(0,0,0,0.2)] transition-all duration-300 ease-in cursor-pointer hover:border-[rgba(255,255,255,0.15)]';
        wrapper.id = `track-${publication.trackSid}-container`;

        const video = document.createElement('video');
        video.id = `track-${publication.trackSid}-video`;
        video.autoplay = true;
        video.playsInline = true;
        video.muted = true;
        video.className = 'remote-video w-full h-full object-contain bg-black';

        wrapper.onclick = (e) => {
          document.querySelectorAll('.video-card').forEach((c) => c.classList.remove('is-focused'));
          e.currentTarget.classList.add('is-focused');
        };

        const badge = document.createElement('div');
        badge.className = 'vid-badge absolute bottom-[12px] left-[12px] bg-[rgba(10,10,16,0.65)] backdrop-blur-[8px] text-white text-[11px] font-semibold px-[12px] py-[5px] rounded-[8px] border border-[rgba(255,255,255,0.05)] z-10 pointer-events-none';
        badge.innerText = 'You (Screen Share)';

        const maxBtn = document.createElement('button');
        maxBtn.className = 'maximize-btn absolute top-[12px] right-[12px] bg-[rgba(10,10,16,0.65)] backdrop-blur-[8px] border border-[rgba(255,255,255,0.05)] text-white w-[28px] h-[28px] rounded-[8px] cursor-pointer text-[14px] flex items-center justify-center z-10 opacity-100 md:opacity-0 transition-opacity duration-200 md:group-hover:opacity-100 hover:bg-[rgba(255,255,255,0.1)]';
        maxBtn.innerText = '⛶';
        maxBtn.title = 'Toggle Fullscreen';
        maxBtn.onclick = (e) => {
          e.stopPropagation();
          if (wrapper.classList.contains('is-maximized')) {
            wrapper.classList.remove('is-maximized');
            wrapper.style.cssText = '';
          } else {
            wrapper.classList.add('is-maximized');
            wrapper.style.cssText = 'position: fixed !important; top: 0 !important; left: 0 !important; width: 100vw !important; height: 100dvh !important; z-index: 9999 !important; border-radius: 0 !important; margin: 0 !important;';
          }
        };

        wrapper.appendChild(video);
        wrapper.appendChild(maxBtn);
        wrapper.appendChild(badge);
        document.getElementById('remote-tracks')?.appendChild(wrapper);
        publication.track.attach(video);

        // Auto-maximize the screen share card as soon as it appears
        wrapper.classList.add('is-maximized');
        wrapper.style.cssText = 'position: fixed !important; top: 0 !important; left: 0 !important; width: 100vw !important; height: 100dvh !important; z-index: 9999 !important; border-radius: 0 !important; margin: 0 !important;';
      }
    });

    room.on(RoomEvent.LocalTrackUnpublished, (publication, participant) => {
      console.log('[LiveKit] Local track unpublished:', publication.trackSid);
      if (publication.source === Track.Source.ScreenShare) {
        setIsScreenSharing(false);
        document.getElementById(`track-${publication.trackSid}-container`)?.remove();
        ensureFocus();
      }
    });

    // Open WebSocket connection to connect.chqme.com
    await room.connect(LIVEKIT_WS_URL, token);

    // Publish local camera + mic, honoring the pre-join preview's choice
    if (wantMic || wantCamera) {
      const localTracks = await createLocalTracks({ 
        audio: wantMic ? {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        } : false, 
        video: wantCamera 
      });
      for (const track of localTracks) {
        await room.localParticipant.publishTrack(track);
        if (track.kind === Track.Kind.Video && localVideoRef.current) {
          track.attach(localVideoRef.current);
        }
      }
    }

    // Render tracks from participants already in room
    room.remoteParticipants.forEach((participant) => {
      participant.trackPublications.forEach((pub) => {
        if (pub.isSubscribed) renderRemoteTrack(pub, participant);
      });
    });

    setParticipants(Array.from(room.remoteParticipants.values()).map((p) => p.identity));
  };

  // ── Step 2: Join Room handler ─────────────────────────────────────────────
  // Guards against a double-fire (double-click before the re-render that hides
  // the Join button commits, or any other accidental re-invoke) minting a
  // second LiveKit token for the same call token.
  const joinInFlightRef = useRef(false);
  const handleJoinRoom = async (devicePrefs = {}) => {
    if (joinInFlightRef.current) return;
    joinInFlightRef.current = true;
    setPhase('joining');

    try {
      // Call d2capis to generate a LiveKit token. The call token alone is enough --
      // the backend derives both the room id and the CUST_<room_id> identity from it.
      const aiCallToken = sessionStorage.getItem('ai_call_token') || callToken;
      
      const res = await fetch(GEN_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: aiCallToken }),
      });
      const data = await res.json();

      if (data.status_code !== 0) {
        throw new Error(data.status_msg || 'Failed to generate LiveKit token');
      }

      const returnData = (data.return_data || [])[0] || {};
      const livekitToken = returnData.token;
      if (!livekitToken) throw new Error('No token returned from server');

      const roomId = returnData.room_id || callToken;

      // Store core livekit session fields
      sessionStorage.setItem('livekit_token', livekitToken);
      sessionStorage.setItem('livekit_room', roomId);
      sessionStorage.setItem('livekit_identity', returnData.identity || '');

      // Connect to LiveKit server via WebSocket
      await connectToLiveKit(livekitToken, devicePrefs);
    } catch (err) {
      console.error(err);
      setErrMsg(`Failed to join: ${err.message}`);
      setPhase('error');
      joinInFlightRef.current = false;   // allow a retry
    }
  };

  // ── Controls ───────────────────────────────────────────────────────────────
  const toggleMic = async () => {
    if (!roomRef.current) return;
    try {
      if (isMicOn) {
        for (const pub of roomRef.current.localParticipant.audioTrackPublications.values()) {
          if (pub.track && pub.source === Track.Source.Microphone) {
            await roomRef.current.localParticipant.unpublishTrack(pub.track);
          }
        }
      } else {
        const tracks = await createLocalTracks({ 
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          }, 
          video: false 
        });
        for (const t of tracks) {
          if (t.source === Track.Source.Microphone) {
            await roomRef.current.localParticipant.publishTrack(t);
          }
        }
      }
      setIsMicOn((v) => !v);
    } catch (err) {
      console.error(err);
    }
  };

  const toggleCamera = async () => {
    if (!roomRef.current) return;
    try {
      if (isCameraOn) {
        for (const pub of roomRef.current.localParticipant.videoTrackPublications.values()) {
          if (pub.track && pub.source === Track.Source.Camera) {
            pub.track.detach();
            await roomRef.current.localParticipant.unpublishTrack(pub.track);
          }
        }
        if (localVideoRef.current) localVideoRef.current.srcObject = null;
      } else {
        const tracks = await createLocalTracks({ audio: false, video: true });
        for (const t of tracks) {
          if (t.source === Track.Source.Camera) {
            await roomRef.current.localParticipant.publishTrack(t);
            if (localVideoRef.current) t.attach(localVideoRef.current);
          }
        }
      }
      setIsCameraOn((v) => !v);
    } catch (err) {
      console.error(err);
    }
  };

  const toggleScreenShare = async () => {
    if (!roomRef.current) return;
    try {
      if (isScreenSharing) {
        await roomRef.current.localParticipant.setScreenShareEnabled(false);
        setIsScreenSharing(false);
      } else {
        await roomRef.current.localParticipant.setScreenShareEnabled(true);
        setIsScreenSharing(true);
      }
    } catch (err) {
      console.error('Screen share error:', err);
      setIsScreenSharing(false);
    }
  };

  const toggleViewMode = () => {
    setViewMode((prev) => {
      const nextMode = prev === 'gallery' ? 'focused' : 'gallery';
      if (nextMode === 'focused') {
        setTimeout(() => {
          const firstCard = document.querySelector('.video-card');
          if (firstCard && !document.querySelector('.is-focused')) {
            firstCard.classList.add('is-focused');
          }
        }, 0);
      }
      return nextMode;
    });
  };

  const handleLeave = async () => {
    // 1. Clear storage immediately to prevent auto-rejoin if 'Disconnected' event fires early
    sessionStorage.removeItem('livekit_token');
    sessionStorage.removeItem('livekit_room');
    sessionStorage.removeItem('livekit_identity');

    // 2. Disconnect from LiveKit
    try {
      await roomRef.current?.disconnect();
    } catch (err) {
      console.error('[LiveKit] Error disconnecting:', err);
    }

    // 3. Cleanup state
    roomRef.current = null;
    joinInFlightRef.current = false;   // allow rejoining
    const el = document.getElementById('remote-tracks');
    if (el) el.innerHTML = '';
    setParticipants([]);
    setIsScreenSharing(false);
    setViewMode('gallery');
    setPhase('ready');
  };

  const copyRoomCode = () => {
    navigator.clipboard.writeText(callToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ── Auto-Reconnect Logic ──────────────────────────────────────────────────
  useEffect(() => {
    if (phase === 'ready') {
      const storedToken = sessionStorage.getItem('livekit_token');
      const storedRoom = sessionStorage.getItem('livekit_room');

      // If we have a token and the room matches this call token
      if (storedToken && storedRoom === callToken) {
        console.log('[LiveKit] Found token in sessionStorage, auto-reconnecting...');
        setPhase('joining');
        connectToLiveKit(storedToken).catch(err => {
          console.error('[LiveKit] Auto-reconnect failed:', err);
          setErrMsg(`Auto-reconnect failed: ${err.message}`);
          setPhase('error');
          sessionStorage.removeItem('livekit_token');
          sessionStorage.removeItem('livekit_room');
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, callToken]);

  return {
    roomRef,
    localVideoRef,
    participants,
    isMicOn,
    isCameraOn,
    isScreenSharing,
    viewMode,
    copied,
    handleJoinRoom,
    toggleMic,
    toggleCamera,
    toggleScreenShare,
    toggleViewMode,
    handleLeave,
    copyRoomCode,
  };
}
