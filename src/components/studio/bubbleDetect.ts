/**
 * Flood-fills a downscaled composite of the page starting from a seed point to find
 * the light (speech-bubble) region around it, then returns its bounding-box center
 * in full-resolution image coordinates. Mirrors TypeR's centerInBubble() approach:
 * a cheap luminance-threshold flood fill instead of real bubble segmentation.
 */
export interface BubbleCenter {
  x: number;
  y: number;
  /** Full-resolution bounding-box size of the detected region, for callers that also need to size
   *  a text box to the bubble (not just recenter a fixed-size one). */
  width: number;
  height: number;
}

const SAMPLE_WIDTH = 280;
const LIGHT_THRESHOLD = 120;
const SIMILARITY_THRESHOLD = 40;
const MAX_VISITED = 50000;
const MAX_BUBBLE_WIDTH_RATIO = 0.92;

export function detectBubbleCenter(image: HTMLImageElement, seedX: number, seedY: number): BubbleCenter | null {
  const w = SAMPLE_WIDTH;
  const h = Math.max(2, Math.round((image.height / image.width) * w));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const lum = (p: number) => data[p * 4] * 0.299 + data[p * 4 + 1] * 0.587 + data[p * 4 + 2] * 0.114;

  let sx = Math.round((seedX / image.width) * w);
  let sy = Math.round((seedY / image.height) * h);
  sx = Math.max(0, Math.min(w - 1, sx));
  sy = Math.max(0, Math.min(h - 1, sy));

  const seed = lum(sy * w + sx);
  if (seed < LIGHT_THRESHOLD) return null;

  const seen = new Uint8Array(w * h);
  const stack = [sy * w + sx];
  seen[sy * w + sx] = 1;
  let minX = sx, maxX = sx, minY = sy, maxY = sy, visited = 0;

  while (stack.length && visited < MAX_VISITED) {
    const p = stack.pop()!;
    visited++;
    const y = Math.floor(p / w);
    const x = p % w;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (x > 0 && !seen[p - 1] && Math.abs(lum(p - 1) - seed) < SIMILARITY_THRESHOLD) { seen[p - 1] = 1; stack.push(p - 1); }
    if (x < w - 1 && !seen[p + 1] && Math.abs(lum(p + 1) - seed) < SIMILARITY_THRESHOLD) { seen[p + 1] = 1; stack.push(p + 1); }
    if (y > 0 && !seen[p - w] && Math.abs(lum(p - w) - seed) < SIMILARITY_THRESHOLD) { seen[p - w] = 1; stack.push(p - w); }
    if (y < h - 1 && !seen[p + w] && Math.abs(lum(p + w) - seed) < SIMILARITY_THRESHOLD) { seen[p + w] = 1; stack.push(p + w); }
  }

  if (maxX - minX > w * MAX_BUBBLE_WIDTH_RATIO) return null;

  return {
    x: ((minX + maxX) / 2 / w) * image.width,
    y: ((minY + maxY) / 2 / h) * image.height,
    width: ((maxX - minX) / w) * image.width,
    height: ((maxY - minY) / h) * image.height,
  };
}
