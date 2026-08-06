import { useCallback, useRef, useState } from 'react';
import type { StudioLayer } from '../components/studio/studioTypes';

const MAX_HISTORY = 50; // matches Studio's own HistoryContext MAX_ENTRIES
/** Repeated pushes for the same image within this window collapse into the first one — this is
 *  what lets every call site call `pushHistory` unconditionally (including once per pointermove of
 *  a paint stroke, or once per keystroke while typing) without threading explicit gesture-start/end
 *  signals through DesignCanvas: a stroke or a burst of typing is many calls milliseconds apart, so
 *  only the first actually lands; a genuinely separate later action is comfortably spaced further
 *  out and gets its own entry. */
const COALESCE_WINDOW_MS = 500;

interface ImageHistory {
  past: StudioLayer[][];
  future: StudioLayer[][];
  lastPushAt: number;
}

export interface UseDesignHistory {
  /** Snapshots `layers` (the state *before* an about-to-happen change) onto the undo stack for
   *  `imageId`, and clears its redo stack. Safe to call unconditionally on every layer-mutating
   *  action, continuous or discrete — see COALESCE_WINDOW_MS. */
  pushHistory: (imageId: string, layers: StudioLayer[]) => void;
  /** Pops the most recent undo entry, pushing `currentLayers` onto the redo stack, and returns the
   *  layers to restore — or null if there's nothing to undo. */
  undo: (imageId: string, currentLayers: StudioLayer[]) => StudioLayer[] | null;
  redo: (imageId: string, currentLayers: StudioLayer[]) => StudioLayer[] | null;
  canUndo: (imageId: string | null) => boolean;
  canRedo: (imageId: string | null) => boolean;
}

/**
 * Design Mode's own undo/redo — independent of Studio's `HistoryContext` (which uses inverse-
 * operation closures, not snapshots) by design: a completely separate document space gets a
 * completely separate history. Per-image, so switching tabs doesn't cross-contaminate undo stacks.
 */
export function useDesignHistory(): UseDesignHistory {
  const historyRef = useRef<Map<string, ImageHistory>>(new Map());
  const [, bump] = useState(0);
  const forceUpdate = useCallback(() => bump(n => n + 1), []);

  const getOrCreate = (imageId: string): ImageHistory => {
    let h = historyRef.current.get(imageId);
    if (!h) { h = { past: [], future: [], lastPushAt: 0 }; historyRef.current.set(imageId, h); }
    return h;
  };

  const pushHistory = useCallback((imageId: string, layers: StudioLayer[]) => {
    const h = getOrCreate(imageId);
    const now = Date.now();
    if (now - h.lastPushAt < COALESCE_WINDOW_MS) return;
    h.lastPushAt = now;
    h.past.push(layers);
    if (h.past.length > MAX_HISTORY) h.past.shift();
    h.future = [];
    forceUpdate();
  }, [forceUpdate]);

  const undo = useCallback((imageId: string, currentLayers: StudioLayer[]): StudioLayer[] | null => {
    const h = getOrCreate(imageId);
    if (h.past.length === 0) return null;
    const previous = h.past.pop()!;
    h.future.push(currentLayers);
    forceUpdate();
    return previous;
  }, [forceUpdate]);

  const redo = useCallback((imageId: string, currentLayers: StudioLayer[]): StudioLayer[] | null => {
    const h = getOrCreate(imageId);
    if (h.future.length === 0) return null;
    const next = h.future.pop()!;
    h.past.push(currentLayers);
    forceUpdate();
    return next;
  }, [forceUpdate]);

  const canUndo = useCallback((imageId: string | null) => !!imageId && (historyRef.current.get(imageId)?.past.length ?? 0) > 0, []);
  const canRedo = useCallback((imageId: string | null) => !!imageId && (historyRef.current.get(imageId)?.future.length ?? 0) > 0, []);

  return { pushHistory, undo, redo, canUndo, canRedo };
}
