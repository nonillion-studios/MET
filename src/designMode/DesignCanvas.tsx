import { useCallback, useEffect, useRef, useState } from 'react';
import { Stage, Layer as KonvaLayer, Image as KonvaImage, Transformer } from 'react-konva';
import type Konva from 'konva';
import type { StudioLayer, LayerSelectMode, TextLayerData } from '../components/studio/studioTypes';
import { createTextLayer } from '../components/studio/studioTypes';
import { TextLayerNode } from '../components/studio/TextLayerNode';
import { PlacedImageLayerNode } from '../components/studio/PlacedImageLayerNode';
import { layoutText } from '../components/studio/textLayout';
import { getOrCreateCanvasFor, clonePaintCanvas, type PaintCanvasRegistry } from '../components/studio/paint/paintCanvasRegistry';
import { cloneSubtree } from '../components/studio/layerTree';
import { screenToImage, imageToScreen, type CanvasViewport } from '../components/studio/canvasCoords';
import { useCanvasViewport } from '../components/studio/canvasViewport';
import { usePaintLayer } from '../components/studio/paint/usePaintLayer';
import type { PaintSettings } from '../components/studio/paint/paintEngine';
import type { Selection } from '../components/studio/paint/selection';
import type { SerializedStudioLayer } from '../lib/studioProjectStore';
import type { ExportSnapshot } from '../components/studio/StudioCanvas';
import type { DesignImage } from './designModeStore';
import type { CanvasSnapshots } from './useDesignHistory';
import { DESIGN_SCHEMA_VERSION, type DesignImageData } from './designModePersistence';
import { placeRasterImageFile, placePsdFile } from './placeImage';

export interface DesignCanvasHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  zoomTo100: () => void;
  getZoom: () => number;
  placeImageFile: (file: File) => Promise<void>;
  duplicateLayer: (layerId: string) => void;
  exportSnapshot: () => ExportSnapshot | null;
  /** Dumps every registry canvas currently keyed to a layer in the active image, as data URLs — for
   *  bundling into a history entry (see useDesignHistory's CanvasSnapshots). Paint/placed-image
   *  pixels live outside the StudioLayer array entirely, so undo/redo need this alongside the array
   *  snapshot or a brush stroke's pixels would never actually revert. */
  snapshotCanvases: () => CanvasSnapshots;
  /** Redraws each layer's registry canvas from a previously-captured snapshot and repaints it. */
  restoreCanvases: (snapshots: CanvasSnapshots) => void;
  /** Builds the persisted-to-IndexedDB shape (designModePersistence.ts's DesignImageData) for the
   *  active image, rasters included. */
  serializeForSave: () => DesignImageData | null;
  /** Draws a loaded image's `raster` fields into fresh registry canvases — the load-time
   *  counterpart, called once when a persisted image first becomes active. */
  loadSerializedCanvases: (layers: SerializedStudioLayer[]) => void;
}

interface DesignCanvasProps {
  image: DesignImage | null;
  activeTool: string;
  selectedLayerIds: string[];
  onSelectLayer: (id: string | null, mode?: LayerSelectMode) => void;
  onUpdateLayers: (updater: (layers: StudioLayer[]) => StudioLayer[]) => void;
  paintSettings: PaintSettings;
  selection: Selection;
  onSelectionChange: (sel: Selection) => void;
  onZoomChange?: (percent: number) => void;
  onFillBackgroundConsumed?: () => void;
  onRequestToolChange?: (tool: string) => void;
  canvasHandleRef?: React.MutableRefObject<DesignCanvasHandle | null>;
}

/**
 * Design Mode's own Konva Stage. Reuses TextLayerNode/PlacedImageLayerNode as-is (both are already
 * fully generic, no Studio-specific coupling) for rendering + the shared Transformer pattern for
 * Free Transform, and Studio's own canvasCoords.ts (screenToImage/imageToScreen) for pan/zoom pointer
 * math. Owns its own paint-canvas registry (paint layer + placed-image pixels live out-of-band, via
 * Studio's own generic paintCanvasRegistry.ts helpers) since that registry doesn't exist anywhere
 * else for Design Mode to share.
 *
 * Implements the "focused subset" of tools this pass: Select/Move, Free Transform (automatic on
 * selecting text/placed-image, matching Studio), Text, and Brush/Pencil/Eraser via Studio's real
 * `usePaintLayer`/`paintEngine.ts` (same stamp/flow/opacity engine Studio's own brush uses, not a
 * hand-rolled `ctx.stroke()`). Marquee/lasso/gradient/crop/eyedropper/clone/healing are not
 * implemented — selecting one of those tools from the (reused, unforked) ToolRail simply has no
 * effect on this canvas.
 */
