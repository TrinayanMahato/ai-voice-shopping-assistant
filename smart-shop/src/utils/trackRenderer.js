import { Track } from 'livekit-client';

// ── Remote track renderer ──────────────────────────────────────────────────────
// Receives a RemoteTrackPublication and the RemoteParticipant who published it.
// Creates and appends the necessary <video> or <audio> DOM elements.
export const renderRemoteTrack = (publication, participant) => {
  if (!publication.track) return;
  const track = publication.track;

  if (track.kind === Track.Kind.Video) {
    if (document.getElementById(`track-${publication.trackSid}-video`)) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'relative w-full aspect-[4/3] bg-gradient-to-br from-gray-200 to-gray-300 rounded-2xl overflow-hidden shadow-sm flex items-center justify-center';
    wrapper.id = `track-${publication.trackSid}-container`;

    const video = document.createElement('video');
    video.id = `track-${publication.trackSid}-video`;
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    video.className = 'absolute inset-0 w-full h-full object-cover bg-black';

    const badge = document.createElement('div');
    badge.className = 'absolute bottom-3 right-3 bg-gray-900/80 px-2 py-1 rounded text-[11px] font-bold text-white tracking-wide z-10 pointer-events-none';
    const isScreenShare = publication.source === Track.Source.ScreenShare;
    badge.innerText = `${participant.identity === 'agent-1' ? 'Sophia AI' : participant.identity}${isScreenShare ? ' (Screen)' : ''}`;

    wrapper.appendChild(video);
    wrapper.appendChild(badge);
    document.getElementById('remote-tracks')?.appendChild(wrapper);
    track.attach(video);
  } else if (track.kind === Track.Kind.Audio) {
    if (document.getElementById(`track-${publication.trackSid}-audio`)) return;
    const audio = document.createElement('audio');
    audio.id = `track-${publication.trackSid}-audio`;
    audio.autoplay = true;
    document.body.appendChild(audio);
    track.attach(audio);
  }
};
