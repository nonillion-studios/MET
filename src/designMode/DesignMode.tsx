import { useCallback, useEffect, useRef, useState } from 'react';
import { ToolRail } from '../components/studio/ToolRail';
import { LayersPanel } from '../components/studio/LayersPanel';
import { createLayer, createAdjustmentLayer, type LayerSelectMode, type AdjustmentKind, type StudioLayer } from '../components/studio/studioTypes';
import { moveWithinParent } from '../components/studio/layerTree';
import { useDesignModeStore } from './designModeStore';
import { DesignModeTopBar, type DesignExportFormat } from './DesignModeTopBar';
import { NewCanvasDialog } from './NewCanvasDialog';
import { DesignImageTabs } from './DesignImageTabs';
import { DesignCanvas, type DesignCanvasHandle } from './DesignCanvas';
import { exportDesignImage } from './exportDesignImage';
import { useDesignHistory } from './useDesignHistory';
import { swalToast } from '../lib/swalTheme';

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
  const [selectedLayerIds, setSelectedLayerIds] = useState<string[]>([]);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [expandedLayerId, setExpandedLayerId] = useState<string | null>(null);

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

  // No persisted-image restore yet (that lands in Section 6, alongside the paint-canvas registry
  // needed to redraw raster content) — so "zero images" is true on every fresh mount for now, and
  // this fires every visit until then. Matches the spec literally either way: "Enter Design Mode
  // with no existing images. New Canvas dialog appears automatically."
  useEffect(() => {
    if (store.images.length === 0 && !store.showNewCanvasDialog) store.openNewCanvasDialog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clear stale selection when the active image changes — a layer id from a different image's tree
  // must never leak into the new image's selection/Transformer binding.
  useEffect(() => { setSelectedLayerIds([]); }, [store.activeImageId]);

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
  // canvas.
  const handleUpdateLayers = useCallback((updater: Parameters<typeof store.updateImageLayers>[1]) => {
    if (!store.activeImageId) return;
    if (store.activeImage) history.pushHistory(store.activeImageId, store.activeImage.layers);
    store.updateImageLayers(store.activeImageId, updater);
  }, [store, history]);

  const handleUndo = useCallback(() => {
    if (!store.activeImageId || !store.activeImage) return;
    const restored = history.undo(store.activeImageId, store.activeImage.layers);
    if (restored) store.updateImageLayers(store.activeImageId, () => restored);
  }, [store, history]);

  const handleRedo = useCallback(() => {
    if (!store.activeImageId || !store.activeImage) return;
    const restored = history.redo(store.activeImageId, store.activeImage.layers);
    if (restored) store.updateImageLayers(store.activeImageId, () => restored);
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

  return (
    <div ref={rootRef} className="flex flex-col w-full h-full overflow-hidden bg-[var(--color-surface)]">
      <DesignModeTopBar
        activeImage={store.activeImage}
        hasUnsavedChanges={false}
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
        onClose={store.removeImage}
        onNewCanvas={store.openNewCanvasDialog}
      />

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <ToolRail activeTool={activeTool} onToolChange={setActiveTool} orientation="vertical" />
        <DesignCanvas
          image={store.activeImage}
          activeTool={activeTool}
          selectedLayerIds={selectedLayerIds}
          onSelectLayer={handleSelectLayer}
          onUpdateLayers={handleUpdateLayers}
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
