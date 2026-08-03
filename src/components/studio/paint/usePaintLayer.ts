import { useCallback, useRef } from 'react';
import {
  applyFilterBrush, applyGradient, cloneSegment, healSegment, drawShape, floodFillAt, strokeSegment, liquify,
  type PaintSettings, type PaintTool,
} from './paintEngine';
import { magicWandMask, refineMaskedRegion, combineSelections, NO_SELECTION, type Selection, type SelectionCombineMode } from './selection';
import { extractSubRegion, type PixelBuffer } from './contentAwareAlgorithms';
import { useContentAwareWorker } from './useContentAwareWorker';

export const PAINT_TOOLS: PaintTool[] = [
  'brush', 'pencil', 'eraser', 'bucket', 'gradient', 'clone', 'heal', 'blur', 'sharpen', 'smudge', 'dodge', 'burn', 'sponge', 'contentAware',
  'shape-rect', 'shape-ellipse', 'shape-line', 'spot-heal', 'liquify',
];

interface UsePaintLayerArgs {
  getCanvas: () => HTMLCanvasElement | null;
  settings: PaintSettings;
  selection: Selection;
  onSelectionChange?: (sel: Selection) => void;
  /** Called once per committed stroke/fill with the layer's pixels as they were just before it, for undo. */
  onStrokeEnd: (before: ImageData) => void;
  /** Identifies the active raster layer, for keying `liquifySnapshots`. */
  getLayerId?: () => string | null;
  /** Mutable map owned by the caller (StudioCanvas) — a layer's pristine pre-liquify pixels,
   *  captured lazily on that layer's first-ever liquify edit, for the `reconstruct` mode. */
  liquifySnapshots?: Record<string, ImageData>;
  /** Magic Wand's source when no clean-patch layer is active (e.g. Background selected) — a
   *  read-only snapshot of the composited page art, so the wand can select from the actual
   *  manga art instead of silently no-op'ing against a nonexistent raster canvas. */
  getFallbackCanvas?: () => HTMLCanvasElement | null;
  /** Fired whenever Clone/Heal's alt-clicked sample source is (re)set, so the caller can drive a
   *  live source-point cursor indicator. Mirrors cloneSourceRef's own value; not cleared between
   *  strokes, matching that ref's intentional "persists across strokes" behavior. */
  onCloneSourceSet?: (pt: { x: number; y: number }) => void;
  /** Clone/Heal's source snapshot, per the active `sampleMode` (Current Layer / Current & Below /
   *  All Layers / …) — see `sampleComposite.ts`. Falls back to `getCanvas()` (the active layer's
   *  own pixels only) when omitted, matching the tool's original single-layer behavior. */
  getSampleCanvas?: () => HTMLCanvasElement | null;
  /** Fired on every gradient-drag frame (start fixed, current live) so the caller can render a live
   *  overlay preview; fired with `(null, null)` once the drag commits/cancels. Mirrors the existing
   *  `onCloneSourceSet` "caller owns the UI, hook owns the pointer math" convention. */
  onGradientPreview?: (start: { x: number; y: number } | null, current: { x: number; y: number } | null) => void;
  /** Accessor rather than a raw boolean prop — read fresh on every pointermove instead of closing
   *  over a value that'd go stale mid-drag (same reasoning as `getLayerId`/`getFallbackCanvas`). */
  getShiftHeld?: () => boolean;
  /** Layer > Lock Transparent Pixels: when true, the stroke buffer composites onto the layer with
   *  'source-atop' instead of 'source-over', so new paint only ever lands on pixels the layer
   *  already had some opacity on — Photoshop's exact "preserve transparency" semantics. Read fresh
   *  per stroke commit (same accessor convention as the rest of this interface), not cached, since
   *  the active layer/its lock can change between strokes. */
  getPreserveTransparency?: () => boolean;
}

/** Shift-snap: preserves the drag distance but rounds the angle to the nearest 45° increment —
 *  shared by the live preview and the actual commit so what's previewed is exactly what's baked. */
