import { describe, it, expect } from 'vitest';
import { extractAlpha, outerHalo, innerShadowHalo, strokeRing } from './layerEffects';

function solidSquare(size: number, inset: number): { data: Uint8ClampedArray; width: number; height: number } {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const opaque = x >= inset && x < size - inset && y >= inset && y < size - inset;
      data[i + 3] = opaque ? 255 : 0;
    }
  }
  return { data, width: size, height: size };
}

describe('extractAlpha', () => {
  it('reads only the alpha channel', () => {
    const content = solidSquare(4, 1);
    const alpha = extractAlpha(content);
    expect(alpha.length).toBe(16);
    expect(alpha[0]).toBe(0); // corner, inset out
    expect(alpha[5]).toBe(255); // (1,1), inside the inset square
  });
});

describe('outerHalo', () => {
  it('produces a non-zero halo for a solid square with distance=0', () => {
    const content = solidSquare(20, 5);
    const alpha = extractAlpha(content);
    const halo = outerHalo(alpha, 20, 20, 0, 120, 0, 4);
    const total = Array.from(halo).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(0);
  });

  it('is all-zero for a fully transparent layer', () => {
    const alpha = new Float32Array(100); // 10x10, all zero
    const halo = outerHalo(alpha, 10, 10, 5, 120, 20, 5);
    expect(Array.from(halo).every(v => v === 0)).toBe(true);
  });
});

describe('innerShadowHalo', () => {
  it('is clipped to the content silhouette (zero outside it)', () => {
    const content = solidSquare(20, 5);
    const alpha = extractAlpha(content);
    const halo = innerShadowHalo(alpha, 20, 20, 3, 120, 3);
    // Corner (fully outside the inset square) must stay zero — the halo is masked by content alpha.
    expect(halo[0]).toBe(0);
  });
});

describe('strokeRing', () => {
  it('outside stroke never overlaps the original silhouette', () => {
    const content = solidSquare(30, 10);
    const alpha = extractAlpha(content);
    const ring = strokeRing(alpha, 30, 30, 3, 'outside');
    for (let i = 0; i < ring.length; i++) {
      if (alpha[i] > 127) expect(ring[i]).toBe(0);
    }
    // The ring should exist somewhere just outside the square.
    expect(Array.from(ring).some(v => v > 0)).toBe(true);
  });

  it('inside stroke stays within the original silhouette', () => {
    const content = solidSquare(30, 10);
    const alpha = extractAlpha(content);
    const ring = strokeRing(alpha, 30, 30, 3, 'inside');
    for (let i = 0; i < ring.length; i++) {
      if (ring[i] > 0) expect(alpha[i]).toBeGreaterThan(127);
    }
  });
});
