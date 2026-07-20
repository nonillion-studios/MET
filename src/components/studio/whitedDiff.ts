/**
 * Diffs a manually "whited" (text-erased) manga page against its original, and turns the pixels
 * that changed into an alpha mask — so a page someone already cleaned outside the app can be
 * imported as an editable, precisely-bounded layer instead of a full flat copy the user has to
 * re-mask by hand. Mirrors bubbleDetect.ts's scratch-canvas + getImageData pattern.
 */

export interface DiffMaskResult {
  /** Alpha canvas, same pixel dimensions as `original`. Opaque where the two images differ above
   *  the threshold; RGB channels are the whited image's own pixels, so this canvas doubles as the
   *  ready-to-composite patch content once its alpha is applied. */
  maskCanvas: HTMLCanvasElement;
  /** Fraction of pixels flagged as differing, 0..1 — lets the caller warn on a near-empty diff
   *  (e.g. the "whited" upload is actually identical to the original). */
  changedRatio: number;
}

const DEFAULT_THRESHOLD = 24; // out of 255 — permissive enough to survive re-save/JPEG noise
const MAX_ASPECT_DRIFT = 0.02; // reject pairs that aren't actually the same page

function luminance(r: number, g: number, b: number): number {
  return r * 0.299 + g * 0.587 + b * 0.114;
}

export function computeWhitedDiffMask(
  original: HTMLImageElement,
  whited: HTMLImageElement,
  opts?: { threshold?: number },
): DiffMaskResult {
  const threshold = opts?.threshold ?? DEFAULT_THRESHOLD;
  const w = original.naturalWidth || original.width;
  const h = original.naturalHeight || original.height;

  const origAspect = w / h;
  const whitedAspect = (whited.naturalWidth || whited.width) / (whited.naturalHeight || whited.height);
  if (Math.abs(origAspect - whitedAspect) / origAspect > MAX_ASPECT_DRIFT) {
    throw new Error('The whited image\'s aspect ratio does not match this page\'s original — make sure it\'s paired to the right page.');
  }

  const origCanvas = document.createElement('canvas');
  origCanvas.width = w;
  origCanvas.height = h;
  const origCtx = origCanvas.getContext('2d', { willReadFrequently: true })!;
  origCtx.drawImage(original, 0, 0, w, h);
  const origData = origCtx.getImageData(0, 0, w, h).data;

  const whitedCanvas = document.createElement('canvas');
  whitedCanvas.width = w;
  whitedCanvas.height = h;
  const whitedCtx = whitedCanvas.getContext('2d', { willReadFrequently: true })!;
  // Resample the whited image into the original's exact pixel grid, in case the two uploads
  // aren't pixel-identical dimensions (e.g. one was re-exported at a slightly different DPI).
  whitedCtx.drawImage(whited, 0, 0, w, h);
  const whitedImg = whitedCtx.getImageData(0, 0, w, h);
  const whitedData = whitedImg.data;

  const pixelCount = w * h;
  const on = new Uint8Array(pixelCount);
  let onCount = 0;
  for (let i = 0; i < pixelCount; i++) {
    const o = i * 4;
    const lumA = luminance(origData[o], origData[o + 1], origData[o + 2]);
    const lumB = luminance(whitedData[o], whitedData[o + 1], whitedData[o + 2]);
    if (Math.abs(lumA - lumB) > threshold) {
      on[i] = 1;
      onCount++;
    }
  }

  // Single 3x3 majority-filter cleanup pass (open: erode then dilate in one pass via a vote
  // threshold) to drop single-pixel noise from JPEG artifacting, without merging/connecting
  // regions — whiting edits are legitimately disjoint (multiple bubbles at once), so a real
  // flood-fill/connected-component pass would be the wrong tool here.
  const cleaned = new Uint8Array(pixelCount);
  let cleanedCount = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let votes = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          votes += on[ny * w + nx];
        }
      }
      if (votes >= 5) {
        cleaned[i] = 1;
        cleanedCount++;
      }
    }
  }

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = w;
  maskCanvas.height = h;
  const maskCtx = maskCanvas.getContext('2d')!;
  const out = maskCtx.createImageData(w, h);
  for (let i = 0; i < pixelCount; i++) {
    const o = i * 4;
    out.data[o] = whitedData[o];
    out.data[o + 1] = whitedData[o + 1];
    out.data[o + 2] = whitedData[o + 2];
    out.data[o + 3] = cleaned[i] ? 255 : 0;
  }
  maskCtx.putImageData(out, 0, 0);

  return { maskCanvas, changedRatio: cleanedCount / pixelCount };
}
