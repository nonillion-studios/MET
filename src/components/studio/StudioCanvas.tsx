import { useEffect, useMemo, useRef, useState, useCallback, forwardRef, useImperativeHandle, type ReactNode } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { Stage, Layer, Group, Image as KonvaImage, Rect, Ellipse, Line, Text as KonvaText, Transformer } from 'react-konva';
import type Konva from 'konva';
import type { Page, ProcessedImage } from '../../types';
import { BLEND_TO_COMPOSITE, type StudioLayer, type TextLayerData, type LayerSelectMode } from './studioTypes';
import { detectBubbleCenter } from './bubbleDetect';
import { TextLayerNode, TEXT_HIT_NAME } from './TextLayerNode';
import {
  findLayer, findPath, getAtPath, getSiblings, flattenTree, mapTree, partitionAdjustments, groupClipRuns,
  type RenderNode, type ClipRun,
} from './layerTree';
import { layoutText } from './textLayout';
import { reflowRunsForContent } from './textRuns';
import { swalToast } from '../../lib/swalTheme';
import { getOrCreateCanvasFor, deleteCanvasFor, clonePaintCanvas, type PaintCanvasRegistry } from './paint/paintCanvasRegistry';
import { usePaintLayer, PAINT_TOOLS } from './paint/usePaintLayer';
import { NO_SELECTION, combineModeFromModifiers, combineSelections, type Selection, type SelectionCombineMode } from './paint/selection';
import { strokePenPath, type PaintSettings } from './paint/paintEngine';
import { BrushCursor } from './paint/BrushCursor';
import type { SerializedStudioLayer } from '../../lib/studioProjectStore';
import { filterForAdjustment, withStrength } from '../../lib/adjustments';

/** A character range inside one text layer, as reported by the editing textarea. */
export interface TextSelection {
  layerId: string;
  start: number;
  end: number;
}

