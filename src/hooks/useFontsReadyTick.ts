import { useEffect, useState } from 'react';
import { subscribeFontsReady } from '../lib/fontLoader';

/** Bumps whenever a font finishes registering with `document.fonts` — include in a `useMemo`'s deps
 *  (or just call it, for values computed inline on every render) to recompute text layout/metrics
 *  that may have been measured with fallback-font metrics before the real font was ready. */
export function useFontsReadyTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => subscribeFontsReady(() => setTick(t => t + 1)), []);
  return tick;
}
