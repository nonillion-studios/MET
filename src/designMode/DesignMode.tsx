import { useCallback, useEffect, useRef, useState } from 'react';
import { ToolRail } from '../components/studio/ToolRail';
import { useDesignModeStore } from './designModeStore';
import { DesignModeTopBar, type DesignExportFormat } from './DesignModeTopBar';
import { NewCanvasDialog } from './NewCanvasDialog';
import { DesignImageTabs } from './DesignImageTabs';
import { DesignCanvas, type DesignCanvasHandle } from './DesignCanvas';
import type { LayerSelectMode } from '../components/studio/studioTypes';

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
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasHandleRef = useRef<DesignCanvasHandle | null>(null);
  const addImageInputRef = useRef<HTMLInputElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeTool, setActiveTool] = useState('select');
  const [selectedLayerIds, setSelectedLayerIds] = useState<string[]>([]);
  const [zoomPercent, setZoomPercent] = useState(100);

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

  const handleExport = useCallback((_format: DesignExportFormat) => {
    // Wired in Section 9 (exportDesignImage.ts) — no-op until then.
  }, []);

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

  const handleUpdateLayers = useCallback((updater: Parameters<typeof store.updateImageLayers>[1]) => {
    if (store.activeImageId) store.updateImageLayers(store.activeImageId, updater);
  }, [store]);

  return (
    <div ref={rootRef} className="flex flex-col w-full h-full overflow-hidden bg-[var(--color-surface)]">
      <DesignModeTopBar
        activeImage={store.activeImage}
        hasUnsavedChanges={false}
        onRenameActiveImage={(name) => { if (store.activeImageId) store.renameImage(store.activeImageId, name); }}
        onNewCanvas={store.openNewCanvasDialog}
        onAddImage={() => addImageInputRef.current?.click()}
        onExport={handleExport}
        canUndo={false}
        canRedo={false}
        onUndo={() => {}}
        onRedo={() => {}}
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
