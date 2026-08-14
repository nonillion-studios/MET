/**
 * Manhwa/webtoon long-strip splitting for the Translation stage. A single webtoon page can be many
 * times taller than it is wide — too tall for a vision model to read reliably in one shot — so this
 * cuts it into shorter segments before sending it to Gemini, then Studio re-normalizes each
 * segment's bubble coordinates back into full-page (0..1) space so autoTypeset.ts places everything
 * correctly on the one real page.
 *
 * The cut points are chosen by scanning for the *flattest* (lowest luminance-range) row near each
 * ideal split height — a blank gutter or a flat background band — rather than cutting at a fixed
 * height, so a split lands between panels/bubbles instead of through one. This is a heuristic, not
 * real panel/bubble segmentation (same honest scope as bubbleDetect.ts's flood fill): a very
 * densely-packed strip with no flat rows near a split point can still get an imperfect cut.
 */

const LONG_PAGE_RATIO = 2.5; // height / width above which a page is treated as a webtoon strip
const TARGET_SEGMENT_HEIGHT_RATIO = 1.4; // each segment's target height, as a multiple of page width
const SAMPLE_WIDTH = 400;

export function isLongPage(width: number, height: number): boolean {
  return width > 0 && height / width > LONG_PAGE_RATIO;
}

function rowLumRange(data: Uint8ClampedArray, w: number, y: number): number {
  let min = 255, max = 0;
  for (let x = 0; x < w; x++) {
    const p = (y * w + x) * 4;
    const lum = data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114;
    if (lum < min) min = lum;
    if (lum > max) max = lum;
  }
  return max - min;
}

/** Full-resolution Y coordinates of every internal split (sorted, excludes 0 and the page height). */
export function findSplitRows(img: HTMLImageElement): number[] {
  const targetSegmentHeight = img.width * TARGET_SEGMENT_HEIGHT_RATIO;
  const segmentCount = Math.max(1, Math.round(img.height / targetSegmentHeight));
  if (segmentCount <= 1) return [];

  const sampleScale = Math.min(1, SAMPLE_WIDTH / img.width);
  const w = Math.max(1, Math.round(img.width * sampleScale));
  const h = Math.max(1, Math.round(img.height * sampleScale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;

  const segmentSampleHeight = h / segmentCount;
  const searchRadius = Math.max(2, Math.round(segmentSampleHeight * 0.25));
  const splitsSampleY: number[] = [];
  for (let i = 1; i < segmentCount; i++) {
    const idealY = Math.round(segmentSampleHeight * i);
    let bestY = idealY;
    let bestRange = Infinity;
    for (let dy = -searchRadius; dy <= searchRadius; dy++) {
      const y = Math.min(h - 1, Math.max(0, idealY + dy));
      const range = rowLumRange(data, w, y);
      if (range < bestRange) { bestRange = range; bestY = y; }
    }
    splitsSampleY.push(bestY);
  }
  return splitsSampleY.map(y => Math.round(y / sampleScale));
}

export interface PageSegment {
  dataUrl: string;
  /** Full-resolution Y offset of this segment's top edge within the whole page. */
  offsetY: number;
  height: number;
}

export function splitLongPage(img: HTMLImageElement): PageSegment[] {
  const splitRows = findSplitRows(img);
  const boundaries = [0, ...splitRows, img.height];
  const segments: PageSegment[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const offsetY = boundaries[i];
    const height = boundaries[i + 1] - offsetY;
    if (height <= 0) continue;
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    ctx.drawImage(img, 0, offsetY, img.width, height, 0, 0, img.width, height);
    segments.push({ dataUrl: canvas.toDataURL('image/png'), offsetY, height });
  }
  return segments;
}
