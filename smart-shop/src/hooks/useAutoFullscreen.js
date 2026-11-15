import { useEffect } from 'react';

export function useAutoFullscreen(enabled) {
  useEffect(() => {
    if (!enabled) return;

    const el = document.documentElement;
    const req =
      el.requestFullscreen ||
      el.webkitRequestFullscreen ||
      el.mozRequestFullScreen ||
      el.msRequestFullscreen;
    if (!req) return;

    let done = false;     // fullscreen confirmed → stop listening
    let pending = false;  // a request is in flight → ignore duplicate events in the same tap

    const isFs = () =>
      !!(document.fullscreenElement || document.webkitFullscreenElement);

    const cleanup = () => {
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('touchend', onGesture);
      window.removeEventListener('click', onGesture);
    };

    const onGesture = () => {
      if (done || pending) return;
      // Already full-screen (e.g. the user hit the button first) — we're done.
      if (isFs()) {
        done = true;
        cleanup();
        return;
      }
      try {
        const p = req.call(el);
        if (p && typeof p.then === 'function') {
          // Only commit once the request resolves. On rejection, drop the
          // in-flight guard and leave the listeners armed so the next gesture
          // (often a "cleaner" click) can try again.
          pending = true;
          p.then(() => {
            done = true;
            cleanup();
          }).catch(() => {
            pending = false;
          });
        } else {
          // Older WebKit returns no promise — assume it took and stop listening.
          done = true;
          cleanup();
        }
      } catch {
        /* fullscreen not permitted right now — leave listeners armed to retry */
      }
    };

    // pointerdown/touchend cover the earliest signal; click is the most reliable
    // activation source and backstops the two when they don't grant it.
    window.addEventListener('pointerdown', onGesture, { passive: true });
    window.addEventListener('touchend', onGesture, { passive: true });
    window.addEventListener('click', onGesture, { passive: true });

    return cleanup;
  }, [enabled]);
}