export function DesignCanvas({
  image, activeTool, selectedLayerIds, onSelectLayer, onUpdateLayers, paintSettings, selection, onSelectionChange,
  onZoomChange, onFillBackgroundConsumed, onRequestToolChange, canvasHandleRef,
}: DesignCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const textNodeRefs = useRef<Record<string, Konva.Group | null>>({});
  const placedImageNodeRefs = useRef<Record<string, Konva.Image | null>>({});
  const paintNodeRefs = useRef<Record<string, Konva.Image | null>>({});
  const paintRegistry = useRef<PaintCanvasRegistry>({});

  const canvasViewport = useCanvasViewport({ minScale: 0.05, maxScale: 8 });
  const { scale, pos, spaceDown, isPanning, startPan } = canvasViewport;
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const isPaintingRef = useRef(false);
  const textClickPendingRef = useRef(false);

  const viewport: CanvasViewport = { scale, pos };

  // ── Container sizing ────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      setContainerSize({ width: el.clientWidth, height: el.clientHeight });
    });
    observer.observe(el);
    setContainerSize({ width: el.clientWidth, height: el.clientHeight });
    return () => observer.disconnect();
  }, []);

  // ── Fit-to-screen whenever the active image changes ────────────────────────────────────────────
  const fit = useCallback(() => {
    if (!image) return;
    canvasViewport.fit(image.width, image.height, containerSize, { padding: 40 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, containerSize]);

  useEffect(() => { fit(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [image?.id, containerSize.width, containerSize.height]);

  useEffect(() => { onZoomChange?.(scale * 100); }, [scale, onZoomChange]);

  // ── Free Transform: bind the shared Transformer to selected text/placed-image nodes ───────────
  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) return;
    const nodes: Konva.Node[] = activeTool === 'select' && !editingLayerId
      ? selectedLayerIds.flatMap((id): Konva.Node[] => {
          const textNode = textNodeRefs.current[id];
          const placedImageNode = placedImageNodeRefs.current[id];
          return textNode ? [textNode] : placedImageNode ? [placedImageNode] : [];
        })
      : [];
    transformer.nodes(nodes);
    transformer.getLayer()?.batchDraw();
  }, [selectedLayerIds, activeTool, editingLayerId, image?.layers]);

  // ── Background fill (from the New Canvas dialog's white/black choice) ─────────────────────────
  useEffect(() => {
    if (!image?.pendingBackgroundFill) return;
    const bgLayer = image.layers.find(l => l.isBackground);
    if (!bgLayer) { onFillBackgroundConsumed?.(); return; }
    const canvas = getOrCreateCanvasFor(paintRegistry.current, bgLayer.id, image.width, image.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = image.pendingBackgroundFill === 'white' ? '#ffffff' : '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    paintNodeRefs.current[bgLayer.id]?.getLayer()?.batchDraw();
    onFillBackgroundConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image?.id, image?.pendingBackgroundFill]);

  // ── Brush / Pencil / Eraser — Studio's real paint engine, not a hand-rolled ctx.stroke() ────────
  const getPaintCanvas = useCallback((): HTMLCanvasElement | null => {
    if (!image?.activeLayerId) return null;
    const layer = image.layers.find(l => l.id === image.activeLayerId);
    if (!layer || layer.type !== 'clean-patch' || layer.locked) return null;
    return getOrCreateCanvasFor(paintRegistry.current, layer.id, image.width, image.height);
  }, [image]);

  const redrawActiveLayer = useCallback(() => {
    if (image?.activeLayerId) paintNodeRefs.current[image.activeLayerId]?.getLayer()?.batchDraw();
  }, [image?.activeLayerId]);

  const paint = usePaintLayer({
    getCanvas: getPaintCanvas,
    settings: paintSettings,
    selection,
    onSelectionChange,
    // Konva only repaints a node when told to — without this, a click-no-drag stamp (pointerDown
    // immediately followed by pointerUp, no pointerMove between) would mutate the canvas's pixels
    // but never redraw the node until an unrelated re-render. History needs no hook here: the
    // identity onUpdateLayers dispatch below (still fired at pointer-down, before paint.pointerDown)
    // already captures the pre-stroke snapshot via useDesignHistory's coalescing window.
    onStrokeEnd: () => { redrawActiveLayer(); },
  });

  // ── Add Image (placed-image Smart Object, or PSD-as-layers) ────────────────────────────────────
  const handlePlaceImageFile = useCallback(async (file: File) => {
    if (!image) return;
    if (file.name.toLowerCase().endsWith('.psd')) {
      const { layers, rasters } = await placePsdFile(file, image.width, image.height);
      for (const r of rasters) {
        const canvas = getOrCreateCanvasFor(paintRegistry.current, r.layerId, image.width, image.height);
        canvas.getContext('2d')!.drawImage(r.canvas, r.left, r.top);
      }
      onUpdateLayers(prev => [...prev, ...layers]);
      const last = layers[layers.length - 1];
      if (last) { onSelectLayer(last.id, 'replace'); }
      onRequestToolChange?.('select');
      return;
    }
    const { layer, image: img } = await placeRasterImageFile(file, image.width, image.height);
    const canvas = getOrCreateCanvasFor(paintRegistry.current, layer.id, layer.placedImage!.naturalWidth, layer.placedImage!.naturalHeight);
    canvas.getContext('2d')!.drawImage(img, 0, 0);
    onUpdateLayers(prev => [...prev, layer]);
    onSelectLayer(layer.id, 'replace');
    onRequestToolChange?.('select');
  }, [image, onUpdateLayers, onSelectLayer, onRequestToolChange]);

  // ── Duplicate ───────────────────────────────────────────────────────────────────────────────
  // Layer array mutation alone (cloneSubtree) isn't enough — pixel-backed layers (paint/placed-image)
  // need their registry canvas cloned too, via clonePaintCanvas, or the copy starts out blank.
  const duplicateLayer = useCallback((layerId: string) => {
    if (!image) return;
    const source = image.layers.find(l => l.id === layerId);
    if (!source) return;
    const { copy, idMap } = cloneSubtree(source);
    for (const [fromId, toId] of idMap) clonePaintCanvas(paintRegistry.current, fromId, toId);
    onUpdateLayers(prev => {
      const i = prev.findIndex(l => l.id === layerId);
      return i === -1 ? [...prev, copy] : [...prev.slice(0, i + 1), copy, ...prev.slice(i + 1)];
    });
    onSelectLayer(copy.id, 'replace');
  }, [image, onUpdateLayers, onSelectLayer]);

  // ── Export ──────────────────────────────────────────────────────────────────────────────────
  // Builds an ExportSnapshot the existing compositeFlattenedImage/exportPsd (lib/exportImage.ts,
  // lib/exportPsd.ts) can consume directly — text layers pass through untouched (the exporter
  // rasterizes them itself via drawTextLayer/layoutText), paint + placed-image layers get their
  // registry canvas serialized to a data URL, matching exactly how StudioCanvas.tsx's own
  // getSnapshot builds the same shape for Studio's export.
  // Shared by exportSnapshot and serializeForSave: attaches each layer's registry canvas (if any)
  // as a data URL, matching StudioCanvas.tsx's own getSnapshot serialization exactly.
  const serializeLayers = useCallback((): SerializedStudioLayer[] => {
    if (!image) return [];
    return image.layers.map((layer): SerializedStudioLayer => {
      const canvas = paintRegistry.current[layer.id];
      return canvas ? { ...layer, raster: canvas.toDataURL('image/png') } : layer;
    });
  }, [image]);

  const exportSnapshot = useCallback((): ExportSnapshot | null => {
    if (!image) return null;
    // No separate "page background image" concept in Design Mode (unlike Studio, whose background
    // is always a real imported page) — a transparent 1x1 stand-in satisfies the required field
    // without visually contributing anything; it's only ever drawn for a leaf of type 'background',
    // which Design Mode's layer set never contains (its own background is a locked clean-patch
    // layer, already included in `layers` below).
    const transparent = document.createElement('canvas');
    transparent.width = 1;
    transparent.height = 1;
    return { width: image.width, height: image.height, backgroundDataUrl: transparent.toDataURL('image/png'), layers: serializeLayers() };
  }, [image, serializeLayers]);

  const serializeForSave = useCallback((): DesignImageData | null => {
    if (!image) return null;
    return {
      schemaVersion: DESIGN_SCHEMA_VERSION,
      id: image.id,
      name: image.name,
      width: image.width,
      height: image.height,
      layers: serializeLayers(),
      thumbnail: image.thumbnail,
      updatedAt: new Date().toISOString(),
    };
  }, [image, serializeLayers]);

  /** Draws every layer's `raster` data URL (from a loaded DesignImageData) into a fresh registry
   *  canvas — the load-time counterpart to serializeForSave, used once on mount to restore a
   *  persisted image's pixel content before it's ever shown. */
  const loadSerializedCanvases = useCallback((layers: SerializedStudioLayer[]) => {
    for (const layer of layers) {
      if (!layer.raster) continue;
      const dims = layer.type === 'placed-image' && layer.placedImage
        ? { w: layer.placedImage.naturalWidth, h: layer.placedImage.naturalHeight }
        : image ? { w: image.width, h: image.height } : null;
      if (!dims) continue;
      const canvas = getOrCreateCanvasFor(paintRegistry.current, layer.id, dims.w, dims.h);
      const img = new Image();
      img.onload = () => {
        canvas.getContext('2d')!.drawImage(img, 0, 0);
        paintNodeRefs.current[layer.id]?.getLayer()?.batchDraw();
        placedImageNodeRefs.current[layer.id]?.getLayer()?.batchDraw();
      };
      img.src = layer.raster;
    }
  }, [image]);

  // ── Canvas snapshot/restore (for undo/redo of pixel content — see useDesignHistory.ts) ─────────
  const snapshotCanvases = useCallback((): CanvasSnapshots => {
    const out: CanvasSnapshots = {};
    for (const [layerId, canvas] of Object.entries(paintRegistry.current)) {
      if (canvas) out[layerId] = canvas.toDataURL('image/png');
    }
    return out;
  }, []);

  const restoreCanvases = useCallback((snapshots: CanvasSnapshots) => {
    for (const [layerId, dataUrl] of Object.entries(snapshots)) {
      const canvas = paintRegistry.current[layerId];
      if (!canvas) continue; // layer no longer exists (e.g. this snapshot predates its deletion)
      const img = new Image();
      img.onload = () => {
        const ctx = canvas.getContext('2d')!;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        paintNodeRefs.current[layerId]?.getLayer()?.batchDraw();
        placedImageNodeRefs.current[layerId]?.getLayer()?.batchDraw();
      };
      img.src = dataUrl;
    }
  }, []);

  useEffect(() => {
    if (!canvasHandleRef) return;
    canvasHandleRef.current = {
      zoomIn: () => canvasViewport.zoomIn(containerSize),
      zoomOut: () => canvasViewport.zoomOut(containerSize),
      fit,
      zoomTo100: () => canvasViewport.zoomTo100(containerSize),
      getZoom: () => scale,
      placeImageFile: handlePlaceImageFile,
      duplicateLayer,
      exportSnapshot,
      snapshotCanvases,
      restoreCanvases,
      serializeForSave,
      loadSerializedCanvases,
    };
  }, [
    canvasHandleRef, fit, scale, containerSize, canvasViewport, handlePlaceImageFile, duplicateLayer, exportSnapshot,
    snapshotCanvases, restoreCanvases, serializeForSave, loadSerializedCanvases,
  ]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/') || f.name.toLowerCase().endsWith('.psd'));
    for (const file of files) void handlePlaceImageFile(file);
  }, [handlePlaceImageFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault();
  }, []);

  const isPaintTool = activeTool === 'brush' || activeTool === 'pencil' || activeTool === 'eraser';
  const paintTool = () => activeTool as 'brush' | 'pencil' | 'eraser';
  const pointerPressure = (evt: PointerEvent) => (evt.pointerType === 'pen' ? evt.pressure || 0.5 : 1);

  const handleStagePointerDown = useCallback((e: Konva.KonvaEventObject<PointerEvent>) => {
    if (spaceDown) {
      startPan(e.evt.clientX, e.evt.clientY);
      return;
    }
    if (activeTool === 'text') {
      // Text layer creation itself happens on pointerUP, not here — creating it (and focusing its
      // editing textarea) on pointerDOWN loses the race against the browser's own native default
      // action for mousedown, which blurs whatever's focused when the pressed target isn't
      // focusable (the Konva canvas isn't). Studio's own StudioCanvas.tsx text tool has the exact
      // same split for the exact same reason (stash on down, create on up) — mirrored here.
      const targetClass = e.target.getClassName?.();
      const onEmpty = e.target === e.target.getStage() || targetClass === 'Image';
      if (!onEmpty || !image) return;
      textClickPendingRef.current = true;
      return;
    }
    if (isPaintTool && image) {
      const targetClass = e.target.getClassName?.();
      const onImage = e.target === e.target.getStage() || targetClass === 'Image';
      if (!onImage) return;
      const stage = stageRef.current;
      const pointer = stage?.getPointerPosition();
      if (!pointer) return;
      isPaintingRef.current = true;
      // Paint strokes mutate the registry canvas directly and never touch the layers array, so
      // without this the history push in onUpdateLayers would never fire for a stroke at all — an
      // identity update is enough to trigger it (and its accompanying canvas snapshot) once, here,
      // at stroke start; the coalescing window in useDesignHistory.ts absorbs the fact that this
      // fires on every pointerdown regardless of how far apart strokes are, same as every other call
      // site.
      onUpdateLayers(layers => layers);
      const imgPoint = screenToImage(pointer.x, pointer.y, viewport);
      paint.pointerDown(paintTool(), imgPoint.x, imgPoint.y, e.evt.altKey, pointerPressure(e.evt));
      return;
    }
    if (activeTool === 'select') {
      const targetClass = e.target.getClassName?.();
      const onEmpty = e.target === e.target.getStage() || targetClass === 'Image';
      if (onEmpty) onSelectLayer(null);
    }
  }, [spaceDown, startPan, activeTool, image, viewport, onUpdateLayers, onSelectLayer, isPaintTool, paint]);

  const handleStagePointerMove = useCallback((e: Konva.KonvaEventObject<PointerEvent>) => {
    if (isPanning()) return;
    if (isPaintingRef.current && isPaintTool) {
      const stage = stageRef.current;
      const pointer = stage?.getPointerPosition();
      if (!pointer) return;
      const imgPoint = screenToImage(pointer.x, pointer.y, viewport);
      paint.pointerMove(paintTool(), imgPoint.x, imgPoint.y, pointerPressure(e.evt));
      redrawActiveLayer();
    }
  }, [isPanning, viewport, isPaintTool, paint, redrawActiveLayer]);

  const handleStagePointerUp = useCallback(() => {
    if (isPaintingRef.current) {
      isPaintingRef.current = false;
      const stage = stageRef.current;
      const pointer = stage?.getPointerPosition();
      if (pointer) {
        const imgPoint = screenToImage(pointer.x, pointer.y, viewport);
        paint.pointerUp(paintTool(), imgPoint.x, imgPoint.y);
      }
    }
    if (textClickPendingRef.current) {
      textClickPendingRef.current = false;
      if (image) {
        const stage = stageRef.current;
        const pointer = stage?.getPointerPosition();
        if (pointer) {
          const imgPoint = screenToImage(pointer.x, pointer.y, viewport);
          const layer = createTextLayer(imgPoint.x, imgPoint.y);
          onUpdateLayers(layers => [...layers, layer]);
          onSelectLayer(layer.id, 'replace');
          setEditingLayerId(layer.id);
        }
      }
    }
  }, [image, viewport, onUpdateLayers, onSelectLayer, paint]);

  const updateLayerPatch = useCallback((layerId: string, patch: Partial<StudioLayer>) => {
    onUpdateLayers(layers => layers.map(l => (l.id === layerId ? { ...l, ...patch } : l)));
  }, [onUpdateLayers]);

  const updateTextLayer = useCallback((layerId: string, patch: Partial<TextLayerData>) => {
    onUpdateLayers(layers => layers.map(l => (l.id === layerId && l.type === 'text' && l.text ? { ...l, text: { ...l.text, ...patch } } : l)));
  }, [onUpdateLayers]);

  const editingLayer = editingLayerId ? image?.layers.find(l => l.id === editingLayerId) ?? null : null;
  const editingTextScreenPos = editingLayer?.text ? imageToScreen(editingLayer.text.x, editingLayer.text.y, viewport) : null;

  const cursorClass = spaceDown ? 'cursor-grab' : activeTool === 'text' ? 'cursor-text' : isPaintTool ? 'cursor-crosshair' : 'cursor-default';

  return (
    <div
      ref={containerRef}
      className={`relative flex-1 min-w-0 min-h-0 overflow-hidden bg-[#e5e7eb] dark:bg-[#151515] ${cursorClass}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      {image && containerSize.width > 0 && (
        <>
          <div
            className="absolute pointer-events-none"
            style={{
              left: pos.x, top: pos.y, width: image.width * scale, height: image.height * scale,
              backgroundImage: 'linear-gradient(45deg, #9ca3af 25%, transparent 25%), linear-gradient(-45deg, #9ca3af 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #9ca3af 75%), linear-gradient(-45deg, transparent 75%, #9ca3af 75%)',
              backgroundSize: '16px 16px',
              backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0',
              boxShadow: '0 4px 24px rgba(0,0,0,0.25)',
            }}
          />
          <Stage
            ref={stageRef}
            width={containerSize.width}
            height={containerSize.height}
            scaleX={scale}
            scaleY={scale}
            x={pos.x}
            y={pos.y}
            onWheel={canvasViewport.handleWheel}
            onPointerDown={handleStagePointerDown}
            onPointerMove={handleStagePointerMove}
            onPointerUp={handleStagePointerUp}
          >
            <KonvaLayer>
              {image.layers.map(layer => {
                if (!layer.visible) return null;
                if (layer.type === 'text' && layer.text) {
                  return (
                    <TextLayerNode
                      key={layer.id}
                      layer={layer}
                      groupRef={(node) => { textNodeRefs.current[layer.id] = node; }}
                      editing={layer.id === editingLayerId}
                      selected={selectedLayerIds.includes(layer.id)}
                      draggable={activeTool === 'select' && !layer.locked}
                      onSelect={(mode) => onSelectLayer(layer.id, mode)}
                      onEdit={() => setEditingLayerId(layer.id)}
                      onUpdate={(patch) => updateTextLayer(layer.id, patch)}
                      scale={scale}
                    />
                  );
                }
                if (layer.type === 'placed-image' && layer.placedImage) {
                  const canvas = getOrCreateCanvasFor(paintRegistry.current, layer.id, layer.placedImage.naturalWidth, layer.placedImage.naturalHeight);
                  return (
                    <PlacedImageLayerNode
                      key={layer.id}
                      data={layer.placedImage}
                      canvas={canvas}
                      nodeRef={(node) => { placedImageNodeRefs.current[layer.id] = node; }}
                      draggable={activeTool === 'select' && !layer.locked}
                      onSelect={(mode) => onSelectLayer(layer.id, mode)}
                      onUpdate={(patch) => updateLayerPatch(layer.id, { placedImage: { ...layer.placedImage!, ...patch } })}
                    />
                  );
                }
                if (layer.type === 'clean-patch') {
                  const canvas = getOrCreateCanvasFor(paintRegistry.current, layer.id, image.width, image.height);
                  return (
                    <KonvaImage
                      key={layer.id}
                      ref={(node) => { paintNodeRefs.current[layer.id] = node; }}
                      image={canvas}
                      width={image.width}
                      height={image.height}
                      opacity={layer.opacity}
                      listening={false}
                    />
                  );
                }
                return null;
              })}
              <Transformer
                ref={transformerRef}
                keepRatio={false}
                rotateEnabled
                anchorSize={9}
                borderStroke="#38bdf8"
                anchorStroke="#38bdf8"
                anchorFill="#ffffff"
              />
            </KonvaLayer>
          </Stage>

          {editingLayer?.text && editingTextScreenPos && (
            <textarea
              autoFocus
              value={editingLayer.text.content}
              onChange={(e) => updateTextLayer(editingLayer.id, { content: e.target.value })}
              onBlur={() => setEditingLayerId(null)}
              onKeyDown={(e) => { if (e.key === 'Escape') setEditingLayerId(null); }}
              className="absolute p-0 m-0 bg-black/20 border border-dashed border-white/50 outline-none resize-none overflow-hidden"
              style={{
                top: editingTextScreenPos.y,
                left: editingTextScreenPos.x,
                width: editingLayer.text.autoWidth ? Math.max(40, layoutText(editingLayer.text).width) : editingLayer.text.width,
                fontSize: editingLayer.text.fontSize,
                fontFamily: editingLayer.text.fontFamily,
                fontWeight: editingLayer.text.bold ? 'bold' : 'normal',
                fontStyle: editingLayer.text.italic ? 'italic' : 'normal',
                lineHeight: editingLayer.text.lineHeight,
                color: editingLayer.text.color,
                textAlign: editingLayer.text.align,
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
                zIndex: 20,
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
