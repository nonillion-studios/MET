import { createPlacedImageLayer, type StudioLayer } from '../components/studio/studioTypes';
import { parsePsdFile } from '../lib/importPsd';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export interface PlacedRasterImage {
  layer: StudioLayer;
  image: HTMLImageElement;
}

/**
 * Loads a flat raster image file (PNG/JPG/WEBP/GIF/SVG) and builds a placed-image ("Smart Object")
 * layer for it — the same `createPlacedImageLayer` factory and scale-to-fit/center math Studio's own
 * `handlePlaceImageFiles` uses (never scales up, only down; centers on the canvas). Returns the
 * loaded `HTMLImageElement` alongside the layer since `PlacedImageLayerData` carries no pixels of its
 * own — the caller (DesignCanvas, which owns the paint-canvas registry) draws it in.
 */
export async function placeRasterImageFile(file: File, canvasWidth: number, canvasHeight: number): Promise<PlacedRasterImage> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, canvasWidth / img.naturalWidth, canvasHeight / img.naturalHeight);
    const layer = createPlacedImageLayer(
      `Image: ${file.name}`,
      img.naturalWidth,
      img.naturalHeight,
      canvasWidth / 2,
      canvasHeight / 2,
      scale,
    );
    return { layer, image: img };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface PlacedPsdRaster {
  layerId: string;
  canvas: HTMLCanvasElement;
  left: number;
  top: number;
}

export interface PlacedPsdResult {
  layers: StudioLayer[];
  rasters: PlacedPsdRaster[];
}

/**
 * Places a `.psd` file as multiple layers — a thin adapter over `parsePsdFile`/`mapPsdEffects`
 * (`src/lib/importPsd.ts`), already fully decoupled from Studio's page/chapter state. Layers keep
 * their PSD-relative raster offsets, shifted so the PSD's own bounding box lands centered on the
 * Design Mode canvas (which may be a different size than the PSD's own document).
 */
export async function placePsdFile(file: File, canvasWidth: number, canvasHeight: number): Promise<PlacedPsdResult> {
  const parsed = await parsePsdFile(file);
  const offsetX = Math.round((canvasWidth - parsed.width) / 2);
  const offsetY = Math.round((canvasHeight - parsed.height) / 2);
  const rasters: PlacedPsdRaster[] = [];
  for (const [layerId, raster] of parsed.rasters) {
    rasters.push({ layerId, canvas: raster.canvas, left: raster.left + offsetX, top: raster.top + offsetY });
  }
  return { layers: parsed.layers, rasters };
}
