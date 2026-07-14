import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Stage, Layer, Image as KonvaImage, Rect, Ellipse, Line, Text as KonvaText, Transformer } from 'react-konva';
import type Konva from 'konva';
import type { Page } from '../../types';
import { BLEND_TO_COMPOSITE, type StudioLayer, type TextLayerData } from './studioTypes';
import { detectBubbleCenter } from './bubbleDetect';
import { swalToast } from '../../lib/swalTheme';
import { getOrCreateCanvasFor, deleteCanvasFor, type PaintCanvasRegistry } from './paint/paintCanvasRegistry';
import { usePaintLayer, PAINT_TOOLS } from './paint/usePaintLayer';
import type { Selection } from './paint/selection';
import { strokePenPath, type PaintSettings } from './paint/paintEngine';
import type { SerializedStudioLayer } from '../../lib/studioProjectStore';

export interface ExportSnapshot {
  width: number;
  height: number;
  backgroundDataUrl: string;
  /** Bottom-to-top, same order as the layers panel; raster layers carry their pixels as a data URL. */
  layers: SerializedStudioLayer[];
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const MARQUEE_TOOLS = new Set(['marquee-rect', 'marquee-ellipse', 'marquee-row', 'marquee-col', 'crop']);
const LASSO_TOOLS = new Set(['lasso-freehand']);

interface StudioCanvasProps {
  page: Page | null;
  showCleaned: boolean;
  /** 0 disables; >0 blends the original page as a translucent overlay above the cleaned page. */
  overlayOpacity: number;
  activeTool: string;
  /** Bumped by the parent (e.g. toolbar "Fit" button) to force a re-fit. */
  fitSignal: number;
  /** Non-background layers stacked above the page image, bottom to top. */
  layers: StudioLayer[];
  activeLayerId: string | null;
  onSelectLayer: (id: string) => void;
  /** x/y are in page-image coordinates. */
  onAddTextLayer: (x: number, y: number) => void;
  onUpdateTextLayer: (id: string, patch: Partial<TextLayerData>) => void;
  /** Current brush/fill/etc. settings, driven by the tool options bar. */
  paintSettings: PaintSettings;
  /** Active selection (marquee/lasso/wand); paint ops clip to this when present. */
  selection: Selection;
  onSelectionChange: (sel: Selection) => void;
  /** Fired once per committed stroke/fill/etc. on a raster layer, with its pixels just before the op, for the history stack. */
  onPaintStrokeEnd: (layerId: string, before: ImageData) => void;
  /** Fired when the Eyedropper samples a pixel from the background page image. */
  onEyedropperPick?: (hex: string) => void;
}

export interface StudioCanvasHandle {
  /** Flood-fills the page around a text layer to find its speech bubble and re-centers it there. */
  centerTextLayerInBubble: (id: string) => void;
  /** Returns the raster canvas for a layer id, creating it if the layer has no backing yet. */
  getPaintCanvas: (layerId: string) => HTMLCanvasElement | null;
  /** Frees a raster layer's canvas when its layer is deleted. */
  deletePaintCanvas: (layerId: string) => void;
  /** Forces Konva to redraw a layer after its raster canvas was mutated directly (e.g. by undo/redo). */
  redrawLayer: (layerId: string) => void;
  /** Snapshots every raster layer with a live canvas backing (for persistence) as PNG data URLs, keyed by layer id. */
  exportRasterLayers: () => Record<string, string>;
  /** Decodes a saved data URL back into a layer's raster canvas (for restoring persisted state). */
  loadRasterLayer: (layerId: string, dataUrl: string) => Promise<void>;
  /** Snapshots the active page's background + full layer stack for flatten/PSD export. Null if no page is loaded. */
  getExportSnapshot: () => ExportSnapshot | null;
  getZoom: () => number;
  zoomTo: (scale: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
}

export const StudioCanvas = forwardRef<StudioCanvasHandle, StudioCanvasProps>(function StudioCanvas({
  page, showCleaned, overlayOpacity, activeTool, fitSignal, layers,
  activeLayerId, onSelectLayer, onAddTextLayer, onUpdateTextLayer,
  paintSettings, selection, onSelectionChange, onPaintStrokeEnd, onEyedropperPick,
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const textNodeRefs = useRef<Record<string, Konva.Text | null>>({});
  const layerNodeRefs = useRef<Record<string, Konva.Layer | null>>({});
  const paintCanvasRegistry = useRef<PaintCanvasRegistry>({});
  const layersRef = useRef(layers);
  layersRef.current = layers;
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  imageRef.current = image;
  const pinchDistRef = useRef<number | null>(null);
  const prevPinchCenterRef = useRef<{ x: number; y: number } | null>(null);
  const [touchCount, setTouchCount] = useState(0);
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const marqueeStartRef = useRef<{ x: number; y: number } | null>(null);
  const lassoPointsRef = useRef<{ x: number; y: number }[] | null>(null);
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [penPoints, setPenPoints] = useState<{ x: number; y: number }[]>([]);
  const [lassoPolyPoints, setLassoPolyPoints] = useState<{ x: number; y: number }[]>([]);
  const [overlayImage, setOverlayImage] = useState<HTMLImageElement | null>(null);

  // Spacebar-hold and middle-mouse-button pan, available regardless of the active tool (Photoshop-style).
  const [spaceDown, setSpaceDown] = useState(false);
  const panRef = useRef<{ active: boolean; lastX: number; lastY: number } | null>(null);
  useEffect(() => {
    function isTextInputFocused() {
      const el = document.activeElement;
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable;
    }
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

  const activeLayer = layers.find(l => l.id === activeLayerId) ?? null;
  const isPaintTool = (PAINT_TOOLS as readonly string[]).includes(activeTool);
  const paintLayerIdRef = useRef<string | null>(null);
  paintLayerIdRef.current = activeLayer?.type === 'clean-patch' ? activeLayer.id : null;

  const getActivePaintCanvas = useCallback(() => {
    const layerId = paintLayerIdRef.current;
    const img = imageRef.current;
    if (!layerId || !img) return null;
    return getOrCreateCanvasFor(paintCanvasRegistry.current, layerId, img.width, img.height);
  }, []);

  const paint = usePaintLayer({
    getCanvas: getActivePaintCanvas,
    settings: paintSettings,
    selection,
    onSelectionChange,
    onStrokeEnd: (before) => {
      const layerId = paintLayerIdRef.current;
      layerNodeRefs.current[layerId ?? '']?.batchDraw();
      if (layerId) onPaintStrokeEnd(layerId, before);
    },
  });

  useImperativeHandle(ref, () => ({
    getPaintCanvas(layerId: string) {
      const img = imageRef.current;
      if (!img) return null;
      return getOrCreateCanvasFor(paintCanvasRegistry.current, layerId, img.width, img.height);
    },
    redrawLayer(layerId: string) {
      layerNodeRefs.current[layerId]?.batchDraw();
    },
    deletePaintCanvas(layerId: string) {
      deleteCanvasFor(paintCanvasRegistry.current, layerId);
    },
    exportRasterLayers() {
      // Exports every raster canvas the registry currently holds — not just the active page's —
      // since the registry accumulates canvases for every page visited this session, and pages
      // navigated away from still need their edits captured on the next autosave.
      const out: Record<string, string> = {};
      for (const [layerId, canvas] of Object.entries(paintCanvasRegistry.current)) {
        if (canvas) out[layerId] = canvas.toDataURL('image/png');
      }
      return out;
    },
    async loadRasterLayer(layerId: string, dataUrl: string) {
      // The background image for a freshly-switched-to page loads asynchronously, so give it
      // a brief window to arrive rather than silently dropping the restore on a race.
      const img = imageRef.current ?? await waitForImage(imageRef);
      if (!img) return;
      const source = new window.Image();
      await new Promise<void>((resolve, reject) => {
        source.onload = () => resolve();
        source.onerror = () => reject(new Error(`Failed to decode raster layer ${layerId}`));
        source.src = dataUrl;
      });
      const canvas = getOrCreateCanvasFor(paintCanvasRegistry.current, layerId, img.width, img.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
      layerNodeRefs.current[layerId]?.batchDraw();
    },
    getExportSnapshot() {
      const img = imageRef.current;
      if (!img) return null;
      const bgCanvas = document.createElement('canvas');
      bgCanvas.width = img.width;
      bgCanvas.height = img.height;
      bgCanvas.getContext('2d')!.drawImage(img, 0, 0);
      const exportLayers: SerializedStudioLayer[] = layersRef.current.map((l) => {
        const canvas = paintCanvasRegistry.current[l.id];
        return canvas ? { ...l, raster: canvas.toDataURL('image/png') } : l;
      });
      return { width: img.width, height: img.height, backgroundDataUrl: bgCanvas.toDataURL('image/png'), layers: exportLayers };
    },
    getZoom() {
      return scale;
    },
    zoomTo(nextScale: number) {
      const clamped = clampScale(nextScale);
      const cx = containerSize.width / 2, cy = containerSize.height / 2;
      const pointTo = { x: (cx - pos.x) / scale, y: (cy - pos.y) / scale };
      setScale(clamped);
      setPos({ x: cx - pointTo.x * clamped, y: cy - pointTo.y * clamped });
    },
    zoomIn() {
      this.zoomTo(scale * 1.25);
    },
    zoomOut() {
      this.zoomTo(scale / 1.25);
    },
    centerTextLayerInBubble(id: string) {
      const layer = layersRef.current.find(l => l.id === id);
      const img = imageRef.current;
      if (!layer?.text || !img) return;
      const lineCount = layer.text.content.split('\n').length || 1;
      const textHeight = lineCount * layer.text.fontSize * layer.text.lineHeight;
      const seedX = layer.text.x;
      const seedY = layer.text.y + textHeight / 2;
      const result = detectBubbleCenter(img, seedX, seedY);
      if (!result) {
        swalToast({ icon: 'info', title: 'No bubble detected — place the text over a light bubble first' });
        return;
      }
      onUpdateTextLayer(id, {
        x: result.x - layer.text.width / 2,
        y: result.y - textHeight / 2,
      });
      swalToast({ icon: 'success', title: 'Centered in bubble' });
    },
  }), [onUpdateTextLayer, scale, pos, containerSize]);

  const activeSource = showCleaned && page?.cleaned ? page.cleaned : page?.original ?? null;
  // Only meaningful when the cleaned page is the base — overlaying the original above itself is a no-op.
  const overlaySource = showCleaned && overlayOpacity > 0 && page?.cleaned && page?.original ? page.original : null;

  // Load the active image element for Konva.
  useEffect(() => {
    if (!activeSource) { setImage(null); return; }
    const img = new window.Image();
    img.src = activeSource.dataUrl;
    img.onload = () => setImage(img);
    return () => { img.onload = null; };
  }, [activeSource]);

  // Load the original-page overlay image (view-original-above-cleaned mode).
  useEffect(() => {
    if (!overlaySource) { setOverlayImage(null); return; }
    const img = new window.Image();
    img.src = overlaySource.dataUrl;
    img.onload = () => setOverlayImage(img);
    return () => { img.onload = null; };
  }, [overlaySource]);

  // Esc cancels an in-progress Pen path or polygonal lasso; Enter commits either.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && penPoints.length > 0) setPenPoints([]);
      if (e.key === 'Escape' && lassoPolyPoints.length > 0) setLassoPolyPoints([]);
      if (e.key === 'Enter' && activeTool === 'pen' && penPoints.length > 1) commitPenPath();
      if (e.key === 'Enter' && activeTool === 'lasso-polygon' && lassoPolyPoints.length > 2) commitLassoPolygon();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [penPoints, lassoPolyPoints, activeTool]);

  // Eyedropper samples from a hidden replica of the background image (approximation — doesn't include raster layers yet).
  useEffect(() => {
    if (!image) { sampleCanvasRef.current = null; return; }
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext('2d')!.drawImage(image, 0, 0);
    sampleCanvasRef.current = canvas;
  }, [image]);

  // Track container size responsively.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setContainerSize({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fitToScreen = useCallback(() => {
    if (!image || containerSize.width === 0 || containerSize.height === 0) return;
    const padding = 32;
    const scaleX = (containerSize.width - padding * 2) / image.width;
    const scaleY = (containerSize.height - padding * 2) / image.height;
    const next = Math.min(scaleX, scaleY, 1.5);
    setScale(next);
    setPos({
      x: (containerSize.width - image.width * next) / 2,
      y: (containerSize.height - image.height * next) / 2,
    });
  }, [image, containerSize]);

  useEffect(() => { fitToScreen(); }, [fitToScreen, page?.id, fitSignal]);

  // Freshly created text layers start empty — drop straight into editing mode.
  useEffect(() => {
    const layer = layersRef.current.find(l => l.id === activeLayerId);
    if (layer?.type === 'text' && layer.text?.content === '') {
      setEditingLayerId(layer.id);
    }
  }, [activeLayerId]);

  // Keep the Transformer bound to the selected text layer's node.
  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) return;
    const node = activeTool === 'select' && !editingLayerId && activeLayerId
      ? textNodeRefs.current[activeLayerId]
      : null;
    transformer.nodes(node ? [node] : []);
    transformer.getLayer()?.batchDraw();
  }, [activeLayerId, activeTool, editingLayerId, layers]);

