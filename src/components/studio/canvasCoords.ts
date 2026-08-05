/**
 * The stage's current pan/zoom — the same `pos`/`scale` state `StudioCanvas.tsx` already keeps for
 * its Konva `Stage`. Screen (container/client) pixels and image/page-space pixels relate by this
 * single transform: `screen = image * scale + pos`.
 */
export interface CanvasViewport {
  scale: number;
  pos: { x: number; y: number };
}

/**
 * Converts a point in screen pixels (e.g. `stage.getPointerPosition()`, or a pointer event already
 * made relative to the canvas container) into image/page-space pixels.
 */
export const screenToImage = (screenX: number, screenY: number, v: CanvasViewport): { x: number; y: number } => ({
  x: (screenX - v.pos.x) / v.scale,
  y: (screenY - v.pos.y) / v.scale,
});

/**
 * Converts a point in image/page-space pixels into screen pixels (relative to the canvas
 * container) — the inverse of `screenToImage`. Used to position DOM overlays (the editing
 * textarea, the floating text toolbar) over a layer's Konva-space geometry.
 */
export const imageToScreen = (imageX: number, imageY: number, v: CanvasViewport): { x: number; y: number } => ({
  x: imageX * v.scale + v.pos.x,
  y: imageY * v.scale + v.pos.y,
});
