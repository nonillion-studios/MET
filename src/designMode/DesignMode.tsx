import { useCallback, useEffect, useRef, useState } from 'react';
import { ToolRail } from '../components/studio/ToolRail';
import { LayersPanel } from '../components/studio/LayersPanel';
import { createLayer, createAdjustmentLayer, type LayerSelectMode, type AdjustmentKind, type StudioLayer } from '../components/studio/studioTypes';
import { moveWithinParent } from '../components/studio/layerTree';
import { NO_SELECTION, type Selection } from '../components/studio/paint/selection';
import type { PaintSettings } from '../components/studio/paint/paintEngine';
import type { SerializedStudioLayer } from '../lib/studioProjectStore';
import { BUILTIN_BRUSHES } from '../lib/brushStore';
import { useDesignModeStore, type DesignImage } from './designModeStore';
import { DesignModeTopBar, type DesignExportFormat } from './DesignModeTopBar';
import { NewCanvasDialog } from './NewCanvasDialog';
import { DesignImageTabs } from './DesignImageTabs';
import { DesignCanvas, type DesignCanvasHandle } from './DesignCanvas';
import { DesignBrushOptionsBar } from './DesignBrushOptionsBar';
import { exportDesignImage } from './exportDesignImage';
import { useDesignHistory } from './useDesignHistory';
import { useDesignShortcuts } from './useDesignShortcuts';
import { loadAllDesignImageIds, loadDesignImage, saveDesignImage, deleteDesignImage } from './designModePersistence';
import { swalToast } from '../lib/swalTheme';

const SAVE_DEBOUNCE_MS = 1000;
const BRUSH_TOOLS = new Set(['brush', 'pencil', 'eraser']);
const DEFAULT_BRUSH = BUILTIN_BRUSHES[0];

/** Strips `raster`/`maskRaster` back off a loaded SerializedStudioLayer tree — the live `StudioLayer`
 *  the store holds carries no pixels of its own (those live in DesignCanvas's registry, restored
 *  separately via loadSerializedCanvases). Recurses into `children` since a placed PSD can produce
 *  real groups. */
function stripRaster(layers: SerializedStudioLayer[]): StudioLayer[] {
  return layers.map((l): StudioLayer => {
    const { raster: _r, maskRaster: _m, children, ...rest } = l;
    return { ...rest, ...(children ? { children: stripRaster(children) } : {}) } as StudioLayer;
  });
}

/** Flattens a layer tree for the raster-restore pass (loadSerializedCanvases doesn't need tree
 *  structure, just every layer that might carry a `raster`). */
function flattenForRaster(layers: SerializedStudioLayer[]): SerializedStudioLayer[] {
  return layers.flatMap(l => (l.children ? [l, ...flattenForRaster(l.children)] : [l]));
}

/**
 * Design Mode — a free-form, multi-canvas graphics view alongside the comic/manga Studio. Own state
 * (`designModeStore.ts`), own persistence (`design_<imageId>` idb-keyval keys), own undo history —
 * entirely independent of Studio's `layersByPage`/chapter/page state. See the studioTypes.ts
 * `StudioLayer` type: Design Mode reuses it directly for its own layers rather than introducing a
 * parallel layer type, which is what lets it reuse LayersPanel/TextLayerNode/PlacedImageLayerNode/the
 * compositor/the export functions as-is.
 */