  const handleStageClick = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    const targetClass = e.target.getClassName?.();
    const clickedBackground = e.target === e.target.getStage() || targetClass === 'Image' || targetClass === 'Rect';

    if (activeTool === 'pen') {
      const stage = stageRef.current;
      const pointer = stage?.getPointerPosition();
      if (!stage || !pointer) return;
      setPenPoints(prev => [...prev, { x: (pointer.x - pos.x) / scale, y: (pointer.y - pos.y) / scale }]);
      return;
    }

    if (activeTool === 'lasso-polygon') {
      const p = imageSpacePointer();
      if (!p) return;
      setLassoPolyPoints(prev => [...prev, p]);
      return;
    }

    if (activeTool !== 'text') return;
    if (!clickedBackground) return;
    const stage = stageRef.current;
    const pointer = stage?.getPointerPosition();
    if (!stage || !pointer) return;
    onAddTextLayer((pointer.x - pos.x) / scale, (pointer.y - pos.y) / scale);
  };

  const imageSpacePointer = (): { x: number; y: number } | null => {
    const stage = stageRef.current;
    const pointer = stage?.getPointerPosition();
    if (!stage || !pointer) return null;
    return { x: (pointer.x - pos.x) / scale, y: (pointer.y - pos.y) / scale };
  };

