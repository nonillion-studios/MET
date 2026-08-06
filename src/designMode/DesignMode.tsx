/**
 * Design Mode — a free-form, multi-canvas graphics view alongside the comic/manga Studio. Own state
 * (`designModeStore.ts`), own persistence (`design_<imageId>` idb-keyval keys), own undo history —
 * entirely independent of Studio's `layersByPage`/chapter/page state. See the studioTypes.ts
 * `StudioLayer` type: Design Mode reuses it directly for its own layers rather than introducing a
 * parallel layer type, which is what lets it reuse LayersPanel/TextLayerNode/PlacedImageLayerNode/the
 * compositor/the export functions as-is.
 */
export function DesignMode() {
  return (
    <div className="flex flex-col w-full h-full overflow-hidden">
      <div className="flex-1 flex items-center justify-center text-ink-muted text-sm">
        Design Mode
      </div>
    </div>
  );
}
