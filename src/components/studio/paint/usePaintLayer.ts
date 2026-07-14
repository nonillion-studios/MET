import { useCallback, useRef } from 'react';
import {
  applyFilterBrush, applyGradient, cloneSegment, contentAwareFill, drawShape, floodFillAt, strokeSegment,
  type PaintSettings, type PaintTool,
} from './paintEngine';
import { magicWandMask, NO_SELECTION, type Selection } from './selection';

export const PAINT_TOOLS: PaintTool[] = [
  'brush', 'pencil', 'eraser', 'bucket', 'gradient', 'clone', 'blur', 'sharpen', 'smudge', 'dodge', 'burn', 'sponge', 'contentAware',
  'shape-rect', 'shape-ellipse', 'shape-line', 'spot-heal',
];

interface UsePaintLayerArgs {
  getCanvas: () => HTMLCanvasElement | null;
  settings: PaintSettings;
  selection: Selection;
  onSelectionChange?: (sel: Selection) => void;
  /** Called once per committed stroke/fill with the layer's pixels as they were just before it, for undo. */
  onStrokeEnd: (before: ImageData) => void;
}

/**
 * Owns the pointer-drag lifecycle for every brush-family tool. StudioCanvas calls
 * `handlers.pointerDown/Move/Up` from the Stage's pointer events (in page-pixel
 * coordinates) only when `activeTool` is one of PAINT_TOOLS; select/pan/text keep
 * their existing, untouched code paths.
 */