  const handlePaintPointerDown = (e: Konva.KonvaEventObject<PointerEvent>) => {
    // A second touch point mid-gesture belongs to two-finger pan/pinch (handled by the Touch
    // handlers below), not tool dispatch — Pointer Events fire per-finger independently.
    if (e.evt.pointerType === 'touch' && touchCount >= 2) return;
    // Middle-mouse-button drag, or left-click while Space is held, pans regardless of the active tool.
    if (e.evt.button === 1 || (e.evt.button === 0 && spaceDown)) {
      e.evt.preventDefault();
      panRef.current = { active: true, lastX: e.evt.clientX, lastY: e.evt.clientY };
      return;
    }
    if (activeTool === 'wand') {
      const p = imageSpacePointer();
      if (p) paint.pickMagicWand(p.x, p.y);
      return;
    }
    if (activeTool === 'eyedropper') {
      const p = imageSpacePointer();
      const canvas = sampleCanvasRef.current;
      if (!p || !canvas || !onEyedropperPick) return;
      const x = Math.max(0, Math.min(canvas.width - 1, Math.round(p.x)));
      const y = Math.max(0, Math.min(canvas.height - 1, Math.round(p.y)));
      const d = canvas.getContext('2d')!.getImageData(x, y, 1, 1).data;
      onEyedropperPick(`#${[d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join('')}`);
      return;
    }
    if (MARQUEE_TOOLS.has(activeTool)) {
      const p = imageSpacePointer();
      if (!p || !image) return;
      if (activeTool === 'marquee-row') {
        onSelectionChange({ kind: 'rect', x: 0, y: p.y - 2, width: image.width, height: 4 });
        return;
      }
      if (activeTool === 'marquee-col') {
        onSelectionChange({ kind: 'rect', x: p.x - 2, y: 0, width: 4, height: image.height });
        return;
      }
      marqueeStartRef.current = p;
      return;
    }
    if (LASSO_TOOLS.has(activeTool)) {
      const p = imageSpacePointer();
      if (!p) return;
      lassoPointsRef.current = [p];
      return;
    }
    if (!isPaintTool) return;
    const p = imageSpacePointer();
    if (!p) return;
    // A real stylus reports actual pressure; mouse/touch report a flat 0.5 per spec, which isn't
    // meaningful pressure data, so only let pen input affect brush size.
    const pressure = e.evt.pointerType === 'pen' ? e.evt.pressure || 0.5 : 1;
    paint.pointerDown(activeTool as Parameters<typeof paint.pointerDown>[0], p.x, p.y, e.evt.altKey, pressure);
  };
  // Window-level mousemove/mouseup for middle-mouse/space-drag panning, so the drag keeps
  // tracking even if the pointer leaves the canvas bounds.
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

