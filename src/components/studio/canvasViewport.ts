import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type Konva from 'konva';
import { screenToImage } from './canvasCoords';

export interface CanvasViewportOptions {
  minScale: number;
  maxScale: number;
  initialScale?: number;
  initialPos?: { x: number; y: number };
}

export interface FitOptions {
  padding?: number;
  /** Caps the fitted scale independent of the viewport's own maxScale — Studio never auto-fits
   *  past 150%, Design Mode has no such cap. */
  maxScale?: number;
}

export interface CanvasViewport {
  scale: number;
  pos: { x: number; y: number };
  setScale: Dispatch<SetStateAction<number>>;
  setPos: Dispatch<SetStateAction<{ x: number; y: number }>>;
  clampScale: (value: number) => number;
  spaceDown: boolean;
  /** Ref-backed, not state — reading it never triggers a re-render, matching the original
   *  StudioCanvas panRef's deliberate non-reactivity (avoids re-rendering ~3000 lines of JSX on
   *  every panning mousemove). */
  isPanning: () => boolean;
  startPan: (clientX: number, clientY: number) => void;
  /** Shared anchor-preserving-zoom primitive: `screenPoint` stays under the same image-space pixel
   *  before and after the zoom. Used by handleWheel internally; also available to callers with their
   *  own zoom gestures (Zoom-tool click, pinch) that want the same math without re-deriving it. */
  zoomAtScreenPoint: (newScale: number, screenPoint: { x: number; y: number }) => void;
  handleWheel: (e: Konva.KonvaEventObject<WheelEvent>) => void;
  zoomIn: (containerSize: { width: number; height: number }) => void;
  zoomOut: (containerSize: { width: number; height: number }) => void;
  zoomTo: (nextScale: number, containerSize: { width: number; height: number }) => void;
  zoomTo100: (containerSize: { width: number; height: number }) => void;
  centerOn: (imageX: number, imageY: number, containerSize: { width: number; height: number }) => void;
  fit: (contentWidth: number, contentHeight: number, containerSize: { width: number; height: number }, opts?: FitOptions) => void;
}

function isTextInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable;
}

/**
 * Shared pan/zoom/render-loop state for a Konva Stage — the same `pos`/`scale` model
 * `StudioCanvas.tsx` and `DesignCanvas.tsx` previously kept as separate, drifting
 * implementations of (see `canvasCoords.ts`'s own doc comment, which already described this
 * shared shape). Owns scale/pos state, wheel-zoom-to-pointer, space-hold pan tracking (window-level,
 * so a drag survives the pointer leaving the canvas), and the imperative zoom/fit helpers both
 * canvases expose to their toolbars.
 *
 * Each caller still owns *when* to start a pan (space+click vs. middle-mouse vs. a dedicated Pan
 * tool) and its own container-size `ResizeObserver` — those are entangled with each canvas's own
 * gesture routing and measurement quirks, not safe to generalize here.
 */
export function useCanvasViewport(opts: CanvasViewportOptions): CanvasViewport {
  const { minScale, maxScale, initialScale = 1, initialPos = { x: 0, y: 0 } } = opts;
  const [scale, setScale] = useState(initialScale);
  const [pos, setPos] = useState(initialPos);
  const [spaceDown, setSpaceDown] = useState(false);
  const panRef = useRef<{ active: boolean; lastX: number; lastY: number } | null>(null);

  const clampScale = useCallback((value: number) => Math.min(maxScale, Math.max(minScale, value)), [minScale, maxScale]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code === 'Space' && !isTextInputFocused()) { e.preventDefault(); setSpaceDown(true); }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code === 'Space') setSpaceDown(false);
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // Window-level mousemove/mouseup so a pan drag keeps tracking even if the pointer leaves the
  // canvas bounds.
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      const p = panRef.current;
      if (!p?.active) return;
      const dx = e.clientX - p.lastX;
      const dy = e.clientY - p.lastY;
      panRef.current = { active: true, lastX: e.clientX, lastY: e.clientY };
      setPos(prev => ({ x: prev.x + dx, y: prev.y + dy }));
    }
    function onMouseUp() {
      if (panRef.current?.active) panRef.current = null;
    }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const isPanning = useCallback(() => !!panRef.current?.active, []);
  const startPan = useCallback((clientX: number, clientY: number) => {
    panRef.current = { active: true, lastX: clientX, lastY: clientY };
  }, []);

  const zoomAtScreenPoint = useCallback((newScale: number, screenPoint: { x: number; y: number }) => {
    const clamped = clampScale(newScale);
    const pointTo = screenToImage(screenPoint.x, screenPoint.y, { scale, pos });
    setScale(clamped);
    setPos({ x: screenPoint.x - pointTo.x * clamped, y: screenPoint.y - pointTo.y * clamped });
  }, [clampScale, scale, pos]);

  const handleWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = e.target.getStage();
    const pointer = stage?.getPointerPosition();
    if (!stage || !pointer) return;
    const direction = e.evt.deltaY > 0 ? -1 : 1;
    const zoomFactor = 1.08;
    const newScale = direction > 0 ? scale * zoomFactor : scale / zoomFactor;
    zoomAtScreenPoint(newScale, pointer);
  }, [scale, zoomAtScreenPoint]);

  const zoomTo = useCallback((nextScale: number, containerSize: { width: number; height: number }) => {
    const clamped = clampScale(nextScale);
    const cx = containerSize.width / 2, cy = containerSize.height / 2;
    const pointTo = screenToImage(cx, cy, { scale, pos });
    setScale(clamped);
    setPos({ x: cx - pointTo.x * clamped, y: cy - pointTo.y * clamped });
  }, [clampScale, scale, pos]);

  const zoomIn = useCallback((containerSize: { width: number; height: number }) => {
    zoomTo(scale * 1.25, containerSize);
  }, [zoomTo, scale]);

  const zoomOut = useCallback((containerSize: { width: number; height: number }) => {
    zoomTo(scale / 1.25, containerSize);
  }, [zoomTo, scale]);

  const zoomTo100 = useCallback((containerSize: { width: number; height: number }) => {
    zoomTo(1, containerSize);
  }, [zoomTo]);

  const centerOn = useCallback((imageX: number, imageY: number, containerSize: { width: number; height: number }) => {
    setPos({ x: containerSize.width / 2 - imageX * scale, y: containerSize.height / 2 - imageY * scale });
  }, [scale]);

  const fit = useCallback((
    contentWidth: number, contentHeight: number, containerSize: { width: number; height: number }, fitOpts?: FitOptions,
  ) => {
    if (contentWidth <= 0 || contentHeight <= 0 || containerSize.width === 0 || containerSize.height === 0) return;
    const padding = fitOpts?.padding ?? 0;
    const scaleX = (containerSize.width - padding * 2) / contentWidth;
    const scaleY = (containerSize.height - padding * 2) / contentHeight;
    const capped = fitOpts?.maxScale !== undefined ? Math.min(scaleX, scaleY, fitOpts.maxScale) : Math.min(scaleX, scaleY);
    const next = clampScale(capped);
    setScale(next);
    setPos({
      x: (containerSize.width - contentWidth * next) / 2,
      y: (containerSize.height - contentHeight * next) / 2,
    });
  }, [clampScale]);

  return {
    scale, pos, setScale, setPos, clampScale, spaceDown,
    isPanning, startPan, zoomAtScreenPoint, handleWheel, zoomIn, zoomOut, zoomTo, zoomTo100, centerOn, fit,
  };
}
