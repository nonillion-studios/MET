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

/** dataURL per layer id, for whatever's currently in DesignCanvas's paint-canvas registry. Layer
 *  *array* membership/order/properties live in `StudioLayer[]` and undo fine on their own, but
 *  paint/placed-image *pixels* live out-of-band (same as Studio's own registry) — a brush stroke
 *  never touches the layers array at all, so without also snapshotting canvas pixels here, undoing
 *  "the array as it looked before" would leave the stroke's pixels untouched on whatever layer they
 *  landed on. */
export type CanvasSnapshots = Record<string, string>;

interface HistoryEntry {
  layers: StudioLayer[];
  canvases: CanvasSnapshots;
}

interface ImageHistory {
  past: HistoryEntry[];
  future: HistoryEntry[];
  lastPushAt: number;
}

export interface UseDesignHistory {
  /** Snapshots `layers` + `canvases` (the state *before* an about-to-happen change) onto the undo
   *  stack for `imageId`, and clears its redo stack. Safe to call unconditionally on every
   *  layer/pixel-mutating action, continuous or discrete — see COALESCE_WINDOW_MS. */
  pushHistory: (imageId: string, layers: StudioLayer[], canvases: CanvasSnapshots) => void;
  /** Pops the most recent undo entry, pushing the current state onto the redo stack, and returns
   *  the state to restore — or null if there's nothing to undo. */
  undo: (imageId: string, currentLayers: StudioLayer[], currentCanvases: CanvasSnapshots) => HistoryEntry | null;
  redo: (imageId: string, currentLayers: StudioLayer[], currentCanvases: CanvasSnapshots) => HistoryEntry | null;
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

  const pushHistory = useCallback((imageId: string, layers: StudioLayer[], canvases: CanvasSnapshots) => {
    const h = getOrCreate(imageId);
    const now = Date.now();
    if (now - h.lastPushAt < COALESCE_WINDOW_MS) return;
    h.lastPushAt = now;
    h.past.push({ layers, canvases });
    if (h.past.length > MAX_HISTORY) h.past.shift();
    h.future = [];
    forceUpdate();
  }, [forceUpdate]);

  const undo = useCallback((imageId: string, currentLayers: StudioLayer[], currentCanvases: CanvasSnapshots): HistoryEntry | null => {
    const h = getOrCreate(imageId);
    if (h.past.length === 0) return null;
    const previous = h.past.pop()!;
    h.future.push({ layers: currentLayers, canvases: currentCanvases });
    forceUpdate();
    return previous;
  }, [forceUpdate]);

  const redo = useCallback((imageId: string, currentLayers: StudioLayer[], currentCanvases: CanvasSnapshots): HistoryEntry | null => {
    const h = getOrCreate(imageId);
    if (h.future.length === 0) return null;
    const next = h.future.pop()!;
    h.past.push({ layers: currentLayers, canvases: currentCanvases });
    forceUpdate();
    return next;
  }, [forceUpdate]);

  const canUndo = useCallback((imageId: string | null) => !!imageId && (historyRef.current.get(imageId)?.past.length ?? 0) > 0, []);
  const canRedo = useCallback((imageId: string | null) => !!imageId && (historyRef.current.get(imageId)?.future.length ?? 0) > 0, []);

  return { pushHistory, undo, redo, canUndo, canRedo };
}