  const handlePaintPointerMove = (e: Konva.KonvaEventObject<PointerEvent>) => {
    if (panRef.current?.active) return;
    if (e.evt.pointerType === 'touch' && touchCount >= 2) return;
    if (MARQUEE_TOOLS.has(activeTool) && marqueeStartRef.current) {
      const p = imageSpacePointer();
      if (!p) return;
      const start = marqueeStartRef.current;
      let width = Math.abs(p.x - start.x);
      let height = Math.abs(p.y - start.y);
      // Shift constrains Rectangular/Elliptical Marquee to a perfect square/circle, Photoshop-style.
      if (e.evt.shiftKey) {
        const side = Math.max(width, height);
        width = side;
        height = side;
      }
      const rect = {
        x: p.x >= start.x ? start.x : start.x - width,
        y: p.y >= start.y ? start.y : start.y - height,
        width,
        height,
      };
      onSelectionChange(activeTool === 'marquee-ellipse' ? { kind: 'ellipse', ...rect } : { kind: 'rect', ...rect });
      return;
    }
    if (LASSO_TOOLS.has(activeTool) && lassoPointsRef.current) {
      const p = imageSpacePointer();
      if (!p) return;
      lassoPointsRef.current = [...lassoPointsRef.current, p];
      onSelectionChange({ kind: 'polygon', points: lassoPointsRef.current });
      return;
    }
    if (!isPaintTool) return;
    const p = imageSpacePointer();
    if (!p) return;
    const pressure = e.evt.pointerType === 'pen' ? e.evt.pressure || 0.5 : 1;
    paint.pointerMove(activeTool as Parameters<typeof paint.pointerMove>[0], p.x, p.y, pressure);
    layerNodeRefs.current[paintLayerIdRef.current ?? '']?.batchDraw();
  };
  const handlePaintPointerUp = (e: Konva.KonvaEventObject<PointerEvent>) => {
    if (e.evt.pointerType === 'touch' && touchCount >= 2) return;
    if (panRef.current?.active) { panRef.current = null; return; }
    if (MARQUEE_TOOLS.has(activeTool)) { marqueeStartRef.current = null; return; }
    if (LASSO_TOOLS.has(activeTool)) { lassoPointsRef.current = null; return; }
    if (!isPaintTool) return;
    const p = imageSpacePointer();
    if (!p) return;
    paint.pointerUp(activeTool as Parameters<typeof paint.pointerUp>[0], p.x, p.y);
    layerNodeRefs.current[paintLayerIdRef.current ?? '']?.batchDraw();
  };