export function DesignMode() {
  const store = useDesignModeStore();
  const history = useDesignHistory();
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasHandleRef = useRef<DesignCanvasHandle | null>(null);
  const addImageInputRef = useRef<HTMLInputElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeTool, setActiveTool] = useState('select');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [selectedLayerIds, setSelectedLayerIds] = useState<string[]>([]);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [expandedLayerId, setExpandedLayerId] = useState<string | null>(null);

  // Minimal brush settings — the fields with a control below. Everything else PaintSettings needs
  // comes from BUILTIN_BRUSHES[0] (Hard Round) as a fixed default; those fields are inert this
  // session since no tool Design Mode dispatches into usePaintLayer reads them (clone/heal/liquify/
  // background-eraser/magic-eraser/content-aware aren't wired up here).
  const [brushSize, setBrushSize] = useState(DEFAULT_BRUSH.size);
  const [brushColor, setBrushColor] = useState('#000000');
  const [brushHardness, setBrushHardness] = useState(DEFAULT_BRUSH.hardness);
  const [brushOpacity, setBrushOpacity] = useState(1);
  const [brushFlow, setBrushFlow] = useState(1);

  const paintSettings: PaintSettings = {
    size: brushSize, hardness: brushHardness, opacity: brushOpacity, flow: brushFlow,
    color: brushColor, bgColor: '#ffffff', tolerance: 32, liquifyMode: 'push', symmetry: 'none',
    spacing: DEFAULT_BRUSH.spacing, brushShape: DEFAULT_BRUSH.shape, angle: DEFAULT_BRUSH.angle,
    roundness: DEFAULT_BRUSH.roundness, scatter: DEFAULT_BRUSH.scatter, smoothing: DEFAULT_BRUSH.smoothing,
    pressureSize: DEFAULT_BRUSH.pressureSize, pressureOpacity: DEFAULT_BRUSH.pressureOpacity,
    contentAwareMode: 'proximity', sampleMode: 'current',
    backgroundEraserSampling: 'continuous', backgroundEraserLimits: 'contiguous', backgroundEraserProtectForeground: false,
    magicEraserAntiAlias: true, magicEraserContiguous: true, magicEraserSampleAllLayers: false, magicEraserOpacity: 1,
  };

  // Selection is wired for real in Phase 3 (store-backed, per-image); until then usePaintLayer still
  // requires both props, so a no-op stub keeps DesignCanvas's paint pipeline functional.
  const selection: Selection = NO_SELECTION;
  const handleSelectionChange = useCallback((_sel: Selection) => {}, []);

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      rootRef.current?.requestFullscreen().catch(() => {});
    }
  }, []);

  const handleExport = useCallback(async (format: DesignExportFormat) => {
    const snapshot = canvasHandleRef.current?.exportSnapshot();
    if (!snapshot || !store.activeImage) return;
    try {
      await exportDesignImage(snapshot, store.activeImage.name, format);
    } catch {
      swalToast({ icon: 'error', title: 'Export failed' });
    }
  }, [store.activeImage]);

  // ── Persistence ─────────────────────────────────────────────────────────────────────────────
  const [loadAttempted, setLoadAttempted] = useState(false);
  // Serialized (with raster) layers for each loaded image, consumed once that image first becomes
  // active — DesignCanvas can only draw pixels into a layer's registry canvas once it's rendered
  // that layer at least once (which happens when it's the active image), so this can't happen at
  // load time for every image up front.
  const pendingRasterRef = useRef<Map<string, SerializedStudioLayer[]>>(new Map());
  const pendingSaveFlushRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ids = await loadAllDesignImageIds();
      const loaded: DesignImage[] = [];
      for (const id of ids) {
        const data = await loadDesignImage(id);
        if (!data) continue;
        pendingRasterRef.current.set(id, flattenForRaster(data.layers));
        loaded.push({
          id: data.id, name: data.name, width: data.width, height: data.height,
          layers: stripRaster(data.layers), activeLayerId: null, thumbnail: data.thumbnail,
        });
      }
      if (cancelled) return;
      if (loaded.length > 0) {
        store.setImages(() => loaded);
        store.setActiveImageId(loaded[0].id);
      }
      setLoadAttempted(true);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-open New Canvas only once the load attempt above has actually run — otherwise every visit
  // would show the dialog for a flash before persisted images arrive, or (worse, before load ever
  // finishes) prompt to create a new canvas the user already has several of.
  useEffect(() => {
    if (loadAttempted && store.images.length === 0 && !store.showNewCanvasDialog) store.openNewCanvasDialog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadAttempted]);

  // Restore a freshly-loaded image's pixel content the first time it becomes active (i.e. once
  // DesignCanvas has actually rendered its layers and created their registry canvases to draw into).
  useEffect(() => {
    if (!store.activeImageId) return;
    const pending = pendingRasterRef.current.get(store.activeImageId);
    if (!pending) return;
    pendingRasterRef.current.delete(store.activeImageId);
    canvasHandleRef.current?.loadSerializedCanvases(pending);
  }, [store.activeImageId, store.activeImage]);

  // Debounced auto-save of the active image whenever it changes — mirrors the coalescing idea in
  // useDesignHistory.ts (many rapid edits settle into one save), and reuses the exact same
  // serializeForSave the export/undo paths already exercise.
  //
  // Split into two effects deliberately: this one re-runs (and its cleanup clears the *previous*
  // timer) on every edit, which is exactly the debounce behavior wanted — but if its cleanup also
  // flushed a save, that flush would fire on every single edit too (canvasHandleRef always reflects
  // the *latest* state regardless of which effect instance's closure calls it), defeating debouncing
  // entirely. The mount-only effect below is what actually guards against losing the last edit when
  // the user navigates away inside the debounce window.
  useEffect(() => {
    if (!store.activeImageId || !loadAttempted) return;
    const imageId = store.activeImageId;
    const flush = () => {
      const data = canvasHandleRef.current?.serializeForSave();
      // Only cleared once this specific save actually lands — a rejected save (network/idb failure)
      // never calls .then, so the dot correctly keeps showing "unsaved" rather than lying about it.
      if (data && data.id === imageId) void saveDesignImage(data).then(() => setHasUnsavedChanges(false));
    };
    pendingSaveFlushRef.current = flush;
    const timer = setTimeout(() => { flush(); pendingSaveFlushRef.current = null; }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [store.activeImage, store.activeImageId, loadAttempted]);

  // Fires exactly once, when DesignMode itself unmounts (nav away from the Design tab) — flushes
  // whatever save was still pending rather than silently dropping it.
  useEffect(() => {
    return () => { pendingSaveFlushRef.current?.(); };
  }, []);

  const handleCloseImage = useCallback((imageId: string) => {
    store.removeImage(imageId);
    void deleteDesignImage(imageId);
  }, [store]);

  // Clear stale selection when the active image changes — a layer id from a different image's tree
  // must never leak into the new image's selection/Transformer binding. Also resets the dirty flag,
  // so a previous image's unsaved-changes dot can't visually leak onto a newly-selected image; this
  // covers the initial-load case too, since the load effect's setActiveImageId fires this same effect.
  useEffect(() => { setSelectedLayerIds([]); setHasUnsavedChanges(false); }, [store.activeImageId]);

  const handleSelectLayer = useCallback((id: string | null, mode: LayerSelectMode = 'replace') => {
    setSelectedLayerIds(prev => {
      if (id === null) return [];
      if (mode === 'toggle') return prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      return [id];
    });
    if (id && store.activeImageId) store.setActiveLayerId(store.activeImageId, id);
  }, [store]);

  // The single choke point every layer mutation flows through — from LayersPanel's discrete
  // handlers below and from DesignCanvas's paint/text/drag/transform/place-image/duplicate calls
  // alike — so snapshotting for undo here covers all of them at once. pushHistory's own coalescing
  // window (see useDesignHistory.ts) collapses a paint stroke's or a typing burst's many rapid calls
  // into one undo step without needing separate gesture-start/end signals threaded through the
  // canvas. Also bundles a canvas-pixel snapshot alongside the layer array — paint/placed-image
  // pixels live out-of-band in DesignCanvas's own registry, so array-only undo would silently leave
  // a brush stroke's pixels in place.
  const handleUpdateLayers = useCallback((updater: Parameters<typeof store.updateImageLayers>[1]) => {
    if (!store.activeImageId) return;
    if (store.activeImage) {
      const canvases = canvasHandleRef.current?.snapshotCanvases() ?? {};
      history.pushHistory(store.activeImageId, store.activeImage.layers, canvases);
    }
    store.updateImageLayers(store.activeImageId, updater);
    setHasUnsavedChanges(true);
  }, [store, history]);

  const handleUndo = useCallback(() => {
    if (!store.activeImageId || !store.activeImage) return;
    const currentCanvases = canvasHandleRef.current?.snapshotCanvases() ?? {};
    const restored = history.undo(store.activeImageId, store.activeImage.layers, currentCanvases);
    if (restored) {
      store.updateImageLayers(store.activeImageId, () => restored.layers);
      canvasHandleRef.current?.restoreCanvases(restored.canvases);
      setHasUnsavedChanges(true);
    }
  }, [store, history]);

  const handleRedo = useCallback(() => {
    if (!store.activeImageId || !store.activeImage) return;
    const currentCanvases = canvasHandleRef.current?.snapshotCanvases() ?? {};
    const restored = history.redo(store.activeImageId, store.activeImage.layers, currentCanvases);
    if (restored) {
      store.updateImageLayers(store.activeImageId, () => restored.layers);
      canvasHandleRef.current?.restoreCanvases(restored.canvases);
      setHasUnsavedChanges(true);
    }
  }, [store, history]);

  const addLayer = useCallback((layer: StudioLayer) => {
    handleUpdateLayers(layers => [...layers, layer]);
    handleSelectLayer(layer.id, 'replace');
  }, [handleUpdateLayers, handleSelectLayer]);

  const handleAdd = useCallback(() => {
    addLayer(createLayer('clean-patch', `Layer ${(store.activeImage?.layers.length ?? 0) + 1}`));
  }, [addLayer, store.activeImage]);

  // Design Mode has no background-copy seeding step to skip (unlike Studio's handleAddLayer, which
  // copies the page image into new layers by default) — a plain new layer is already blank, so
  // Add and Alt-click-Add are the same action here.
  const handleAddBlank = handleAdd;

  const handleAddAdjustmentOfKind = useCallback((kind: AdjustmentKind) => {
    addLayer(createAdjustmentLayer(kind));
  }, [addLayer]);

  const handleToggleVisible = useCallback((id: string) => {
    handleUpdateLayers(layers => layers.map(l => (l.id === id ? { ...l, visible: !l.visible } : l)));
  }, [handleUpdateLayers]);

  const handleToggleLocked = useCallback((id: string) => {
    handleUpdateLayers(layers => layers.map(l => (l.id === id ? { ...l, locked: !l.locked } : l)));
  }, [handleUpdateLayers]);

  const handleOpacityChange = useCallback((id: string, opacity: number) => {
    handleUpdateLayers(layers => layers.map(l => (l.id === id ? { ...l, opacity } : l)));
  }, [handleUpdateLayers]);

  const handleBlendChange = useCallback((id: string, blendMode: StudioLayer['blendMode']) => {
    handleUpdateLayers(layers => layers.map(l => (l.id === id ? { ...l, blendMode } : l)));
  }, [handleUpdateLayers]);

  const handleRename = useCallback((id: string, name: string) => {
    handleUpdateLayers(layers => layers.map(l => (l.id === id ? { ...l, name } : l)));
  }, [handleUpdateLayers]);

  const handleDelete = useCallback((id: string) => {
    handleUpdateLayers(layers => layers.filter(l => l.id !== id));
    setSelectedLayerIds(prev => prev.filter(x => x !== id));
  }, [handleUpdateLayers]);

  const handleDeleteMany = useCallback((ids: string[]) => {
    const idSet = new Set(ids);
    handleUpdateLayers(layers => layers.filter(l => !idSet.has(l.id)));
    setSelectedLayerIds(prev => prev.filter(x => !idSet.has(x)));
  }, [handleUpdateLayers]);

  const handleMove = useCallback((id: string, direction: 'up' | 'down') => {
    handleUpdateLayers(layers => moveWithinParent(layers, id, direction));
  }, [handleUpdateLayers]);

  const handleDuplicate = useCallback((id: string) => {
    canvasHandleRef.current?.duplicateLayer(id);
  }, []);

  const handleConvertBackgroundToLayer = useCallback((name: string) => {
    handleUpdateLayers(layers => layers.map(l => (l.isBackground ? { ...l, isBackground: false, locked: false, name } : l)));
  }, [handleUpdateLayers]);

  useDesignShortcuts({
    onToolChange: setActiveTool,
    onUndo: handleUndo,
    onRedo: handleRedo,
    onNewCanvas: store.openNewCanvasDialog,
    onDuplicateActiveLayer: () => { if (store.activeImage?.activeLayerId) handleDuplicate(store.activeImage.activeLayerId); },
    onDeleteActiveLayer: () => { if (store.activeImage?.activeLayerId) handleDelete(store.activeImage.activeLayerId); },
    onZoomFit: () => canvasHandleRef.current?.fit(),
    onZoom100: () => canvasHandleRef.current?.zoomTo100(),
  });

  return (
    <div ref={rootRef} className="flex flex-col w-full h-full overflow-hidden bg-[var(--color-surface)]">
      <DesignModeTopBar
        activeImage={store.activeImage}
        hasUnsavedChanges={hasUnsavedChanges}
        onRenameActiveImage={(name) => { if (store.activeImageId) store.renameImage(store.activeImageId, name); }}
        onNewCanvas={store.openNewCanvasDialog}
        onAddImage={() => addImageInputRef.current?.click()}
        onExport={handleExport}
        canUndo={history.canUndo(store.activeImageId)}
        canRedo={history.canRedo(store.activeImageId)}
        onUndo={handleUndo}
        onRedo={handleRedo}
        zoomPercent={zoomPercent}
        onFitZoom={() => canvasHandleRef.current?.fit()}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
      />
      <DesignImageTabs
        images={store.images}
        activeImageId={store.activeImageId}
        onSelect={store.setActiveImageId}
        onRename={store.renameImage}
        onClose={handleCloseImage}
        onNewCanvas={store.openNewCanvasDialog}
      />

      {BRUSH_TOOLS.has(activeTool) && (
        <DesignBrushOptionsBar
          size={brushSize} onSizeChange={setBrushSize}
          color={brushColor} onColorChange={setBrushColor}
          hardness={brushHardness} onHardnessChange={setBrushHardness}
          opacity={brushOpacity} onOpacityChange={setBrushOpacity}
          flow={brushFlow} onFlowChange={setBrushFlow}
        />
      )}

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <ToolRail activeTool={activeTool} onToolChange={setActiveTool} orientation="vertical" />
        <DesignCanvas
          image={store.activeImage}
          activeTool={activeTool}
          selectedLayerIds={selectedLayerIds}
          onSelectLayer={handleSelectLayer}
          onUpdateLayers={handleUpdateLayers}
          paintSettings={paintSettings}
          selection={selection}
          onSelectionChange={handleSelectionChange}
          onZoomChange={setZoomPercent}
          onFillBackgroundConsumed={() => { if (store.activeImageId) store.clearPendingBackgroundFill(store.activeImageId); }}
          onRequestToolChange={setActiveTool}
          canvasHandleRef={canvasHandleRef}
        />
        {store.activeImage && (
          <div className="w-72 shrink-0 border-l border-hairline overflow-y-auto">
            <LayersPanel
              layers={store.activeImage.layers}
              activeLayerId={store.activeImage.activeLayerId}
              selectedLayerIds={selectedLayerIds}
              onSelect={handleSelectLayer}
              onToggleVisible={handleToggleVisible}
              onToggleLocked={handleToggleLocked}
              onOpacityChange={handleOpacityChange}
              onBlendChange={handleBlendChange}
              onAdd={handleAdd}
              onAddBlank={handleAddBlank}
              onAddAdjustmentOfKind={handleAddAdjustmentOfKind}
              onDuplicate={handleDuplicate}
              onDelete={handleDelete}
              onDeleteMany={handleDeleteMany}
              onRename={handleRename}
              onMove={handleMove}
              onConvertBackgroundToLayer={handleConvertBackgroundToLayer}
              expandedLayerId={expandedLayerId}
              onToggleExpanded={(id) => setExpandedLayerId(prev => (prev === id ? null : id))}
            />
          </div>
        )}
      </div>

      <input
        ref={addImageInputRef}
        type="file"
        accept=".jpg,.jpeg,.png,.webp,.gif,.svg,.psd,image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void canvasHandleRef.current?.placeImageFile(file);
          e.target.value = '';
        }}
      />

      <NewCanvasDialog
        open={store.showNewCanvasDialog}
        dismissible={store.images.length > 0}
        onCancel={store.closeNewCanvasDialog}
        onCreate={store.addImage}
      />
    </div>
  );
}
