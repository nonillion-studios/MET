/**
 * No histogram code existed anywhere in this repo before this — the bar-chart display on Levels/
 * Threshold and Levels' "Auto" button are both greenfield. Pure `ImageData`-in math, no DOM, same
 * convention as `adjustments.ts`/`filters.ts` (runs unmodified in vitest's DOM-free environment).
 */

export interface Histogram {
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
  luminance: Uint32Array;
}

/** One pass over the pixel buffer, bucketing each channel (plus a standard-luma composite) into
 *  256 counts. */
export function computeHistogram(imageData: Pick<ImageData, 'data'>): Histogram {
  const r = new Uint32Array(256);
  const g = new Uint32Array(256);
  const b = new Uint32Array(256);
  const luminance = new Uint32Array(256);
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    const rv = d[i], gv = d[i + 1], bv = d[i + 2];
    r[rv]++; g[gv]++; b[bv]++;
    luminance[Math.round(0.299 * rv + 0.587 * gv + 0.114 * bv)]++;
  }
  return { r, g, b, luminance };
}

/**
 * Standard Photoshop-style Auto Levels: walk in from each end of the histogram until `clipPercent`%
 * of the total pixel count has been passed, and use that bucket as the new in-point — clips a small
 * fraction of outlier pixels at each extreme rather than letting a handful of stray dark/light
 * pixels set the whole range.
 */
export function autoLevelsFromHistogram(hist: Uint32Array, clipPercent = 0.5): { inBlack: number; inWhite: number } {
  const total = hist.reduce((a, b) => a + b, 0);
  if (total === 0) return { inBlack: 0, inWhite: 255 };
  const clipCount = total * (clipPercent / 100);

  let acc = 0;
  let inBlack = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc > clipCount) { inBlack = v; break; }
  }

  acc = 0;
  let inWhite = 255;
  for (let v = 255; v >= 0; v--) {
    acc += hist[v];
    if (acc > clipCount) { inWhite = v; break; }
  }

  if (inWhite <= inBlack) return { inBlack: 0, inWhite: 255 };
  return { inBlack, inWhite };
}
