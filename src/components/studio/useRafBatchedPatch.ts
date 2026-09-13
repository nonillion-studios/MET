import { useEffect, useRef } from 'react';

/**
 * Coalesces a hot-path callback (fired many times per animation frame, e.g. Konva's `onTransform`
 * dispatch or a slider's `onChange`) into at most one call per frame, so the caller's own
 * (typically expensive, top-of-tree) state update doesn't run more often than the screen can
 * actually show it. `onUpdate` is read from a ref on every call rather than captured once, so a
 * new function identity each render (the common case when this is wired from an inline prop) never
 * produces a stale closure.
 *
 * Deliberately `requestAnimationFrame`, not `flushSync` — this defers to the next paint instead of
 * forcing a synchronous React flush mid-dispatch, so it can't reintroduce the scheduler race
 * documented on TextLayerNode.tsx's `onTransform` handler.
 *
 * `flush()` must be called from whatever "drag ended" event fires after the hot-path callback
 * stops, or the last in-flight frame is silently dropped. `cancel()` discards a pending frame
 * without delivering it — for a caller (like `onTransformEnd`) that's about to send its own,
 * more authoritative final patch and needs to make sure a stale queued frame can't land after it.
 */
export function useRafBatchedPatch<T>(onUpdate: (patch: T) => void) {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<T | null>(null);

  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
  }, []);

  function schedule(patch: T) {
    pendingRef.current = patch;
    if (rafRef.current == null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        if (pendingRef.current != null) { onUpdateRef.current(pendingRef.current); pendingRef.current = null; }
      });
    }
  }

  function flush() {
    if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (pendingRef.current != null) { onUpdateRef.current(pendingRef.current); pendingRef.current = null; }
  }

  function cancel() {
    if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    pendingRef.current = null;
  }

  return { schedule, flush, cancel };
}