export interface ExportSnapshot {
  width: number;
  height: number;
  backgroundDataUrl: string;
  /** Bottom-to-top, same order as the layers panel; raster layers carry their pixels as a data URL. */
  layers: SerializedStudioLayer[];
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const GRID_SIZE = 100;
const RULER_SIZE = 20;
const RULER_STEP = 100;
const MARQUEE_TOOLS = new Set(['marquee-rect', 'marquee-ellipse', 'marquee-row', 'marquee-col', 'crop']);
const LASSO_TOOLS = new Set(['lasso-freehand']);
/** Tools whose footprint is brush-sized, so they get the live outline cursor instead of the OS one. */
const BRUSH_CURSOR_TOOLS = new Set([
  'brush', 'pencil', 'eraser', 'clone', 'blur', 'sharpen', 'smudge',
  'dodge', 'burn', 'sponge', 'spot-heal', 'liquify',
]);

interface StudioCanvasProps {
  page: Page | null;
  showCleaned: boolean;
  /** 0 disables; >0 blends the original page as a translucent overlay above the cleaned page. */
  overlayOpacity: number;
  showGrid?: boolean;
  showRulers?: boolean;
  activeTool: string;
  /** Bumped by the parent (e.g. toolbar "Fit" button) to force a re-fit. */
  fitSignal: number;
  /** Non-background layers stacked above the page image, bottom to top. */
  layers: StudioLayer[];
  activeLayerId: string | null;
  onSelectLayer: (id: string, mode?: LayerSelectMode) => void;
  /** Every layer selected on canvas (primary last). Drives the combined transform box. */
  selectedLayerIds?: string[];
  /** Replaces the whole selection — used by the drag-a-box object marquee. */
  onSelectLayers?: (ids: string[]) => void;
  /** x/y are in page-image coordinates. */
  /** boxWidth given => box text of that width (click-drag); omitted => point text (click). */
  onAddTextLayer: (x: number, y: number, boxWidth?: number) => void;
  onUpdateTextLayer: (id: string, patch: Partial<TextLayerData>) => void;
  /**
   * The character range selected inside the text layer being edited, or null when nothing is being
   * edited. Lifted out of the canvas so TextPanel can apply character styling to the selection —
   * the editing overlay is a plain textarea, so its selectionStart/End *is* the selection model.
   */
  onTextSelectionChange?: (selection: TextSelection | null) => void;
  /** Current brush/fill/etc. settings, driven by the tool options bar. */
  paintSettings: PaintSettings;
  /** Active selection (marquee/lasso/wand); paint ops clip to this when present. */
  selection: Selection;
  onSelectionChange: (sel: Selection) => void;
  /** Fired once per committed stroke/fill/etc. on a raster layer, with its pixels just before the op, for the history stack. */
  onPaintStrokeEnd: (layerId: string, before: ImageData) => void;
  /** Fired when the Eyedropper samples a pixel from the background page image. */
  onEyedropperPick?: (hex: string) => void;
  /** Fired on Enter/double-click while the Crop tool is active, to commit the current rect selection as a crop. */
  onCommitCrop?: () => void;
  /** TypeR Multi-Bubble mode's already-queued rects, drawn as a distinct overlay from the live selection. */
  queuedBubbleRects?: { x: number; y: number; width: number; height: number }[];
}

export interface StudioCanvasHandle {
  /** Flood-fills the page around a text layer to find its speech bubble and re-centers it there. */
  centerTextLayerInBubble: (id: string) => void;
  /** Returns the raster canvas for a layer id, creating it if the layer has no backing yet. */
  getPaintCanvas: (layerId: string) => HTMLCanvasElement | null;
  /** Frees a raster layer's canvas when its layer is deleted. */
  deletePaintCanvas: (layerId: string) => void;
  /**
   * Clones raster pixels for every old→new id pair, for duplicating a layer or a whole group.
   * Takes the id map from `layerTree.cloneSubtree` — pairs with no canvas are skipped.
   */
  clonePaintCanvases: (idMap: Map<string, string>) => void;
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
  /**
   * Crops the background (original + cleaned) and every raster layer's canvas to `rect` (page-image
   * coordinates), in place. Returns the new original/cleaned image data so the caller (Studio.tsx)
   * can persist it and shift text layers by (-rect.x, -rect.y); null if there's no page loaded.
   */
  commitCrop: (rect: { x: number; y: number; width: number; height: number }) => Promise<{ original: ProcessedImage; cleaned: ProcessedImage | null } | null>;
  /**
   * Copies the current background pixels into a clean-patch layer's raster canvas. Called right
   * after a new layer is created so Clone/Heal/filter-brush/Liquify tools have real page content
   * to work on immediately — a brand new blank layer would make those tools no-ops, since they
   * only ever read/write the active layer's own canvas, never the background underneath it.
   */
  seedLayerWithBackground: (layerId: string) => void;
}

export const StudioCanvas = forwardRef<StudioCanvasHandle, StudioCanvasProps>(function StudioCanvas({
  page, showCleaned, overlayOpacity, showGrid = false, showRulers = false, activeTool, fitSignal, layers,
  activeLayerId, selectedLayerIds, onSelectLayer, onSelectLayers, onAddTextLayer, onUpdateTextLayer, onTextSelectionChange,
  paintSettings, selection, onSelectionChange, onPaintStrokeEnd, onEyedropperPick, onCommitCrop,
  queuedBubbleRects,
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const textNodeRefs = useRef<Record<string, Konva.Group | null>>({});
  /**
   * One Konva `Group` per StudioLayer. These used to be Konva `Layer`s — one canvas each — which
   * is why blend modes silently did nothing: `Container.drawScene` applies the composite op while
   * drawing children into the *current* canvas, and a Layer's own canvas starts empty, so
   * "multiply" had nothing beneath it to multiply with. Groups share the one stage canvas, so a
   * blend now composites against the background and everything under it, matching the exporter.
   */
  const layerNodeRefs = useRef<Record<string, Konva.Group | null>>({});
  /** Groups have no batchDraw of their own — only Layer does — so redraws go via the owning Layer. */
  const redrawLayerNode = useCallback((layerId: string | null | undefined) => {
    layerNodeRefs.current[layerId ?? '']?.getLayer()?.batchDraw();
  }, []);
  const paintCanvasRegistry = useRef<PaintCanvasRegistry>({});
  /** Per-layer pristine pre-liquify snapshot, for Liquify's Reconstruct mode — see usePaintLayer.ts. */
  const liquifySnapshots = useRef<Record<string, ImageData>>({}).current;
  const layersRef = useRef(layers);
  layersRef.current = layers;
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  imageRef.current = image;
  const bgImageNodeRef = useRef<Konva.Image | null>(null);
  const pinchDistRef = useRef<number | null>(null);
  const prevPinchCenterRef = useRef<{ x: number; y: number } | null>(null);
  const [touchCount, setTouchCount] = useState(0);
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  /** The canvas selection. Falls back to the primary layer when the host doesn't track a set. */
  const selectionIds = useMemo(
    () => selectedLayerIds ?? (activeLayerId ? [activeLayerId] : []),
    [selectedLayerIds, activeLayerId],
  );
  const marqueeStartRef = useRef<{ x: number; y: number } | null>(null);
  /** Text tool drag origin — a drag makes box text, a plain click makes point text. */
  const textDragRef = useRef<{ x: number; y: number } | null>(null);
  /** Set when a text drag already created a layer, so the trailing click doesn't make a second one. */
  const textDragConsumedRef = useRef(false);
  const lassoPointsRef = useRef<{ x: number; y: number }[] | null>(null);
  /** Selection to combine against and how, captured from Shift/Alt at the start of a marquee/lasso drag. */
  const combineBaseRef = useRef<Selection>(NO_SELECTION);
  const combineModeRef = useRef<SelectionCombineMode>('replace');
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  /** Pointer position in container/CSS px for the live brush outline; null when off-canvas. */
  const [brushCursorPos, setBrushCursorPos] = useState<{ x: number; y: number } | null>(null);
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

  const activeLayer = findLayer(layers, activeLayerId) ?? null;
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
      redrawLayerNode(layerId ?? '');
      if (layerId) onPaintStrokeEnd(layerId, before);
    },
    getLayerId: () => paintLayerIdRef.current,
    liquifySnapshots,
    getFallbackCanvas: () => sampleCanvasRef.current,
  });

