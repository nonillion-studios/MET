/**
 * Gradient endpoints spanning a `w` x `h` box at `angleDeg`, in the box's local coords.
 *
 * The box is projected onto the gradient direction so the ramp always spans the whole box at
 * any angle — a 45° ramp across a wide box must not stop short at the corner.
 *
 * Shared by the canvas renderer (StudioCanvas) and the raster exporter (lib/exportImage) so a
 * gradient can't drift between what's on screen and what's exported.
 */
export function gradientVector(w: number, h: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
  return {
    start: { x: w / 2 - dx * half, y: h / 2 - dy * half },
    end: { x: w / 2 + dx * half, y: h / 2 + dy * half },
  };
}
