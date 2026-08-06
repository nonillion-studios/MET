import { useCallback, useState } from 'react';
import type { StudioLayer } from '../components/studio/studioTypes';

/**
 * Design Mode reuses `StudioLayer` directly as its layer type (rather than a parallel `DesignLayer`
 * type) — this is what lets it reuse `LayersPanel`, `TextLayerNode`, `PlacedImageLayerNode`,
 * `createLayer`/`createPlacedImageLayer`/`createTextLayer`, `cloneSubtree`, the compositor, and the
 * export functions as-is, with zero adaptation.
 */
export interface DesignImage {
  id: string;
  name: string;
  width: number;
  height: number;
  layers: StudioLayer[];
  activeLayerId: string | null;
  /** Data URL, refreshed after canvas changes — drives the image tab's own thumbnail (Section 5). */
  thumbnail: string;
}

export interface DesignModeState {
  images: DesignImage[];
  activeImageId: string | null;
  showNewCanvasDialog: boolean;
}

export interface UseDesignModeStore {
  images: DesignImage[];
  activeImageId: string | null;
  activeImage: DesignImage | null;
  showNewCanvasDialog: boolean;
  setImages: (updater: (images: DesignImage[]) => DesignImage[]) => void;
  addImage: (image: DesignImage) => void;
  removeImage: (imageId: string) => void;
  renameImage: (imageId: string, name: string) => void;
  setActiveImageId: (imageId: string | null) => void;
  updateImageLayers: (imageId: string, updater: (layers: StudioLayer[]) => StudioLayer[]) => void;
  setActiveLayerId: (imageId: string, layerId: string | null) => void;
  setThumbnail: (imageId: string, thumbnail: string) => void;
  openNewCanvasDialog: () => void;
  closeNewCanvasDialog: () => void;
}

/**
 * In-memory Design Mode state — a plain `useState` hook, matching how Studio's own `layersByPage`
 * state is managed (no Zustand/Context in this codebase for layer data). Completely independent of
 * Studio's state: nothing here is read or written by `Studio.tsx`.
 *
 * Persistence (`designModePersistence.ts`) and raster-canvas serialization are wired in by
 * `DesignCanvas.tsx` (Section 6), which is the only place that actually owns the paint-canvas
 * registry backing `'clean-patch'`/`'placed-image'` layer pixels — this hook only holds the reactive
 * layer tree shape, exactly as `layersByPage` does for Studio.
 */
export function useDesignModeStore(): UseDesignModeStore {
  const [state, setState] = useState<DesignModeState>({
    images: [],
    activeImageId: null,
    showNewCanvasDialog: false,
  });

  const setImages = useCallback((updater: (images: DesignImage[]) => DesignImage[]) => {
    setState(prev => ({ ...prev, images: updater(prev.images) }));
  }, []);

  const addImage = useCallback((image: DesignImage) => {
    setState(prev => ({ ...prev, images: [...prev.images, image], activeImageId: image.id, showNewCanvasDialog: false }));
  }, []);

  const removeImage = useCallback((imageId: string) => {
    setState(prev => {
      const images = prev.images.filter(img => img.id !== imageId);
      const activeImageId = prev.activeImageId === imageId
        ? (images[images.length - 1]?.id ?? null)
        : prev.activeImageId;
      return { ...prev, images, activeImageId };
    });
  }, []);

  const renameImage = useCallback((imageId: string, name: string) => {
    setImages(images => images.map(img => (img.id === imageId ? { ...img, name } : img)));
  }, [setImages]);

  const setActiveImageId = useCallback((imageId: string | null) => {
    setState(prev => ({ ...prev, activeImageId: imageId }));
  }, []);

  const updateImageLayers = useCallback((imageId: string, updater: (layers: StudioLayer[]) => StudioLayer[]) => {
    setImages(images => images.map(img => (img.id === imageId ? { ...img, layers: updater(img.layers) } : img)));
  }, [setImages]);

  const setActiveLayerId = useCallback((imageId: string, layerId: string | null) => {
    setImages(images => images.map(img => (img.id === imageId ? { ...img, activeLayerId: layerId } : img)));
  }, [setImages]);

  const setThumbnail = useCallback((imageId: string, thumbnail: string) => {
    setImages(images => images.map(img => (img.id === imageId ? { ...img, thumbnail } : img)));
  }, [setImages]);

  const openNewCanvasDialog = useCallback(() => setState(prev => ({ ...prev, showNewCanvasDialog: true })), []);
  const closeNewCanvasDialog = useCallback(() => setState(prev => ({ ...prev, showNewCanvasDialog: false })), []);

  const activeImage = state.images.find(img => img.id === state.activeImageId) ?? null;

  return {
    images: state.images,
    activeImageId: state.activeImageId,
    activeImage,
    showNewCanvasDialog: state.showNewCanvasDialog,
    setImages,
    addImage,
    removeImage,
    renameImage,
    setActiveImageId,
    updateImageLayers,
    setActiveLayerId,
    setThumbnail,
    openNewCanvasDialog,
    closeNewCanvasDialog,
  };
}