  useImperativeHandle(ref, () => ({
    getPaintCanvas(layerId: string) {
      const img = imageRef.current;
      if (!img) return null;
      return getOrCreateCanvasFor(paintCanvasRegistry.current, layerId, img.width, img.height);
    },
    redrawLayer(layerId: string) {
      redrawLayerNode(layerId);
    },
    deletePaintCanvas(layerId: string) {
      deleteCanvasFor(paintCanvasRegistry.current, layerId);
      delete liquifySnapshots[layerId];
    },
    clonePaintCanvases(idMap: Map<string, string>) {
      // Liquify snapshots are deliberately not cloned: they're a pristine pre-liquify baseline for
      // Reconstruct, and the copy's baseline is its own starting pixels, captured on first use.
      for (const [fromId, toId] of idMap) clonePaintCanvas(paintCanvasRegistry.current, fromId, toId);
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
      redrawLayerNode(layerId);
    },
    getExportSnapshot() {
      const img = imageRef.current;
      if (!img) return null;
      const bgCanvas = document.createElement('canvas');
      bgCanvas.width = img.width;
      bgCanvas.height = img.height;
      // Deliberately *unfiltered*. Adjustments used to be baked in here, duplicating the filter
      // pipeline; now they're layers in the tree and `exportImage.ts` applies them on its walk —
      // one implementation, two consumers, which is what keeps the file matching the screen.
      const bgCtx = bgCanvas.getContext('2d')!;
      bgCtx.drawImage(img, 0, 0);
      // Walks the whole tree: pixels hang off layers at every depth, and a flat map would hand the
      // exporter a group whose children carry no raster — i.e. silently export an empty group.
      const exportLayers = mapTree<SerializedStudioLayer>(layersRef.current, (l) => {
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
      const layer = findLayer(layersRef.current, id);
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
    async commitCrop(rect) {
      if (!page) return null;
      const cw = page.original.width, ch = page.original.height;
      const rx = Math.max(0, Math.min(cw - 1, Math.round(Math.min(rect.x, rect.x + rect.width))));
      const ry = Math.max(0, Math.min(ch - 1, Math.round(Math.min(rect.y, rect.y + rect.height))));
      const rw = Math.max(0, Math.min(cw - rx, Math.round(Math.abs(rect.width))));
      const rh = Math.max(0, Math.min(ch - ry, Math.round(Math.abs(rect.height))));
      if (rw < 2 || rh < 2) return null;

      async function cropSource(pi: ProcessedImage): Promise<ProcessedImage> {
        const img = await loadImageFromSrc(pi.dataUrl);
        const canvas = document.createElement('canvas');
        canvas.width = rw;
        canvas.height = rh;
        canvas.getContext('2d')!.drawImage(img, rx, ry, rw, rh, 0, 0, rw, rh);
        return { ...pi, dataUrl: canvas.toDataURL(pi.mimeType || 'image/png'), width: rw, height: rh };
      }

      const newOriginal = await cropSource(page.original);
      const newCleaned = page.cleaned ? await cropSource(page.cleaned) : null;

      // Crop every raster layer's canvas in place — same registry object, so Konva's existing
      // <Image> references keep working, just pointing at newly-sized/redrawn pixel content.
      for (const layerId of Object.keys(paintCanvasRegistry.current)) {
        const old = paintCanvasRegistry.current[layerId];
        if (!old) continue;
        const cropped = document.createElement('canvas');
        cropped.width = rw;
        cropped.height = rh;
        cropped.getContext('2d')!.drawImage(old, rx, ry, rw, rh, 0, 0, rw, rh);
        old.width = rw;
        old.height = rh;
        old.getContext('2d')!.drawImage(cropped, 0, 0);
        redrawLayerNode(layerId);
      }

      return { original: newOriginal, cleaned: newCleaned };
    },
    seedLayerWithBackground(layerId: string) {
      const img = imageRef.current;
      if (!img) return;
      const canvas = getOrCreateCanvasFor(paintCanvasRegistry.current, layerId, img.width, img.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      redrawLayerNode(layerId);
    },
  }), [onUpdateTextLayer, scale, pos, containerSize, page]);

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

  // Esc cancels an in-progress Pen path or polygonal lasso; Enter commits either (or a pending Crop).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && penPoints.length > 0) setPenPoints([]);
      if (e.key === 'Escape' && lassoPolyPoints.length > 0) setLassoPolyPoints([]);
      if (e.key === 'Enter' && activeTool === 'pen' && penPoints.length > 1) commitPenPath();
      if (e.key === 'Enter' && activeTool === 'lasso-polygon' && lassoPolyPoints.length > 2) commitLassoPolygon();
      if (e.key === 'Enter' && activeTool === 'crop') onCommitCrop?.();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [penPoints, lassoPolyPoints, activeTool, onCommitCrop]);

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

  /**
   * Each adjustment renders as a wrapper Group around everything below it (see
   * `layerTree.partitionAdjustments`), cached so `filters()` has a rasterised subtree to work on.
   * `adjustmentNodeRefs` holds those wrappers, keyed by the adjustment layer's id.
   */
  const adjustmentNodeRefs = useRef<Record<string, Konva.Group | null>>({});
  const adjustmentLayers = useMemo(
    () => flattenTree(layers).filter(l => l.type === 'adjustment' && l.adjustment),
    [layers],
  );
  const adjustmentKey = useMemo(
    () => adjustmentLayers.map(l => `${l.id}:${l.visible}:${l.opacity}:${JSON.stringify(l.adjustment)}`).join('|'),
    [adjustmentLayers],
  );

  /**
   * Param changes call `filters()` and **never** `cache()`.
   *
   * Konva's `filters` setter only marks `_filterUpToDate = false`; `_getCachedSceneCanvas` then
   * reuses the cached scene canvas and re-runs just getImageData -> filter -> putImageData, leaving
   * the children alone. Calling `cache()` here instead would redraw the whole subtree on every
   * slider tick, turning a filter pass into a full page render. The structural cache is set up in
   * the effect below, keyed so it can't fire on a param change.
   */
  useEffect(() => {
    for (const layer of adjustmentLayers) {
      const node = adjustmentNodeRefs.current[layer.id];
      if (!node) continue;
      // Hiding an adjustment means dropping its filter, never hiding the wrapper — the wrapper is
      // the stack it adjusts. Opacity is folded into the filter for the same reason: fading the
      // wrapper would fade the page to transparent instead of easing the grade.
      node.filters(layer.visible ? [withStrength(filterForAdjustment(layer.adjustment!), layer.opacity)] : []);
    }
    stageRef.current?.batchDraw();
  }, [adjustmentKey, adjustmentLayers]);

  /**
   * Whether a group is an isolation boundary — i.e. must be rasterized to its own canvas and blitted
   * once, rather than letting its children draw straight onto what's below.
   *
   * This mirrors Photoshop's two group modes, and `isolatesGroup` in `exportImage.ts` **must stay
   * identical** or the screen and the exported file disagree:
   *
   *  - opacity 1 + normal blend => *pass-through*: children composite against everything beneath the
   *    group, exactly as if it weren't there. This is Photoshop's default for a new group, and it
   *    falls out for free from an uncached Konva Group.
   *  - anything else => *isolated*: the subtree composites against nothing but itself, then blits
   *    through the group's own alpha/blend. A Multiply child inside an isolated group therefore has
   *    nothing to multiply with and washes out — surprising, but it is what Photoshop does once a
   *    group stops being pass-through.
   *
   * Child count is deliberately NOT a condition. It's tempting (with one child there's nothing to
   * overlap, so the cache looks redundant) but it's wrong: isolation changes what the child blends
   * *against*, not just how the results stack, so skipping it for single-child groups makes the
   * canvas disagree with the exporter.
   */
  const needsIsolation = useCallback((layer: StudioLayer) =>
    layer.type === 'group' && (layer.opacity < 1 || layer.blendMode !== 'normal'), []);

  /** True when `layerId` is a clip base with layers riding on it — i.e. it renders as a clip run. */
  const hasClippedFollowers = useCallback((layerId: string) => {
    const siblings = getSiblings(layersRef.current, layerId);
    return groupClipRuns(siblings).some(run => run.base.id === layerId && run.followers.length > 0);
  }, []);

  // Re-cache only when the *structure* changes — never on a param tick. `cache()` redraws the whole
  // subtree, so calling it per slider frame would turn a blit into a full page render.
  const groupStructureKey = useMemo(
    () => flattenTree(layers)
      .map(l => `${l.id}:${l.type}:${l.visible}:${l.opacity}:${l.blendMode}:${l.clipped ?? false}:${l.children?.length ?? 0}`)
      .join('|'),
    [layers],
  );

  useEffect(() => {
    for (const layer of flattenTree(layersRef.current)) {
      const node = layerNodeRefs.current[layer.id];
      if (!node) continue;
      // An adjustment wrapper must be cached whatever its params: `filters()` runs over the cached
      // scene canvas, so without a cache there is nothing for the filter to read.
      //
      // A clip run must be cached too, and that one is a correctness requirement rather than a
      // fidelity one: its trailing `destination-in` pass would otherwise composite against the
      // shared stage canvas and erase every layer already drawn beneath it — the whole page.
      const isolate = needsIsolation(layer)
        || (layer.type === 'adjustment' && layer.visible)
        || hasClippedFollowers(layer.id);
      if (isolate) {
        // pixelRatio 1 = page-space pixels. The stage scale is a transform above the cache, so
        // caching at devicePixelRatio would make cost (and memory) scale with zoom for no gain.
        node.cache({ pixelRatio: 1 });
      } else if (node.isCached()) {
        node.clearCache();
      }
    }
    stageRef.current?.batchDraw();
  }, [groupStructureKey, image, needsIsolation]);

  /**
   * A cached ancestor holds a stale snapshot of its subtree, so a brush stroke on a layer inside an
   * isolated group wouldn't appear until the cache is rebuilt — and rebuilding per stroke segment
   * is a full page redraw per pointermove. Instead, drop those caches for the duration of the
   * stroke and restore them on commit. The group is transiently un-isolated while drawing, which is
   * what Photoshop does on a heavy file too.
   */
  const suspendedCachesRef = useRef<string[]>([]);

  const suspendAncestorCaches = useCallback((layerId: string | null) => {
    if (!layerId) return;
    const path = findPath(layersRef.current, layerId);
    if (!path) return;
    const ids: string[] = [];
    for (let i = 1; i < path.length; i += 1) {
      const ancestor = getAtPath(layersRef.current, path.slice(0, i));
      const node = ancestor ? layerNodeRefs.current[ancestor.id] : null;
      if (ancestor && node?.isCached()) { node.clearCache(); ids.push(ancestor.id); }
    }
    suspendedCachesRef.current = ids;
  }, []);

  const restoreAncestorCaches = useCallback(() => {
    for (const id of suspendedCachesRef.current) layerNodeRefs.current[id]?.cache({ pixelRatio: 1 });
    suspendedCachesRef.current = [];
    stageRef.current?.batchDraw();
  }, []);

  // Freshly created text layers start empty — drop straight into editing mode.
  useEffect(() => {
    const layer = findLayer(layersRef.current, activeLayerId);
    if (layer?.type === 'text' && layer.text?.content === '') {
      setEditingLayerId(layer.id);
    }
  }, [activeLayerId]);

  // Keep the Transformer bound to every selected text node. Konva derives the combined bounding box
  // from the node list itself, so a multi-selection needs no separate box maths.
  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) return;
    const nodes = activeTool === 'select' && !editingLayerId
      ? selectionIds.map(id => textNodeRefs.current[id]).filter((n): n is Konva.Group => !!n)
      : [];
    transformer.nodes(nodes);
    transformer.getLayer()?.batchDraw();
  }, [selectionIds, activeTool, editingLayerId, layers]);