  const commitPenPath = () => {
    if (penPoints.length < 2) { setPenPoints([]); return; }
    const canvas = getActivePaintCanvas();
    const ctx = canvas?.getContext('2d');
    const layerId = paintLayerIdRef.current;
    if (canvas && ctx && layerId) {
      const before = ctx.getImageData(0, 0, canvas.width, canvas.height);
      strokePenPath(ctx, penPoints, true, { fillColor: null, strokeColor: paintSettings.color, strokeWidth: Math.max(2, paintSettings.size / 6) }, selection);
      layerNodeRefs.current[layerId]?.batchDraw();
      onPaintStrokeEnd(layerId, before);
    }
    setPenPoints([]);
  };

  const commitLassoPolygon = () => {
    if (lassoPolyPoints.length > 2) onSelectionChange({ kind: 'polygon', points: lassoPolyPoints });
    setLassoPolyPoints([]);
  };

  const handleStageDblClick = () => {
    if (activeTool === 'pen') commitPenPath();
    if (activeTool === 'lasso-polygon') commitLassoPolygon();
  };

  const editingLayer = editingLayerId ? layers.find(l => l.id === editingLayerId) ?? null : null;

  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const oldScale = scale;
    const direction = e.evt.deltaY > 0 ? -1 : 1;
    const zoomFactor = 1.08;
    const newScale = clampScale(direction > 0 ? oldScale * zoomFactor : oldScale / zoomFactor);

