import { useEffect, useState } from 'react';

// Detects whether we should render the mobile layout, and the current orientation.
//
// isMobile  → coarse pointer + no hover (phones / tablets), additionally guarded by
//             the smaller screen dimension so large touch monitors stay on desktop.
// isPortrait → true when the viewport is taller than it is wide.
//
// The value is computed once at mount and kept in sync on resize / orientation change.
function computeMode() {
  if (typeof window === 'undefined') {
    return { isMobile: false, isPortrait: false };
  }
  const coarse = window.matchMedia('(pointer: coarse) and (hover: none)').matches;
  const smallSide = Math.min(
    window.screen?.width || window.innerWidth,
    window.screen?.height || window.innerHeight
  );
  const isMobile = coarse && smallSide <= 900;
  // Derive orientation from the iframe's own box rather than the orientation
  // media query — the latter is unreliable inside the Shopify embed. Taller
  // than (or equal to) wide ⇒ portrait, which gates the "rotate your device"
  // notice. Matches the robust check in AIRoomView.
  const isPortrait = window.innerHeight >= window.innerWidth;
  return { isMobile, isPortrait };
}

export function useDeviceMode() {
  const [mode, setMode] = useState(computeMode);

  useEffect(() => {
    const update = () => setMode(computeMode());

    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);

    const orientationMq = window.matchMedia('(orientation: portrait)');
    orientationMq.addEventListener?.('change', update);

    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      orientationMq.removeEventListener?.('change', update);
    };
  }, []);

  return mode;
}
