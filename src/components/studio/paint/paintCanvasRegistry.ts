/**
 * One off-React HTMLCanvasElement per raster-backed layer, keyed by layer id —
 * mirrors the textNodeRefs ref-registry pattern already used in StudioCanvas.
 * This canvas is the single source of pixel truth; Konva only ever re-points
 * an <Image> at it and redraws, never keeps its own copy.
 */
export type PaintCanvasRegistry = Record<string, HTMLCanvasElement | undefined>;

export function getOrCreateCanvasFor(registry: PaintCanvasRegistry, layerId: string, width: number, height: number): HTMLCanvasElement {
  let canvas = registry[layerId];
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    registry[layerId] = canvas;
  } else if (canvas.width !== width || canvas.height !== height) {
    // Page size changed (e.g. new page selected) — resize without losing existing pixels isn't
    // meaningful across different pages, so just reset.
    canvas.width = width;
    canvas.height = height;
  }
  return canvas;
}

export function deleteCanvasFor(registry: PaintCanvasRegistry, layerId: string): void {
  delete registry[layerId];
}

/**
 * Copies `fromId`'s pixels to a fresh canvas under `toId`. No-op when `fromId` has no canvas
 * (a layer that's never been painted, or one whose page hasn't been visited this session).
 *
 * Duplicating a layer *must* go through this: the registry is keyed by layer id, so a copy that
 * only clones the `StudioLayer` object gets handed a blank canvas by `getOrCreateCanvasFor` and
 * silently loses every pixel.
 */
export function clonePaintCanvas(registry: PaintCanvasRegistry, fromId: string, toId: string): void {
  const source = registry[fromId];
  if (!source) return;
  const copy = document.createElement('canvas');
  copy.width = source.width;
  copy.height = source.height;
  copy.getContext('2d')?.drawImage(source, 0, 0);
  registry[toId] = copy;
}