export function usePaintLayer({ getCanvas, settings, selection, onSelectionChange, onStrokeEnd }: UsePaintLayerArgs) {
  const drawingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  const cloneSourceRef = useRef<{ x: number; y: number } | null>(null);
  const cloneOffsetRef = useRef<{ x: number; y: number } | null>(null);
  const gradientStartRef = useRef<{ x: number; y: number } | null>(null);
  const contentAwareStartRef = useRef<{ x: number; y: number } | null>(null);
  const shapeStartRef = useRef<{ x: number; y: number } | null>(null);
  const sourceSnapshotRef = useRef<HTMLCanvasElement | null>(null);
  const strokeBeforeRef = useRef<ImageData | null>(null);

  const pointerDown = useCallback((tool: PaintTool, x: number, y: number, altKey: boolean, pressure = 1) => {
    const canvas = getCanvas();
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (tool === 'clone' && altKey) {
      cloneSourceRef.current = { x, y };
      return;
    }
    if (tool === 'gradient') {
      gradientStartRef.current = { x, y };
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
      onStrokeEnd(before);
      return;
    }
    if (tool === 'clone' && cloneSourceRef.current) {
      cloneOffsetRef.current = { x: x - cloneSourceRef.current.x, y: y - cloneSourceRef.current.y };
      const snap = document.createElement('canvas');
      snap.width = canvas.width;
      snap.height = canvas.height;
      snap.getContext('2d')!.drawImage(canvas, 0, 0);
      sourceSnapshotRef.current = snap;
    }

    strokeBeforeRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
    drawingRef.current = true;
    lastRef.current = { x, y };
    applyStrokeSegment(ctx, tool, x, y, x, y, pressure);
  }, [getCanvas, settings, selection, onStrokeEnd]);

  function applyStrokeSegment(ctx: CanvasRenderingContext2D, tool: PaintTool, lastX: number, lastY: number, x: number, y: number, pressure = 1) {
    if (tool === 'brush' || tool === 'pencil' || tool === 'eraser') {
      // Stylus pressure (0-1, from PointerEvent.pressure) scales the effective brush size for this segment.
      const effectiveSettings = pressure !== 1 ? { ...settings, size: Math.max(1, settings.size * pressure) } : settings;
      strokeSegment(ctx, lastX, lastY, x, y, effectiveSettings, tool, selection);
    } else if (tool === 'clone' && cloneOffsetRef.current && sourceSnapshotRef.current) {
      cloneSegment(ctx, sourceSnapshotRef.current, lastX, lastY, x, y, settings.size, cloneOffsetRef.current.x, cloneOffsetRef.current.y, selection);
    } else if (tool === 'blur' || tool === 'sharpen' || tool === 'smudge' || tool === 'dodge' || tool === 'burn' || tool === 'sponge') {
      applyFilterBrush(ctx, x, y, settings.size, settings.flow, tool, x - lastX, y - lastY, selection);
    } else if (tool === 'spot-heal') {
      const r = Math.max(4, settings.size / 2);
      contentAwareFill(ctx, { x: x - r, y: y - r, width: r * 2, height: r * 2 });
    }
  }

  const pointerMove = useCallback((tool: PaintTool, x: number, y: number, pressure = 1) => {
    const canvas = getCanvas();
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (tool === 'gradient' && gradientStartRef.current) return; // committed on pointerUp
    if (tool === 'contentAware' && contentAwareStartRef.current) return; // committed on pointerUp
    if ((tool === 'shape-rect' || tool === 'shape-ellipse' || tool === 'shape-line') && shapeStartRef.current) return; // committed on pointerUp

    if (!drawingRef.current || !lastRef.current) return;
    const last = lastRef.current;
    applyStrokeSegment(ctx, tool, last.x, last.y, x, y, pressure);
    lastRef.current = { x, y };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getCanvas, settings, selection]);

  const pointerUp = useCallback((tool: PaintTool, x: number, y: number) => {
    const canvas = getCanvas();
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    if (tool === 'gradient' && gradientStartRef.current && ctx) {
      const before = ctx.getImageData(0, 0, canvas.width, canvas.height);
      applyGradient(ctx, canvas.width, canvas.height, gradientStartRef.current.x, gradientStartRef.current.y, x, y, settings.color, '#ffffff00', selection);
      gradientStartRef.current = null;
      onStrokeEnd(before);
      return;
    }
    if (tool === 'contentAware' && contentAwareStartRef.current && ctx) {
      const start = contentAwareStartRef.current;
      const rect = { x: Math.min(start.x, x), y: Math.min(start.y, y), width: Math.abs(x - start.x), height: Math.abs(y - start.y) };
      contentAwareStartRef.current = null;
      if (rect.width > 4 && rect.height > 4) {
        const before = ctx.getImageData(0, 0, canvas.width, canvas.height);
        contentAwareFill(ctx, rect);
        onStrokeEnd(before);
      }
      return;
    }
    if ((tool === 'shape-rect' || tool === 'shape-ellipse' || tool === 'shape-line') && shapeStartRef.current && ctx) {
      const start = shapeStartRef.current;
      shapeStartRef.current = null;
      const before = ctx.getImageData(0, 0, canvas.width, canvas.height);
      drawShape(ctx, tool, start.x, start.y, x, y, { fillColor: tool === 'shape-line' ? null : settings.color, strokeColor: settings.color, strokeWidth: Math.max(2, settings.size / 6) }, selection);
      onStrokeEnd(before);
      return;
    }

    if (drawingRef.current) {
      drawingRef.current = false;
      lastRef.current = null;
      if (strokeBeforeRef.current) onStrokeEnd(strokeBeforeRef.current);
      strokeBeforeRef.current = null;
    }
  }, [getCanvas, settings, selection, onStrokeEnd]);

  const pickMagicWand = useCallback((x: number, y: number) => {
    const canvas = getCanvas();
    if (!canvas || !onSelectionChange) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const mask = magicWandMask(ctx, canvas.width, canvas.height, x, y, settings.tolerance);
    onSelectionChange(mask.kind === 'mask' ? mask : NO_SELECTION);
  }, [getCanvas, settings.tolerance, onSelectionChange]);

  const setCloneSource = useCallback((x: number, y: number) => {
    cloneSourceRef.current = { x, y };
  }, []);

  return { pointerDown, pointerMove, pointerUp, pickMagicWand, setCloneSource };
}
