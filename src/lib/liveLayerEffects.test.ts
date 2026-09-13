import { describe, it, expect } from 'vitest';
import { outerHalo } from './layerEffects';
import { maxEffectReach } from './liveLayerEffects';
import { createDefaultLayerEffects } from '../components/studio/studioTypes';

describe('maxEffectReach', () => {
  it('is 0 when nothing is enabled', () => {
    expect(maxEffectReach(createDefaultLayerEffects())).toBe(0);
  });

  it('accounts for distance + size on Drop Shadow', () => {
    const effects = createDefaultLayerEffects();
    effects.dropShadow = { ...effects.dropShadow, enabled: true, distance: 10, size: 7 };
    expect(maxEffectReach(effects)).toBe(17);
  });

  it('takes the largest reach across every enabled effect', () => {
    const effects = createDefaultLayerEffects();
    effects.dropShadow = { ...effects.dropShadow, enabled: true, distance: 5, size: 5 };
    effects.stroke = { ...effects.stroke, enabled: true, size: 40 };
    expect(maxEffectReach(effects)).toBe(40);
  });

  it('ignores a disabled effect even with large distance/size fields', () => {
    const effects = createDefaultLayerEffects();
    effects.dropShadow = { ...effects.dropShadow, enabled: false, distance: 999, size: 999 };
    expect(maxEffectReach(effects)).toBe(0);
  });
});

/**
 * The core correctness claim `paintLiveEffectCanvases`'s dirty-region path relies on: every halo
 * function is local (bounded blur/shift), so recomputing over a region padded by `2 × reach` and
 * discarding everything outside the inner `reach`-wide margin reproduces the full-page computation
 * exactly (up to floating-point rounding) — not merely a close approximation. Verified directly
 * against `outerHalo` (Drop Shadow/Outer Glow's own halo function) since it's pure and DOM-free.
 */
describe('dirty-region crop equivalence (outerHalo)', () => {
  it('matches a full-page computation inside the padded region', () => {
    const width = 80, height = 80;
    const alpha = new Float32Array(width * height);
    // A 20x20 solid square roughly in the middle of the page.
    for (let y = 30; y < 50; y++) {
      for (let x = 30; x < 50; x++) alpha[y * width + x] = 255;
    }
    const distance = 6, angle = 120, spread = 10, size = 8;
    const reach = distance + size;
    const pad = reach * 2 + 8;

    const full = outerHalo(alpha, width, height, distance, angle, spread, size);

    // Simulate paintLiveEffectCanvases's crop: a dirty box around the square, padded by 2*reach+8.
    const boxMinX = 30, boxMinY = 30, boxMaxX = 50, boxMaxY = 50;
    const rx = Math.max(0, boxMinX - pad);
    const ry = Math.max(0, boxMinY - pad);
    const rMaxX = Math.min(width, boxMaxX + pad);
    const rMaxY = Math.min(height, boxMaxY + pad);
    const rw = rMaxX - rx, rh = rMaxY - ry;

    const cropped = new Float32Array(rw * rh);
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) cropped[y * rw + x] = alpha[(ry + y) * width + (rx + x)];
    }
    const croppedHalo = outerHalo(cropped, rw, rh, distance, angle, spread, size);

    // Compare only the inner region (the actual composited box, padded by just `reach` — not the
    // full 2×reach crop) against the full-page result at the same page coordinates.
    const innerMinX = Math.max(0, boxMinX - reach), innerMinY = Math.max(0, boxMinY - reach);
    const innerMaxX = Math.min(width, boxMaxX + reach), innerMaxY = Math.min(height, boxMaxY + reach);
    let maxDiff = 0;
    for (let y = innerMinY; y < innerMaxY; y++) {
      for (let x = innerMinX; x < innerMaxX; x++) {
        const fullV = full[y * width + x];
        const cropV = croppedHalo[(y - ry) * rw + (x - rx)];
        maxDiff = Math.max(maxDiff, Math.abs(fullV - cropV));
      }
    }
    expect(maxDiff).toBeLessThan(0.01);
  });
});