    const mousePointTo = {
      x: (pointer.x - pos.x) / oldScale,
      y: (pointer.y - pos.y) / oldScale,
    };

    setScale(newScale);
    setPos({
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    });
  };

  const handleTouchMove = (e: Konva.KonvaEventObject<TouchEvent>) => {
    const touches = e.evt.touches;
    if (touches.length !== 2) return;
    e.evt.preventDefault();

    const [t1, t2] = [touches[0], touches[1]];
    const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
    const center = {
      x: (t1.clientX + t2.clientX) / 2,
      y: (t1.clientY + t2.clientY) / 2,
    };
    const stage = stageRef.current;
    const box = containerRef.current?.getBoundingClientRect();
    if (!stage || !box) return;
    const stagePoint = { x: center.x - box.left, y: center.y - box.top };

    if (pinchDistRef.current == null || prevPinchCenterRef.current == null) {
      pinchDistRef.current = dist;
      prevPinchCenterRef.current = stagePoint;
      return;
    }

    const oldScale = scale;
    const newScale = clampScale(oldScale * (dist / pinchDistRef.current));
    pinchDistRef.current = dist;

    // Anchor on the previous frame's pinch center (not the current one) so that a plain
    // two-finger drag — no distance change — pans by the center's movement instead of no-op'ing.
    const prevCenter = prevPinchCenterRef.current;
    prevPinchCenterRef.current = stagePoint;
    const anchorWorld = {
      x: (prevCenter.x - pos.x) / oldScale,
      y: (prevCenter.y - pos.y) / oldScale,
    };
    setScale(newScale);
    setPos({
      x: stagePoint.x - anchorWorld.x * newScale,
      y: stagePoint.y - anchorWorld.y * newScale,
    });
  };

  const handleTouchEnd = (e: Konva.KonvaEventObject<TouchEvent>) => {
    if (e.evt.touches.length < 2) {
      pinchDistRef.current = null;
      prevPinchCenterRef.current = null;
    }
    setTouchCount(e.evt.touches.length);
  };

  // Space/middle-mouse panning is handled manually via panRef (see handlePaintPointerDown and the
  // window mousemove/mouseup effect) so it works uniformly across tools without fighting Konva's
  // own native drag-handling for the Pan/Select tools.
  const draggable = (activeTool === 'pan' || activeTool === 'select') && !spaceDown;
  const cursorClass = panRef.current?.active || spaceDown ? 'cursor-grab' : '';

  return (
    <div ref={containerRef} className={`relative w-full h-full overflow-hidden bg-[#0b0b0d] touch-none ${cursorClass}`}>
      {containerSize.width > 0 && (
        <Stage
          ref={stageRef}
          width={containerSize.width}
          height={containerSize.height}
          scaleX={scale}
          scaleY={scale}
          x={pos.x}
          y={pos.y}
          draggable={draggable && touchCount < 2}
          onDragEnd={(e) => setPos({ x: e.target.x(), y: e.target.y() })}
          onWheel={handleWheel}
          onTouchMove={handleTouchMove}
          onTouchStart={(e) => setTouchCount(e.evt.touches.length)}
          onTouchEnd={handleTouchEnd}
          onClick={handleStageClick}
          onTap={handleStageClick}
          onDblClick={handleStageDblClick}
          onPointerDown={handlePaintPointerDown}
          onPointerMove={handlePaintPointerMove}
          onPointerUp={handlePaintPointerUp}
        >
          <Layer>
            {image && (
              <>
                <Rect
                  x={-4}
                  y={-4}
                  width={image.width + 8}
                  height={image.height + 8}
                  fill="#000000"
                  shadowColor="black"
                  shadowBlur={20}
                  shadowOpacity={0.6}
                />
                <KonvaImage image={image} width={image.width} height={image.height} />
                {overlayImage && (
                  <KonvaImage
                    image={overlayImage}
                    width={image.width}
                    height={image.height}
                    opacity={overlayOpacity}
                    listening={false}
                  />
                )}
              </>
            )}
          </Layer>

          {/* Each Studio layer (clean patches, text, bubble masks...) gets its own Konva
              layer so opacity and blend mode compose independently of the background. */}
          {layers.filter(l => !l.isBackground).map(layer => (
            <Layer
              key={layer.id}
              ref={(node) => { layerNodeRefs.current[layer.id] = node; }}
              visible={layer.visible}
              opacity={layer.opacity}
              globalCompositeOperation={BLEND_TO_COMPOSITE[layer.blendMode]}
              listening={layer.visible && !layer.locked}
            >
              {layer.type === 'clean-patch' && image && (
                <KonvaImage
                  image={getOrCreateCanvasFor(paintCanvasRegistry.current, layer.id, image.width, image.height)}
                  width={image.width}
                  height={image.height}
                  listening={false}
                />
              )}
              {layer.type === 'text' && layer.text && (
                <KonvaText
                  ref={(node) => { textNodeRefs.current[layer.id] = node; }}
                  visible={layer.id !== editingLayerId}
                  text={layer.text.content || ' '}
                  x={layer.text.x}
                  y={layer.text.y}
                  width={layer.text.width}
                  fontFamily={layer.text.fontFamily}
                  fontSize={layer.text.fontSize}
                  fontStyle={`${layer.text.bold ? 'bold' : ''} ${layer.text.italic ? 'italic' : ''}`.trim() || 'normal'}
                  fill={layer.text.color}
                  align={layer.text.align}
                  lineHeight={layer.text.lineHeight}
                  stroke={layer.text.strokeWidth > 0 ? layer.text.strokeColor : undefined}
                  strokeWidth={layer.text.strokeWidth}
                  rotation={layer.text.rotation}
                  draggable={activeTool === 'select' && !layer.locked}
                  onClick={() => onSelectLayer(layer.id)}
                  onTap={() => onSelectLayer(layer.id)}
                  onDblClick={() => { onSelectLayer(layer.id); setEditingLayerId(layer.id); }}
                  onDblTap={() => { onSelectLayer(layer.id); setEditingLayerId(layer.id); }}
                  onDragEnd={(e) => onUpdateTextLayer(layer.id, { x: e.target.x(), y: e.target.y() })}
                  onTransformEnd={(e) => {
                    const node = e.target as Konva.Text;
                    const scaleX = node.scaleX();
                    const scaleY = node.scaleY();
                    node.scaleX(1);
                    node.scaleY(1);
                    onUpdateTextLayer(layer.id, {
                      x: node.x(),
                      y: node.y(),
                      rotation: node.rotation(),
                      width: Math.max(20, node.width() * scaleX),
                      fontSize: Math.max(6, layer.text!.fontSize * scaleY),
                    });
                  }}
                />
              )}
            </Layer>
          ))}

          <Layer listening={false}>
            {selection.kind === 'rect' && (
              <Rect x={selection.x} y={selection.y} width={selection.width} height={selection.height}
                stroke="#ffffff" strokeWidth={1 / scale} dash={[6 / scale, 4 / scale]} />
            )}
            {selection.kind === 'ellipse' && (
              <Ellipse x={selection.x + selection.width / 2} y={selection.y + selection.height / 2}
                radiusX={Math.abs(selection.width) / 2} radiusY={Math.abs(selection.height) / 2}
                stroke="#ffffff" strokeWidth={1 / scale} dash={[6 / scale, 4 / scale]} />
            )}
            {selection.kind === 'polygon' && selection.points.length > 1 && (
              <Line points={selection.points.flatMap(p => [p.x, p.y])} closed
                stroke="#ffffff" strokeWidth={1 / scale} dash={[6 / scale, 4 / scale]} />
            )}
            {selection.kind === 'mask' && (
              <Rect x={selection.bounds.x} y={selection.bounds.y} width={selection.bounds.width} height={selection.bounds.height}
                stroke="#ffffff" strokeWidth={1 / scale} dash={[6 / scale, 4 / scale]} opacity={0.8} />
            )}
            {penPoints.length > 0 && (
              <>
                <Line points={penPoints.flatMap(p => [p.x, p.y])} stroke={paintSettings.color} strokeWidth={2 / scale} />
                {penPoints.map((p, i) => (
                  <Rect key={i} x={p.x - 3 / scale} y={p.y - 3 / scale} width={6 / scale} height={6 / scale} fill={paintSettings.color} />
                ))}
              </>
            )}
            {lassoPolyPoints.length > 0 && (
              <>
                <Line points={lassoPolyPoints.flatMap(p => [p.x, p.y])} closed={lassoPolyPoints.length > 2}
                  stroke="#ffffff" strokeWidth={1.5 / scale} dash={[6 / scale, 4 / scale]} />
                {lassoPolyPoints.map((p, i) => (
                  <Rect key={i} x={p.x - 3 / scale} y={p.y - 3 / scale} width={6 / scale} height={6 / scale} fill="#ffffff" />
                ))}
              </>
            )}
          </Layer>

          <Layer>
            <Transformer
              ref={transformerRef}
              rotateEnabled
              enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right', 'middle-left', 'middle-right']}
              boundBoxFunc={(oldBox, newBox) => (newBox.width < 20 ? oldBox : newBox)}
            />
          </Layer>
        </Stage>
      )}
      {editingLayer?.text && (
        <textarea
          autoFocus
          value={editingLayer.text.content}
          onChange={(e) => onUpdateTextLayer(editingLayer.id, { content: e.target.value })}
          onBlur={() => setEditingLayerId(null)}
          onKeyDown={(e) => { if (e.key === 'Escape') setEditingLayerId(null); }}
          className="absolute p-0 m-0 bg-black/20 border border-dashed border-white/50 outline-none resize-none overflow-hidden"
          style={{
            top: pos.y + editingLayer.text.y * scale,
            left: pos.x + editingLayer.text.x * scale,
            width: editingLayer.text.width * scale,
            fontSize: editingLayer.text.fontSize * scale,
            fontFamily: editingLayer.text.fontFamily,
            fontWeight: editingLayer.text.bold ? 'bold' : 'normal',
            fontStyle: editingLayer.text.italic ? 'italic' : 'normal',
            lineHeight: editingLayer.text.lineHeight,
            color: editingLayer.text.color,
            textAlign: editingLayer.text.align,
            zIndex: 20,
          }}
        />
      )}
      {!page && (
        <div className="absolute inset-0 flex items-center justify-center text-white/40 text-sm">
          Select a page to begin
        </div>
      )}
      <div className="absolute bottom-3 right-3 px-2.5 py-1 rounded-lg liquid-glass text-[11px] font-mono text-white/80">
        {Math.round(scale * 100)}%
      </div>
    </div>
  );
});

function waitForImage(imageRef: { current: HTMLImageElement | null }, timeoutMs = 3000): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const start = performance.now();
    function check() {
      if (imageRef.current) { resolve(imageRef.current); return; }
      if (performance.now() - start > timeoutMs) { resolve(null); return; }
      requestAnimationFrame(check);
    }
    check();
  });
}

function clampScale(value: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}
