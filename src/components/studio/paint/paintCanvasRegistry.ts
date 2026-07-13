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
