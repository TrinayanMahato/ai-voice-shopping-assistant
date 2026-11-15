import { useEffect } from 'react';
import { Track } from 'livekit-client';

/**
 * useLocalVideoReattach
 *
 * Runs on every render to ensure the local camera track is always
 * attached to the local <video> element. This prevents the preview
 * from going black when React re-renders the component (e.g. when
 * screen sharing is toggled or a remote participant joins/leaves).
 *
 * @param {string}  phase         - Current app phase (must be 'connected')
 * @param {boolean} isCameraOn    - Whether the local camera is active
 * @param {object}  roomRef       - React ref holding the LiveKit Room instance
 * @param {object}  localVideoRef - React ref pointing to the local <video> element
 */
export function useLocalVideoReattach(phase, isCameraOn, roomRef, localVideoRef) {
  useEffect(() => {
    if (phase === 'connected' && isCameraOn && roomRef.current && localVideoRef.current) {
      const cameraPub = Array.from(
        roomRef.current.localParticipant.videoTrackPublications.values()
      ).find((pub) => pub.source === Track.Source.Camera);

      if (cameraPub && cameraPub.track) {
        cameraPub.track.attach(localVideoRef.current);
      }
    }
  }); // No dependency array — intentionally runs on every render
}
