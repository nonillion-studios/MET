import { useCallback, useEffect, useRef, useState } from 'react';
import { useDesignModeStore } from './designModeStore';
import { DesignModeTopBar, type DesignExportFormat } from './DesignModeTopBar';

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
  const [isFullscreen, setIsFullscreen] = useState(false);

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

  return (
    <div ref={rootRef} className="flex flex-col w-full h-full overflow-hidden bg-[var(--color-surface)]">
      <DesignModeTopBar
        activeImage={store.activeImage}
        hasUnsavedChanges={false}
        onRenameActiveImage={(name) => { if (store.activeImageId) store.renameImage(store.activeImageId, name); }}
        onNewCanvas={store.openNewCanvasDialog}
        onAddImage={() => {}}
        onExport={handleExport}
        canUndo={false}
        canRedo={false}
        onUndo={() => {}}
        onRedo={() => {}}
        zoomPercent={100}
        onFitZoom={() => {}}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
      />
      <div className="flex-1 flex items-center justify-center text-ink-muted text-sm" data-testid="design-mode-placeholder">
        Design Mode {store.images.length > 0 ? `— ${store.images.length} image(s)` : '(no images yet)'}
      </div>
    </div>
  );
}