  const handleStageClick = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    const targetClass = e.target.getClassName?.();
    // A text layer's hit area is a Rect too, so it must be excluded by name — otherwise clicking
    // text counts as clicking background and clears the selection the click just made.
    const clickedBackground = e.target === e.target.getStage() || targetClass === 'Image'
      || (targetClass === 'Rect' && !e.target.hasName(TEXT_HIT_NAME));

    if (activeTool === 'zoom') {
      const stage = stageRef.current;
      const pointer = stage?.getPointerPosition();
      if (!stage || !pointer) return;
      const factor = e.evt.altKey ? 1 / 1.5 : 1.5;
      const oldScale = scale;
      const newScale = clampScale(oldScale * factor);
      const pointTo = { x: (pointer.x - pos.x) / oldScale, y: (pointer.y - pos.y) / oldScale };
      setScale(newScale);
      setPos({ x: pointer.x - pointTo.x * newScale, y: pointer.y - pointTo.y * newScale });
      return;
    }

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
      setLassoPolyPoints(prev => {
        if (prev.length === 0) {
          combineBaseRef.current = selection;
          combineModeRef.current = combineModeFromModifiers(e.evt.shiftKey, e.evt.altKey);
        }
        return [...prev, p];
      });
      return;
    }

    // Clicking empty canvas with the Select tool clears the selection — without this there'd be no
    // way to drop a multi-selection short of clicking another layer.
    if (activeTool === 'select') {
      if (objectMarqueeConsumedRef.current) { objectMarqueeConsumedRef.current = false; return; }
      if (clickedBackground) onSelectLayers?.([]);
      return;
    }

    if (activeTool !== 'text') return;
    if (textDragConsumedRef.current) { textDragConsumedRef.current = false; return; }
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
    if (activeTool === 'select') {
      // Only a drag starting on empty canvas marquees; starting on a layer means move it.
      const targetClass = e.target.getClassName?.();
      const onEmpty = e.target === e.target.getStage() || targetClass === 'Image';
      if (!onEmpty) return;
      const p = imageSpacePointer();
      if (!p) return;
      objectMarqueeRef.current = { x: p.x, y: p.y, additive: e.evt.shiftKey };
      return;
    }
    if (activeTool === 'text') {
      const p = imageSpacePointer();
      if (p) textDragRef.current = p;
      return;
    }
    if (activeTool === 'wand') {
      const p = imageSpacePointer();
      if (p) paint.pickMagicWand(p.x, p.y, combineModeFromModifiers(e.evt.shiftKey, e.evt.altKey));
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
      const mode = combineModeFromModifiers(e.evt.shiftKey, e.evt.altKey);
      if (activeTool === 'marquee-row') {
        const rect: Selection = { kind: 'rect', x: 0, y: p.y - 2, width: image.width, height: 4 };
        onSelectionChange(mode === 'replace' ? rect : combineSelections(selection, rect, mode, image.width, image.height));
        return;
      }
      if (activeTool === 'marquee-col') {
        const rect: Selection = { kind: 'rect', x: p.x - 2, y: 0, width: 4, height: image.height };
        onSelectionChange(mode === 'replace' ? rect : combineSelections(selection, rect, mode, image.width, image.height));
        return;
      }
      combineBaseRef.current = selection;
      combineModeRef.current = mode;
      marqueeStartRef.current = p;
      return;
    }
    if (LASSO_TOOLS.has(activeTool)) {
      const p = imageSpacePointer();
      if (!p) return;
      combineBaseRef.current = selection;
      combineModeRef.current = combineModeFromModifiers(e.evt.shiftKey, e.evt.altKey);
      lassoPointsRef.current = [p];
      return;
    }
    if (!isPaintTool) return;
    const p = imageSpacePointer();
    if (!p) return;
    // A real stylus reports actual pressure; mouse/touch report a flat 0.5 per spec, which isn't
    // meaningful pressure data, so only let pen input affect brush size.
    const pressure = e.evt.pointerType === 'pen' ? e.evt.pressure || 0.5 : 1;
    // Drop any cached ancestor group for the duration of the stroke, or its stale snapshot hides
    // every segment until commit and the brush reads as broken.
    suspendAncestorCaches(paintLayerIdRef.current);
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
    if (objectMarqueeRef.current) {
      const p = imageSpacePointer();
      if (!p) return;
      const start = objectMarqueeRef.current;
      setObjectMarquee({
        x: Math.min(start.x, p.x),
        y: Math.min(start.y, p.y),
        width: Math.abs(p.x - start.x),
        height: Math.abs(p.y - start.y),
      });
      return;
    }
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
    redrawLayerNode(paintLayerIdRef.current);
  };
  const handlePaintPointerUp = (e: Konva.KonvaEventObject<PointerEvent>) => {
    if (e.evt.pointerType === 'touch' && touchCount >= 2) return;
    if (panRef.current?.active) { panRef.current = null; return; }
    if (objectMarqueeRef.current) {
      const { additive } = objectMarqueeRef.current;
      const box = objectMarquee;
      objectMarqueeRef.current = null;
      setObjectMarquee(null);
      // A tiny box is a click on empty canvas, not a drag — handleStageClick clears the selection.
      if (!box || box.width < 4 || box.height < 4) return;
      objectMarqueeConsumedRef.current = true;
      const hits = flattenTree(layers)
        .filter(l => l.type === 'text' && !l.locked && l.visible)
        .filter(l => {
          const r = textLayerRect(l.id);
          return !!r && r.x < box.x + box.width && r.x + r.width > box.x
            && r.y < box.y + box.height && r.y + r.height > box.y;
        })
        .map(l => l.id);
      // Shift keeps whatever was already selected, matching the marquee tools' add convention.
      const next = additive ? [...new Set([...selectionIds, ...hits])] : hits;
      onSelectLayers?.(next);
      return;
    }
    if (activeTool === 'text' && textDragRef.current) {
      const start = textDragRef.current;
      textDragRef.current = null;
      const p = imageSpacePointer();
      const width = p ? Math.abs(p.x - start.x) : 0;
      // Below the threshold this was a click, not a drag — let handleStageClick
      // make point text instead.
      if (p && width >= 12) {
        textDragConsumedRef.current = true;
        onAddTextLayer(Math.min(start.x, p.x), Math.min(start.y, p.y), width);
      }
      return;
    }
    if (MARQUEE_TOOLS.has(activeTool)) {
      if (marqueeStartRef.current && combineModeRef.current !== 'replace' && image) {
        onSelectionChange(combineSelections(combineBaseRef.current, selection, combineModeRef.current, image.width, image.height));
      }
      marqueeStartRef.current = null;
      return;
    }
    if (LASSO_TOOLS.has(activeTool)) {
      if (lassoPointsRef.current && combineModeRef.current !== 'replace' && image) {
        onSelectionChange(combineSelections(combineBaseRef.current, selection, combineModeRef.current, image.width, image.height));
      }
      lassoPointsRef.current = null;
      return;
    }
    if (!isPaintTool) return;
    const p = imageSpacePointer();
    if (!p) return;
    paint.pointerUp(activeTool as Parameters<typeof paint.pointerUp>[0], p.x, p.y);
    redrawLayerNode(paintLayerIdRef.current);
    restoreAncestorCaches();
  };

  const commitPenPath = () => {
    if (penPoints.length < 2) { setPenPoints([]); return; }
    const canvas = getActivePaintCanvas();
    const ctx = canvas?.getContext('2d');
    const layerId = paintLayerIdRef.current;
    if (canvas && ctx && layerId) {
      const before = ctx.getImageData(0, 0, canvas.width, canvas.height);
      strokePenPath(ctx, penPoints, true, { fillColor: null, strokeColor: paintSettings.color, strokeWidth: Math.max(2, paintSettings.size / 6) }, selection);
      redrawLayerNode(layerId);
      onPaintStrokeEnd(layerId, before);
    }
    setPenPoints([]);
  };

  const commitLassoPolygon = () => {
    if (lassoPolyPoints.length > 2 && image) {
      const shape: Selection = { kind: 'polygon', points: lassoPolyPoints };
      onSelectionChange(combineModeRef.current === 'replace' ? shape : combineSelections(combineBaseRef.current, shape, combineModeRef.current, image.width, image.height));
    }
    setLassoPolyPoints([]);
  };

  const handleStageDblClick = () => {
    if (activeTool === 'pen') commitPenPath();
    if (activeTool === 'lasso-polygon') commitLassoPolygon();
    if (activeTool === 'crop') onCommitCrop?.();
  };

  const editingLayer = editingLayerId ? findLayer(layers, editingLayerId) ?? null : null;

  /**
   * The Select tool's drag-a-box-over-empty-canvas object marquee. Distinct from `selection`, which
   * is the *pixel* selection the paint tools clip to — this one picks layers.
   */
  const [objectMarquee, setObjectMarquee] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const objectMarqueeRef = useRef<{ x: number; y: number; additive: boolean } | null>(null);
  /**
   * A completed marquee drag still fires a trailing stage click, which would immediately clear the
   * selection the drag just made. Mirrors `textDragConsumedRef`'s handling of the same problem.
   */
  const objectMarqueeConsumedRef = useRef(false);

  /** Page-space bounds of a text layer's node, rotation included (Konva gives it to us). */
  const textLayerRect = (id: string) => {
    const node = textNodeRefs.current[id];
    const konvaLayer = node?.getLayer();
    // Relative to its Konva layer, which carries no transform of its own — so this comes back in
    // page coords rather than screen coords, and stays correct under pan/zoom.
    return node && konvaLayer ? node.getClientRect({ relativeTo: konvaLayer }) : null;
  };


  const reportSelection = useCallback((el: HTMLTextAreaElement) => {
    if (!editingLayerId) return;
    onTextSelectionChange?.({ layerId: editingLayerId, start: el.selectionStart, end: el.selectionEnd });
  }, [editingLayerId, onTextSelectionChange]);

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
  // Only the Pan tool drags the stage natively. The Select tool's drag is the object marquee
  // (Part E), so panning while it's active goes through the same Space-hold / middle-drag path
  // every other tool already uses.
  const draggable = activeTool === 'pan' && !spaceDown;
  const panning = panRef.current?.active || spaceDown;
  // Hide the OS cursor while a brush-sized tool is armed — the BrushCursor ring below
  // *is* the cursor, and showing both reads as a doubled pointer.
  const showBrushCursor = !panning && BRUSH_CURSOR_TOOLS.has(activeTool) && brushCursorPos !== null;
  const cursorClass = panning ? 'cursor-grab' : showBrushCursor ? 'cursor-none' : '';

  /**
   * Renders a layer list (bottom-to-top) as nested Konva Groups.
   *
   * `visible` and `listening` are set from each layer's *own* flags, not effective ones: Konva
   * already cascades both down a Group, so a hidden or locked group hides and deafens its whole
   * subtree for free. (`layerTree`'s `isEffectivelyVisible/Locked` exist for the consumers that
   * don't get that for free — the exporter, mainly.)
   */
  function renderLayerNodes(list: StudioLayer[]) {
    // Adjustments become wrappers around the layers beneath them before anything is drawn.
    return renderNodes(partitionAdjustments(list));
  }

  /**
   * Renders the render-tree produced by `partitionAdjustments`.
   *
   * Clip runs are formed here, *after* the adjustment partition, over the plain-layer nodes only:
   * an adjustment is not a clip base, and clipping to one is meaningless.
   */
  function renderNodes(nodes: RenderNode<StudioLayer>[]) {
    const out: ReactNode[] = [];
    let pending: StudioLayer[] = [];

    const flushClipRuns = () => {
      for (const run of groupClipRuns(pending)) {
        out.push(run.followers.length > 0 ? renderClipRun(run) : renderLeaf(run.base));
      }
      pending = [];
    };

    for (const node of nodes) {
      if (node.kind === 'adjustment') {
        flushClipRuns();
        out.push(renderAdjustmentWrapper(node.layer, node.children));
      } else {
        pending.push(node.layer);
      }
    }
    flushClipRuns();
    return out;
  }

  /**
   * A base layer plus the layers clipped to it, drawn as one **cached** unit:
   * `[base, ...followers, base again with destination-in]`.
   *
   * The trailing re-draw of the base trims the followers to the base's alpha. The cache is a
   * correctness requirement, not an optimisation: `destination-in` against the shared stage canvas
   * would erase everything already painted below it (see `needsIsolation`, which returns true for
   * any run with followers).
   *
   * Why not `source-atop` on each follower? It would occupy the follower's own
   * `globalCompositeOperation` slot, and a clipped **Multiply** layer is *the* standard manga
   * shading idiom — followers have to keep their own blend mode. The run's opacity/blend are the
   * base's, matching Photoshop, where the base drives the group.
   *
   * Only `clean-patch` bases (see `canBeClipBase`): the trim pass re-draws the base as a single
   * `KonvaImage`, and single-child is what makes an uncached `destination-in` behave. A text base
   * would re-draw its hit rect *and* its glyphs, and the per-child composite would wipe the run on
   * the first (transparent) child instead of trimming to the glyphs.
   */
  function renderClipRun(run: ClipRun<StudioLayer>) {
    const { base, followers } = run;
    if (!image) return null;
    const baseCanvas = getOrCreateCanvasFor(paintCanvasRegistry.current, base.id, image.width, image.height);
    return (
      <Group
        key={`clip-${base.id}`}
        ref={(node) => { layerNodeRefs.current[base.id] = node; }}
        visible={base.visible}
        opacity={base.opacity}
        globalCompositeOperation={BLEND_TO_COMPOSITE[base.blendMode]}
        listening={base.visible && !base.locked}
      >
        <KonvaImage image={baseCanvas} width={image.width} height={image.height} listening={false} />
        {followers.map((f) => renderLeaf(f))}
        <KonvaImage
          image={baseCanvas}
          width={image.width}
          height={image.height}
          listening={false}
          globalCompositeOperation="destination-in"
        />
      </Group>
    );
  }

  /**
   * An adjustment layer: a cached Group enclosing everything below it, with the adjustment's filter
   * hung off it. The cache is what gives `filters()` a rasterised subtree to run over — and it's why
   * this is "affects everything below in the stack" rather than "filter the background".
   *
   * The wrapper's own opacity stays 1; the adjustment's opacity lives inside the filter (see the
   * effect above), and its blend mode isn't representable here at all — `LayersPanel` hides that
   * control for adjustments rather than offering one that does nothing.
   */
  function renderAdjustmentWrapper(layer: StudioLayer, children: RenderNode<StudioLayer>[]) {
    return (
      <Group
        key={layer.id}
        ref={(node) => {
          adjustmentNodeRefs.current[layer.id] = node;
          layerNodeRefs.current[layer.id] = node;
        }}
        // Deliberately NOT `visible={layer.visible}`. This Group *contains* everything the
        // adjustment affects, background included, so hiding it would blank the page rather than
        // switch the adjustment off. Hiding is expressed by dropping the filter instead — see the
        // filter effect, which clears `filters()` for a hidden adjustment.
      >
        {renderNodes(children)}
      </Group>
    );
  }

  function renderLeaf(layer: StudioLayer) {
    return (
      <Group
        key={layer.id}
        ref={(node) => { layerNodeRefs.current[layer.id] = node; }}
        visible={layer.visible}
        opacity={layer.opacity}
        globalCompositeOperation={BLEND_TO_COMPOSITE[layer.blendMode]}
        listening={layer.visible && !layer.locked}
      >
        {layer.type === 'group' && renderLayerNodes(layer.children ?? [])}

        {layer.type === 'background' && image && (
          <>
            <KonvaImage ref={bgImageNodeRef} image={image} width={image.width} height={image.height} />
            {/* View Original sits directly above the page and below every real layer. It's inside
                the background's group, so an adjustment above it grades the overlay too — correct,
                since the overlay is a second view of the same page and grading only one would make
                the comparison meaningless. */}
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

        {layer.type === 'clean-patch' && image && (
          <KonvaImage
            image={getOrCreateCanvasFor(paintCanvasRegistry.current, layer.id, image.width, image.height)}
            width={image.width}
            height={image.height}
            listening={false}
          />
        )}

        {layer.type === 'text' && layer.text && (
          <TextLayerNode
            layer={layer}
            groupRef={(node) => { textNodeRefs.current[layer.id] = node; }}
            editing={layer.id === editingLayerId}
            selected={selectionIds.includes(layer.id) && activeTool === 'select'}
            draggable={activeTool === 'select' && !layer.locked}
            onSelect={(mode) => onSelectLayer(layer.id, mode)}
            onEdit={() => { onSelectLayer(layer.id); setEditingLayerId(layer.id); }}
            onUpdate={(patch) => onUpdateTextLayer(layer.id, patch)}
          />
        )}
      </Group>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`studio-canvas-bg relative w-full h-full overflow-hidden touch-none ${cursorClass}`}
      onPointerMove={(e) => {
        if (!BRUSH_CURSOR_TOOLS.has(activeTool)) return;
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        setBrushCursorPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      }}
      onPointerLeave={() => setBrushCursorPos(null)}
    >
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
          {/*
            ONE Konva Layer for the page and its whole stack. Konva `Layer`s are separate canvas
            elements and cannot nest, so a layer-per-StudioLayer could express neither groups nor a
            working blend mode (see `layerNodeRefs`). Sharing one canvas gives both, and makes the
            screen agree with `exportImage.ts`, which has always composited onto a single canvas.
          */}
          <Layer>
            {image && (
              <>
                {/* Page backing + drop shadow. Deliberately outside the layer tree: it isn't a
                    StudioLayer, and it must never end up inside a group's or adjustment's cache. */}
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
                {/* The whole stack, background included — the background is root index 0, so it has
                    to be inside the tree for an adjustment above it to enclose (and grade) it. */}
                {renderLayerNodes(layers)}
              </>
            )}
          </Layer>

          <Layer listening={false}>
            {/* Object marquee — solid accent fill, deliberately unlike the dashed white *pixel*
                selection, since the two mean different things (pick layers vs clip paint). */}
            {objectMarquee && (
              <Rect
                x={objectMarquee.x} y={objectMarquee.y}
                width={objectMarquee.width} height={objectMarquee.height}
                fill="rgba(56, 189, 248, 0.12)"
                stroke="#38bdf8"
                strokeWidth={1 / scale}
              />
            )}
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
            {queuedBubbleRects?.map((rect, i) => (
              <Rect key={i} x={rect.x} y={rect.y} width={rect.width} height={rect.height}
                stroke="#f59e0b" strokeWidth={1.5 / scale} dash={[4 / scale, 3 / scale]} />
            ))}
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

          {showGrid && image && (
            <Layer listening={false}>
              {Array.from({ length: Math.floor(image.width / GRID_SIZE) + 1 }, (_, i) => i * GRID_SIZE).map(x => (
                <Line key={`gx${x}`} points={[x, 0, x, image.height]} stroke="#00aaff" strokeWidth={1 / scale} opacity={0.35} />
              ))}
              {Array.from({ length: Math.floor(image.height / GRID_SIZE) + 1 }, (_, i) => i * GRID_SIZE).map(y => (
                <Line key={`gy${y}`} points={[0, y, image.width, y]} stroke="#00aaff" strokeWidth={1 / scale} opacity={0.35} />
              ))}
            </Layer>
          )}

          <Layer>
            <Transformer
              ref={transformerRef}
              rotateEnabled
              enabledAnchors={['top-left', 'top-center', 'top-right', 'middle-left', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right']}
              boundBoxFunc={(oldBox, newBox) => (newBox.width < 20 ? oldBox : newBox)}
            />
          </Layer>
        </Stage>
      )}
      {editingLayer?.text && (
        <textarea
          autoFocus
          value={editingLayer.text.content}
          onChange={(e) => {
            const prev = editingLayer.text!;
            // Runs are indexed against `content`, so any content change has to re-anchor them or
            // styled spans would slide off their characters as you type.
            onUpdateTextLayer(editingLayer.id, {
              content: e.target.value,
              runs: reflowRunsForContent(prev.content, e.target.value, prev.runs ?? []),
            });
            reportSelection(e.target);
          }}
          onSelect={(e) => reportSelection(e.currentTarget)}
          onKeyUp={(e) => reportSelection(e.currentTarget)}
          onMouseUp={(e) => reportSelection(e.currentTarget)}
          // Triple-click selects the whole item (Part D). The textarea sits above the stage once
          // editing starts, so the third click never reaches the Konva node — it has to be handled
          // here, not on the shape.
          onClick={(e) => { if (e.detail === 3) e.currentTarget.select(); reportSelection(e.currentTarget); }}
          onBlur={() => { setEditingLayerId(null); onTextSelectionChange?.(null); }}
          onKeyDown={(e) => { if (e.key === 'Escape') setEditingLayerId(null); }}
          className="absolute p-0 m-0 bg-black/20 border border-dashed border-white/50 outline-none resize-none overflow-hidden"
          style={{
            top: pos.y + editingLayer.text.y * scale,
            left: pos.x + editingLayer.text.x * scale,
            width: (editingLayer.text.autoWidth ? layoutText(editingLayer.text).width : editingLayer.text.width) * scale,
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
      {showBrushCursor && (
        <BrushCursor pos={brushCursorPos} scale={scale} settings={paintSettings} tool={activeTool} />
      )}
      {!page && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6">
          <ImageIcon size={28} className="text-white/25" strokeWidth={1.5} />
          <p className="text-title font-medium text-white/50">No page selected</p>
          <p className="text-ui text-white/30 max-w-xs">Pick a page from the Pages panel to start cleaning and typesetting.</p>
        </div>
      )}
      {showRulers && image && (
        <>
          <div className="absolute top-0 left-0 right-0 h-5 bg-black/60 border-b border-white/10 overflow-hidden pointer-events-none z-10" style={{ marginLeft: RULER_SIZE }}>
            {Array.from({ length: Math.floor(image.width / RULER_STEP) + 1 }, (_, i) => i * RULER_STEP).map(x => (
              <span key={x} className="absolute top-0 h-full flex items-center text-[9px] text-white/50 font-mono border-l border-white/20 pl-0.5"
                style={{ left: pos.x + x * scale }}>{x}</span>
            ))}
          </div>
          <div className="absolute top-0 left-0 bottom-0 w-5 bg-black/60 border-r border-white/10 overflow-hidden pointer-events-none z-10" style={{ marginTop: RULER_SIZE }}>
            {Array.from({ length: Math.floor(image.height / RULER_STEP) + 1 }, (_, i) => i * RULER_STEP).map(y => (
              <span key={y} className="absolute left-0 w-full text-[9px] text-white/50 font-mono border-t border-white/20 pt-0.5 text-center"
                style={{ top: pos.y + y * scale }}>{y}</span>
            ))}
          </div>
          <div className="absolute top-0 left-0 w-5 h-5 bg-black/70 z-20" />
        </>
      )}
      <div className="absolute bottom-3 right-3 px-2.5 py-1 rounded-control liquid-glass text-micro font-mono text-white/80">
        {Math.round(scale * 100)}%
      </div>
    </div>
  );
});

function loadImageFromSrc(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to decode image'));
    img.src = src;
  });
}

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
