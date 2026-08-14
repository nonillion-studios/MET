/**
 * Flood-fills a downscaled composite of the page starting from a seed point to find the bubble
 * region around it (by color similarity to whatever's at the seed, not just "light"), then returns
 * its bounding-box center in full-resolution image coordinates. Mirrors TypeR's centerInBubble()
 * approach: a cheap same-color flood fill instead of real bubble segmentation.
 *
 * Color-based (full RGB distance) rather than luminance-only, so a colored manhwa bubble — or a
 * colored panel background that happens to share a white bubble's brightness — doesn't get
 * mis-grouped the way a brightness-only comparison would. There's no "must be light" gate: any seed
 * color is a valid bubble color, which is what lets this work on non-white/manhwa bubbles at all.
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
/** Euclidean RGB distance (0-441) a neighbor must stay within the seed color to keep flood-filling. */
const COLOR_SIMILARITY_THRESHOLD = 55;
const MAX_VISITED = 60000;
const MAX_BUBBLE_WIDTH_RATIO = 0.92;
const MAX_BUBBLE_HEIGHT_RATIO = 0.92;
/** Rejects a flood-fill result this small in either sample-space dimension — almost always the
 *  seed landing on a stray text/ink pixel rather than the bubble fill, not a real tiny bubble. */
const MIN_BUBBLE_SIZE_RATIO = 0.015;

function colorDistance(data: Uint8ClampedArray, p: number, r0: number, g0: number, b0: number): number {
  const i = p * 4;
  const dr = data[i] - r0;
  const dg = data[i + 1] - g0;
  const db = data[i + 2] - b0;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

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

  let sx = Math.round((seedX / image.width) * w);
  let sy = Math.round((seedY / image.height) * h);
  sx = Math.max(0, Math.min(w - 1, sx));
  sy = Math.max(0, Math.min(h - 1, sy));

  const seedIdx = (sy * w + sx) * 4;
  const r0 = data[seedIdx], g0 = data[seedIdx + 1], b0 = data[seedIdx + 2];

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
    if (x > 0 && !seen[p - 1] && colorDistance(data, p - 1, r0, g0, b0) < COLOR_SIMILARITY_THRESHOLD) { seen[p - 1] = 1; stack.push(p - 1); }
    if (x < w - 1 && !seen[p + 1] && colorDistance(data, p + 1, r0, g0, b0) < COLOR_SIMILARITY_THRESHOLD) { seen[p + 1] = 1; stack.push(p + 1); }
    if (y > 0 && !seen[p - w] && colorDistance(data, p - w, r0, g0, b0) < COLOR_SIMILARITY_THRESHOLD) { seen[p - w] = 1; stack.push(p - w); }
    if (y < h - 1 && !seen[p + w] && colorDistance(data, p + w, r0, g0, b0) < COLOR_SIMILARITY_THRESHOLD) { seen[p + w] = 1; stack.push(p + w); }
  }

  const width = maxX - minX;
  const height = maxY - minY;
  if (width > w * MAX_BUBBLE_WIDTH_RATIO || height > h * MAX_BUBBLE_HEIGHT_RATIO) return null;
  if (width < w * MIN_BUBBLE_SIZE_RATIO || height < h * MIN_BUBBLE_SIZE_RATIO) return null;

  return {
    x: ((minX + maxX) / 2 / w) * image.width,
    y: ((minY + maxY) / 2 / h) * image.height,
    width: (width / w) * image.width,
    height: (height / h) * image.height,
  };
}
