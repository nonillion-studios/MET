import { describe, it, expect } from 'vitest';
import { computeHistogram, autoLevelsFromHistogram } from './histogram';

function pixels(values: [number, number, number][]): { data: Uint8ClampedArray } {
  const data = new Uint8ClampedArray(values.length * 4);
  values.forEach(([r, g, b], i) => {
    data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 255;
  });
  return { data };
}

describe('computeHistogram', () => {
  it('counts each channel value at its own bucket', () => {
    const hist = computeHistogram(pixels([[10, 20, 30], [10, 20, 30]]));
    expect(hist.r[10]).toBe(2);
    expect(hist.g[20]).toBe(2);
    expect(hist.b[30]).toBe(2);
  });
});

describe('autoLevelsFromHistogram', () => {
  it('picks the full 0-255 range for a uniformly distributed histogram', () => {
    const hist = new Uint32Array(256).fill(10);
    const { inBlack, inWhite } = autoLevelsFromHistogram(hist, 0);
    expect(inBlack).toBe(0);
    expect(inWhite).toBe(255);
  });

  it('clips a small fraction of outlier pixels at each end', () => {
    const hist = new Uint32Array(256).fill(0);
    // A handful of outliers — fewer than the clip threshold on their own, so accumulating past them
    // actually reaches the real midtone body instead of the outliers alone dominating the clip
    // percentage (which is the correct, if less intuitive, behavior for a large spike exactly at an
    // extreme value: Auto Levels clips a percentage of *pixels*, not "any spike", so a spike bigger
    // than the clip count legitimately keeps the extreme as the real in-point).
    hist[0] = 10;
    for (let v = 100; v <= 150; v++) hist[v] = 200; // the real midtone body
    hist[255] = 10;
    const { inBlack, inWhite } = autoLevelsFromHistogram(hist, 0.5);
    expect(inBlack).toBeGreaterThan(0);
    expect(inWhite).toBeLessThan(255);
  });
});