function snapGradientPoint(start: { x: number; y: number }, current: { x: number; y: number }): { x: number; y: number } {
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return current;
  const angle = Math.atan2(dy, dx);
  const step = Math.PI / 4;
  const snapped = Math.round(angle / step) * step;
  return { x: start.x + Math.cos(snapped) * dist, y: start.y + Math.sin(snapped) * dist };
}

/**
 * Owns the pointer-drag lifecycle for every brush-family tool. StudioCanvas calls
 * `handlers.pointerDown/Move/Up` from the Stage's pointer events (in page-pixel
 * coordinates) only when `activeTool` is one of PAINT_TOOLS; select/pan/text keep
 * their existing, untouched code paths.
 */
export function usePaintLayer({ getCanvas, settings, selection, onSelectionChange, onStrokeEnd, getLayerId, liquifySnapshots, getFallbackCanvas, onCloneSourceSet, getSampleCanvas, onGradientPreview, getShiftHeld, getPreserveTransparency }: UsePaintLayerArgs) {
  const drawingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  // Intentionally shared between Clone Stamp and Healing Brush — Photoshop keeps one source point
  // across both tools too, so alt-clicking with one and painting with the other is expected, not a bug.
  const cloneSourceRef = useRef<{ x: number; y: number } | null>(null);
  const cloneOffsetRef = useRef<{ x: number; y: number } | null>(null);
  const gradientStartRef = useRef<{ x: number; y: number } | null>(null);
  const contentAwareStartRef = useRef<{ x: number; y: number } | null>(null);
  const shapeStartRef = useRef<{ x: number; y: number } | null>(null);
  const sourceSnapshotRef = useRef<HTMLCanvasElement | null>(null);
  const strokeBeforeRef = useRef<ImageData | null>(null);
  const contentAwareWorker = useContentAwareWorker();
  // Spot Healing Brush: a page-sized binary mask canvas accumulates the stroke's repair region
  // (filled circles stamped along the drag) so the *full* stroke shape is known at pointerUp,
  // regardless of how the live per-segment preview below already looks.
  const spotHealMaskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const spotHealBoundsRef = useRef<{ minX: number; minY: number; maxX: number; maxY: number } | null>(null);
  /** Set while a Create-Texture/Content-Aware worker pass is in flight, so Escape can revert the
   *  canvas even though the gesture that started it already finished (pointerUp already fired). */
  const pendingHeavyOpRef = useRef<{ ctx: CanvasRenderingContext2D; before: ImageData } | null>(null);

  // --- Brush/Pencil/Eraser stroke buffer -------------------------------------
  // A whole stroke accumulates into this scratch canvas at `flow` alpha, then is
  // composited onto the layer at `opacity`. Without the buffer, overlapping
  // stamps within one stroke would keep darkening past the opacity cap (which is
  // exactly what the old `opacity * flow` per-stamp alpha did).
  const strokeBufferRef = useRef<HTMLCanvasElement | null>(null);
  /** Union of every stamp bbox this stroke, so compositing only touches dirty pixels. */
  const strokeBoxRef = useRef<{ minX: number; minY: number; maxX: number; maxY: number } | null>(null);
  /** Pull-string smoothing anchor: the lagging point that actually gets painted. */
  const smoothRef = useRef<{ x: number; y: number } | null>(null);

  function getStrokeBuffer(w: number, h: number): HTMLCanvasElement {
    let buf = strokeBufferRef.current;
    if (!buf) {
      buf = document.createElement('canvas');
      strokeBufferRef.current = buf;
    }
    if (buf.width !== w || buf.height !== h) {
      buf.width = w;
      buf.height = h;
    } else {
      buf.getContext('2d')!.clearRect(0, 0, w, h);
    }
    return buf;
  }

  /** The buffer for the stroke in flight, sized to the layer. Null if pointerDown never ran. */
  function getStrokeBufferForStroke(ctx: CanvasRenderingContext2D): HTMLCanvasElement | null {
    const buf = strokeBufferRef.current;
    if (!buf) return null;
    if (buf.width !== ctx.canvas.width || buf.height !== ctx.canvas.height) return null;
    return buf;
  }

  function growBox(box: { minX: number; minY: number; maxX: number; maxY: number } | null) {
    if (!box) return;
    const cur = strokeBoxRef.current;
    strokeBoxRef.current = cur
      ? {
          minX: Math.min(cur.minX, box.minX),
          minY: Math.min(cur.minY, box.minY),
          maxX: Math.max(cur.maxX, box.maxX),
          maxY: Math.max(cur.maxY, box.maxY),
        }
      : box;
  }

  /**
   * Re-renders the dirty region of the layer as (pre-stroke pixels + stroke buffer @ opacity).
   * Called after each segment so the stroke is visible live while still obeying the opacity cap.
   */
  function compositeStroke(ctx: CanvasRenderingContext2D, tool: 'brush' | 'pencil' | 'eraser') {
    const before = strokeBeforeRef.current;
    const buf = strokeBufferRef.current;
    const box = strokeBoxRef.current;
    if (!before || !buf || !box) return;
    const x = Math.max(0, Math.floor(box.minX));
    const y = Math.max(0, Math.floor(box.minY));
    const w = Math.min(ctx.canvas.width - x, Math.ceil(box.maxX) - x + 1);
    const h = Math.min(ctx.canvas.height - y, Math.ceil(box.maxY) - y + 1);
    if (w <= 0 || h <= 0) return;

    // putImageData is a raw write (ignores alpha/composite), so this restores the
    // dirty region to its pre-stroke state before we lay the stroke back down.
    ctx.putImageData(before, 0, 0, x, y, w, h);
    ctx.save();
    ctx.globalAlpha = settings.opacity;
    // Eraser already only ever removes from pixels that exist, so Lock Transparent Pixels changes
    // nothing for it — 'source-atop' only matters for tools that add new opaque pixels.
    ctx.globalCompositeOperation = tool === 'eraser'
      ? 'destination-out'
      : getPreserveTransparency?.()
        ? 'source-atop'
        : 'source-over';
    ctx.drawImage(buf, x, y, w, h, x, y, w, h);
    ctx.restore();
  }

  // --- Content-Aware (Spot Healing Brush / Content-Aware Fill) --------------

  function getSpotHealMaskCanvas(w: number, h: number): HTMLCanvasElement {
    let canvas = spotHealMaskCanvasRef.current;
    if (!canvas) {
      canvas = document.createElement('canvas');
      spotHealMaskCanvasRef.current = canvas;
    }
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    return canvas;
  }

  function growWorkingBounds(
    current: { minX: number; minY: number; maxX: number; maxY: number } | null,
    x0: number, y0: number, x1: number, y1: number, radius: number,
  ) {
    const next = {
      minX: Math.min(x0, x1) - radius, minY: Math.min(y0, y1) - radius,
      maxX: Math.max(x0, x1) + radius, maxY: Math.max(y0, y1) + radius,
    };
    if (!current) return next;
    return {
      minX: Math.min(current.minX, next.minX), minY: Math.min(current.minY, next.minY),
      maxX: Math.max(current.maxX, next.maxX), maxY: Math.max(current.maxY, next.maxY),
    };
  }

  function computeWorkingRect(
    bounds: { minX: number; minY: number; maxX: number; maxY: number },
    canvasW: number, canvasH: number, margin: number,
  ) {
    const x0 = Math.max(0, Math.floor(bounds.minX - margin));
    const y0 = Math.max(0, Math.floor(bounds.minY - margin));
    const x1 = Math.min(canvasW, Math.ceil(bounds.maxX + margin));
    const y1 = Math.min(canvasH, Math.ceil(bounds.maxY + margin));
    return { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) };
  }

  /** A mask canvas's stroke is stamped as opaque white on transparent — the alpha channel alone
   *  carries the binary repair signal, so this collapses RGBA down to `RepairMask`'s 1-byte-per-
   *  pixel shape. */
  function rgbaAlphaToMask(rgba: { data: Uint8ClampedArray; width: number; height: number }) {
    const { width, height, data } = rgba;
    const mask = new Uint8ClampedArray(width * height);
    for (let i = 0; i < width * height; i++) mask[i] = data[i * 4 + 3];
    return { data: mask, width, height };
  }

  function stampSpotHealMask(maskCtx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, radius: number) {
    maskCtx.fillStyle = '#fff';
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const step = Math.max(1, radius * 0.5);
    for (let d = 0; d <= dist || d === 0; d += step) {
      const t = dist ? d / dist : 0;
      maskCtx.beginPath();
      maskCtx.arc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, radius, 0, Math.PI * 2);
      maskCtx.fill();
      if (dist === 0) break;
    }
  }

  /** Spot Healing Brush's per-segment live feedback: stamps the segment into the accumulated
   *  repair mask, then re-runs the cheap Proximity Match fill over the mask-so-far's bounding
   *  rect (sampled from the *original* pre-stroke pixels, never the live-edited canvas, so
   *  repeated segments don't compound sampling error) and blits it straight onto the layer. This
   *  is the "instant rough preview" shown for every mode, upgraded to the real result once the
   *  chosen mode's heavier pass (if any) resolves — see `pointerUp`. */
  function applySpotHealSegment(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
    const before = strokeBeforeRef.current;
    if (!before) return;
    const radius = Math.max(2, settings.size / 2);
    const maskCanvas = getSpotHealMaskCanvas(ctx.canvas.width, ctx.canvas.height);
    const maskCtx = maskCanvas.getContext('2d')!;
    stampSpotHealMask(maskCtx, x0, y0, x1, y1, radius);
    spotHealBoundsRef.current = growWorkingBounds(spotHealBoundsRef.current, x0, y0, x1, y1, radius);

    const bounds = spotHealBoundsRef.current;
    if (!bounds) return;
    const rect = computeWorkingRect(bounds, ctx.canvas.width, ctx.canvas.height, Math.max(4, Math.round(radius * 0.5)));
    const fullPatch: PixelBuffer = { data: before.data, width: before.width, height: before.height };
    const patch = extractSubRegion(fullPatch, rect.x, rect.y, rect.width, rect.height);
    const mask = rgbaAlphaToMask(maskCtx.getImageData(rect.x, rect.y, rect.width, rect.height));
    const preview = contentAwareWorker.runProximitySync(patch, mask);
    ctx.putImageData(new ImageData(preview.data, preview.width, preview.height), rect.x, rect.y);
  }

  /** Kicks off the Create-Texture/Content-Aware worker pass and commits history once it resolves.
   *  Shared by Spot Healing Brush (stroke-based) and Content-Aware Fill (one-shot rect) — both
   *  already have a `before` snapshot, a working rect, and a local patch+mask by the time they
   *  call this. Guards against a superseded/cancelled request (`pendingHeavyOpRef` pointing at a
   *  *different* `before` by the time the promise settles) touching the canvas after the fact. */
  function runHeavyContentAware(
    ctx: CanvasRenderingContext2D,
    mode: 'texture' | 'contentAware',
    before: ImageData,
    rect: { x: number; y: number; width: number; height: number },
    patch: PixelBuffer,
    mask: { data: Uint8ClampedArray; width: number; height: number },
  ) {
    pendingHeavyOpRef.current = { ctx, before };
    contentAwareWorker.runHeavy(mode, patch, mask, settings.size)
      .then((result) => {
        if (pendingHeavyOpRef.current?.before !== before) return;
        ctx.putImageData(new ImageData(result.data, result.width, result.height), rect.x, rect.y);
        if (selection.kind === 'mask') refineMaskedRegion(ctx, selection, before);
        onStrokeEnd(before);
        pendingHeavyOpRef.current = null;
        strokeBeforeRef.current = null;
      })
      .catch(() => { /* cancelled — cancelContentAware() already reverted the canvas */ });
  }

  /** Escape: reverts to the last known-good state and drops any in-flight worker computation.
   *  Exposed for StudioCanvas's global Escape handling. */
  const cancelContentAware = useCallback(() => {
    contentAwareWorker.cancel();
    const pending = pendingHeavyOpRef.current;
    if (pending) {
      pending.ctx.putImageData(pending.before, 0, 0);
      pendingHeavyOpRef.current = null;
    } else if (drawingRef.current && strokeBeforeRef.current) {
      const canvas = getCanvas();
      const ctx = canvas?.getContext('2d');
      ctx?.putImageData(strokeBeforeRef.current, 0, 0);
    }
    drawingRef.current = false;
    lastRef.current = null;
    contentAwareStartRef.current = null;
    strokeBeforeRef.current = null;
    spotHealBoundsRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getCanvas]);

  const pointerDown = useCallback((tool: PaintTool, x: number, y: number, altKey: boolean, pressure = 1) => {
    const canvas = getCanvas();
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if ((tool === 'clone' || tool === 'heal') && altKey) {
      cloneSourceRef.current = { x, y };
      onCloneSourceSet?.({ x, y });
      return;
    }
    if (tool === 'gradient') {
      gradientStartRef.current = { x, y };
      onGradientPreview?.({ x, y }, { x, y });
      return;
    }
    if (tool === 'contentAware') {
      contentAwareStartRef.current = { x, y };
      return;
    }
    if (tool === 'shape-rect' || tool === 'shape-ellipse' || tool === 'shape-line') {
      shapeStartRef.current = { x, y };
      return;
    }
    if (tool === 'bucket') {
      const before = ctx.getImageData(0, 0, canvas.width, canvas.height);
      floodFillAt(ctx, canvas.width, canvas.height, x, y, settings, selection);
      if (selection.kind === 'mask') refineMaskedRegion(ctx, selection, before);
      onStrokeEnd(before);
      return;
    }
    if ((tool === 'clone' || tool === 'heal') && cloneSourceRef.current) {
      cloneOffsetRef.current = { x: x - cloneSourceRef.current.x, y: y - cloneSourceRef.current.y };
      const sampleSource = getSampleCanvas?.() ?? canvas;
      const snap = document.createElement('canvas');
      snap.width = sampleSource.width;
      snap.height = sampleSource.height;
      snap.getContext('2d')!.drawImage(sampleSource, 0, 0);
      sourceSnapshotRef.current = snap;
    }

    if (tool === 'liquify' && liquifySnapshots) {
      const layerId = getLayerId?.();
      if (layerId && !liquifySnapshots[layerId]) {
        liquifySnapshots[layerId] = ctx.getImageData(0, 0, canvas.width, canvas.height);
      }
    }

    strokeBeforeRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
    drawingRef.current = true;
    lastRef.current = { x, y };
    if (tool === 'brush' || tool === 'pencil' || tool === 'eraser') {
      getStrokeBuffer(canvas.width, canvas.height);
      strokeBoxRef.current = null;
      smoothRef.current = { x, y };
    }
    if (tool === 'spot-heal') {
      const maskCanvas = getSpotHealMaskCanvas(canvas.width, canvas.height);
      maskCanvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height);
      spotHealBoundsRef.current = null;
    }
    applyStrokeSegment(ctx, tool, x, y, x, y, pressure);
  }, [getCanvas, settings, selection, onStrokeEnd, getLayerId, liquifySnapshots, onCloneSourceSet, getSampleCanvas, onGradientPreview]);

  function applyStrokeSegment(ctx: CanvasRenderingContext2D, tool: PaintTool, lastX: number, lastY: number, x: number, y: number, pressure = 1) {
    if (tool === 'brush' || tool === 'pencil' || tool === 'eraser') {
      // Stamps go into the stroke buffer at `flow`, never straight onto the layer;
      // compositeStroke then lays the buffer down at `opacity`. See the buffer
      // block above for why the two sliders need to stay separate.
      const buf = getStrokeBufferForStroke(ctx);
      if (!buf) return;
      const bufCtx = buf.getContext('2d')!;
      const w = ctx.canvas.width, h = ctx.canvas.height;

      growBox(strokeSegment(bufCtx, lastX, lastY, x, y, settings, tool, selection, pressure));
      // Symmetry mode: mirror the same segment across the canvas center. Real per-stamp
      // mirroring (not just a post-hoc flip), so it works mid-stroke exactly like Photoshop's.
      if (settings.symmetry === 'horizontal' || settings.symmetry === 'both') {
        growBox(strokeSegment(bufCtx, w - lastX, lastY, w - x, y, settings, tool, selection, pressure));
      }
      if (settings.symmetry === 'vertical' || settings.symmetry === 'both') {
        growBox(strokeSegment(bufCtx, lastX, h - lastY, x, h - y, settings, tool, selection, pressure));
      }
      if (settings.symmetry === 'both') {
        growBox(strokeSegment(bufCtx, w - lastX, h - lastY, w - x, h - y, settings, tool, selection, pressure));
      }
      compositeStroke(ctx, tool);
    } else if ((tool === 'clone' || tool === 'heal') && cloneOffsetRef.current && sourceSnapshotRef.current) {
      if (tool === 'clone') {
        cloneSegment(ctx, sourceSnapshotRef.current, lastX, lastY, x, y, settings.size, cloneOffsetRef.current.x, cloneOffsetRef.current.y, selection);
      } else {
        healSegment(ctx, sourceSnapshotRef.current, lastX, lastY, x, y, settings.size, cloneOffsetRef.current.x, cloneOffsetRef.current.y, selection);
      }
    } else if (tool === 'blur' || tool === 'sharpen' || tool === 'smudge' || tool === 'dodge' || tool === 'burn' || tool === 'sponge') {
      applyFilterBrush(ctx, x, y, settings.size, settings.flow, tool, x - lastX, y - lastY, selection);
    } else if (tool === 'liquify') {
      const pristine = liquifySnapshots && getLayerId ? liquifySnapshots[getLayerId() ?? ''] : null;
      liquify(ctx, x, y, settings.size, settings.flow, settings.liquifyMode, x - lastX, y - lastY, selection, pristine);
    } else if (tool === 'spot-heal') {
      applySpotHealSegment(ctx, lastX, lastY, x, y);
    }
  }

  const pointerMove = useCallback((tool: PaintTool, x: number, y: number, pressure = 1) => {
    const canvas = getCanvas();
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (tool === 'gradient' && gradientStartRef.current) {
      const current = getShiftHeld?.() ? snapGradientPoint(gradientStartRef.current, { x, y }) : { x, y };
      onGradientPreview?.(gradientStartRef.current, current);
      return; // committed on pointerUp
    }
    if (tool === 'contentAware' && contentAwareStartRef.current) return; // committed on pointerUp
    if ((tool === 'shape-rect' || tool === 'shape-ellipse' || tool === 'shape-line') && shapeStartRef.current) return; // committed on pointerUp

    if (!drawingRef.current || !lastRef.current) return;
    const last = lastRef.current;

    // Live crosshair sync: the source read point tracks the brush at the fixed offset established
    // by the stroke's first sample (Photoshop's "aligned" clone, the only mode this implements) —
    // without this the UI crosshair stayed frozen at the alt-click point for the whole stroke even
    // though the actual pixel sampling (cloneSegment/healSegment, below) already tracked correctly.
    if ((tool === 'clone' || tool === 'heal') && cloneOffsetRef.current) {
      onCloneSourceSet?.({ x: x - cloneOffsetRef.current.x, y: y - cloneOffsetRef.current.y });
    }

    // Pull-string smoothing: the painted point chases the raw pointer instead of
    // tracking it exactly, which damps hand jitter. smoothing=0 paints the raw
    // pointer (identical to the old behaviour); higher values lag further behind.
    let tx = x, ty = y;
    const isStrokeTool = tool === 'brush' || tool === 'pencil' || tool === 'eraser';
    if (isStrokeTool && settings.smoothing > 0 && smoothRef.current) {
      const follow = 1 - Math.min(0.95, settings.smoothing * 0.9);
      tx = smoothRef.current.x + (x - smoothRef.current.x) * follow;
      ty = smoothRef.current.y + (y - smoothRef.current.y) * follow;
      smoothRef.current = { x: tx, y: ty };
    } else if (isStrokeTool) {
      smoothRef.current = { x, y };
    }

    applyStrokeSegment(ctx, tool, last.x, last.y, tx, ty, pressure);
    lastRef.current = { x: tx, y: ty };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getCanvas, settings, selection, onCloneSourceSet, onGradientPreview, getShiftHeld]);

  const pointerUp = useCallback((tool: PaintTool, x: number, y: number) => {
    const canvas = getCanvas();
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    if (tool === 'gradient' && gradientStartRef.current && ctx) {
      const start = gradientStartRef.current;
      // Same snap the live preview used, so the committed gradient always matches what was shown.
      const end = getShiftHeld?.() ? snapGradientPoint(start, { x, y }) : { x, y };
      const before = ctx.getImageData(0, 0, canvas.width, canvas.height);
      // Foreground-to-background, matching Photoshop's default Gradient tool convention.
      applyGradient(ctx, canvas.width, canvas.height, start.x, start.y, end.x, end.y, settings.color, settings.bgColor, selection);
      if (selection.kind === 'mask') refineMaskedRegion(ctx, selection, before);
      gradientStartRef.current = null;
      onGradientPreview?.(null, null);
      onStrokeEnd(before);
      return;
    }
    if (tool === 'contentAware' && contentAwareStartRef.current && ctx) {
      const start = contentAwareStartRef.current;
      const rect = { x: Math.min(start.x, x), y: Math.min(start.y, y), width: Math.abs(x - start.x), height: Math.abs(y - start.y) };
      contentAwareStartRef.current = null;
      if (rect.width > 4 && rect.height > 4) {
        const before = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const margin = Math.max(8, Math.min(100, settings.size * 2));
        const workRect = computeWorkingRect(
          { minX: rect.x, minY: rect.y, maxX: rect.x + rect.width, maxY: rect.y + rect.height },
          canvas.width, canvas.height, margin,
        );
        const fullPatch: PixelBuffer = { data: before.data, width: before.width, height: before.height };
        const patch = extractSubRegion(fullPatch, workRect.x, workRect.y, workRect.width, workRect.height);
        const maskData = new Uint8ClampedArray(workRect.width * workRect.height);
        const rx0 = Math.max(0, Math.round(rect.x - workRect.x)), ry0 = Math.max(0, Math.round(rect.y - workRect.y));
        const rx1 = Math.min(workRect.width, Math.round(rx0 + rect.width)), ry1 = Math.min(workRect.height, Math.round(ry0 + rect.height));
        for (let yy = ry0; yy < ry1; yy++) {
          for (let xx = rx0; xx < rx1; xx++) maskData[yy * workRect.width + xx] = 255;
        }
        const mask = { data: maskData, width: workRect.width, height: workRect.height };

        // Instant rough preview regardless of the chosen mode, upgraded below if it's not Proximity.
        const preview = contentAwareWorker.runProximitySync(patch, mask);
        ctx.putImageData(new ImageData(preview.data, preview.width, preview.height), workRect.x, workRect.y);

        if (settings.contentAwareMode === 'proximity') {
          if (selection.kind === 'mask') refineMaskedRegion(ctx, selection, before);
          onStrokeEnd(before);
        } else {
          runHeavyContentAware(ctx, settings.contentAwareMode, before, workRect, patch, mask);
        }
      }
      return;
    }
    if ((tool === 'shape-rect' || tool === 'shape-ellipse' || tool === 'shape-line') && shapeStartRef.current && ctx) {
      const start = shapeStartRef.current;
      shapeStartRef.current = null;
      const before = ctx.getImageData(0, 0, canvas.width, canvas.height);
      drawShape(ctx, tool, start.x, start.y, x, y, { fillColor: tool === 'shape-line' ? null : settings.color, strokeColor: settings.color, strokeWidth: Math.max(2, settings.size / 6) }, selection);
      if (selection.kind === 'mask') refineMaskedRegion(ctx, selection, before);
      onStrokeEnd(before);
      return;
    }

    if (drawingRef.current) {
      drawingRef.current = false;
      lastRef.current = null;
      const before = strokeBeforeRef.current;
      const mode = settings.contentAwareMode;
      const heavySpotHeal = tool === 'spot-heal' && mode !== 'proximity';
      if (heavySpotHeal && before && ctx && spotHealBoundsRef.current) {
        // `heavySpotHeal` already proved `mode !== 'proximity'`, but that narrowing doesn't survive
        // being read back through the intermediate boolean — safe to assert the remaining union.
        const heavyMode = mode as 'texture' | 'contentAware';
        // Re-run against the *original* pixels (not the live proximity preview already on
        // screen) over the full accumulated stroke mask, then commit history once it resolves —
        // the live preview stays visible as the "instant rough preview" in the meantime.
        const margin = Math.max(8, Math.min(100, settings.size * 2));
        const rect = computeWorkingRect(spotHealBoundsRef.current, ctx.canvas.width, ctx.canvas.height, margin);
        const fullPatch: PixelBuffer = { data: before.data, width: before.width, height: before.height };
        const patch = extractSubRegion(fullPatch, rect.x, rect.y, rect.width, rect.height);
        const maskCanvas = spotHealMaskCanvasRef.current;
        const mask = maskCanvas
          ? rgbaAlphaToMask(maskCanvas.getContext('2d')!.getImageData(rect.x, rect.y, rect.width, rect.height))
          : { data: new Uint8ClampedArray(rect.width * rect.height), width: rect.width, height: rect.height };
        runHeavyContentAware(ctx, heavyMode, before, rect, patch, mask);
        // strokeBeforeRef stays set until the worker resolves (or Escape cancels), so a mid-flight
        // Escape still has the right snapshot to revert to.
      } else {
        if (before) {
          if (selection.kind === 'mask' && ctx) refineMaskedRegion(ctx, selection, before);
          onStrokeEnd(before);
        }
        strokeBeforeRef.current = null;
      }
    }
  }, [getCanvas, settings, selection, onStrokeEnd, onGradientPreview, getShiftHeld]);

  /** Returns the final selection it committed (not just void) — Magic Wand fires on a single
   *  click with no separate drag-end moment, so a caller that needs "the shape this gesture just
   *  produced" (Type Region's auto-bubble) can't wait for a re-render and read the `selection`
   *  prop back, since that would still be the pre-click value in the same synchronous tick. */
  const pickMagicWand = useCallback((x: number, y: number, combineMode: SelectionCombineMode = 'replace'): Selection | null => {
    const canvas = getCanvas() ?? getFallbackCanvas?.() ?? null;
    if (!canvas || !onSelectionChange) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const mask = magicWandMask(ctx, canvas.width, canvas.height, x, y, settings.tolerance);
    const picked = mask.kind === 'mask' ? mask : NO_SELECTION;
    const final = combineMode === 'replace' ? picked : combineSelections(selection, picked, combineMode, canvas.width, canvas.height);
    onSelectionChange(final);
    return final;
  }, [getCanvas, getFallbackCanvas, settings.tolerance, selection, onSelectionChange]);

  const setCloneSource = useCallback((x: number, y: number) => {
    cloneSourceRef.current = { x, y };
  }, []);

  return { pointerDown, pointerMove, pointerUp, pickMagicWand, setCloneSource, cancelContentAware };
}
