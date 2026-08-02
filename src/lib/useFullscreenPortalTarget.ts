import { useEffect, useState } from 'react';

/** Resolves where a global-mount React portal should render: the current fullscreen element if
 *  one is active, else a named fallback element (when it exists — e.g. `#studio-root`), else
 *  `document.body`. A portal that only ever targets `document.body` renders outside the
 *  Fullscreen API's active element and is invisible per spec the moment fullscreen is entered, no
 *  matter how correct its own z-index/positioning is — this keeps the target current across
 *  `fullscreenchange` events (both entering and exiting) rather than resolving it once at mount.
 *  Shared by `Modal.tsx` (every studio dialog routes through it) and `MusicPlayer.tsx`. */
export function useFullscreenPortalTarget(fallbackId = 'studio-root'): HTMLElement {
  function resolve(): HTMLElement {
    return (document.fullscreenElement as HTMLElement | null) ?? document.getElementById(fallbackId) ?? document.body;
  }

  const [target, setTarget] = useState<HTMLElement>(resolve);

  useEffect(() => {
    const update = () => setTarget(resolve());
    update();
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fallbackId]);

  return target;
}
