import { describe, it, expect } from 'vitest';
import { extractAlpha, outerHalo, innerShadowHalo, strokeRing, blendIfRangeMask, applyBlendIf } from './layerEffects';

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

describe('blendIfRangeMask', () => {
  const range = { blackMin: 20, blackMax: 60, whiteMin: 180, whiteMax: 220 };

  it('is 0 below blackMin', () => {
    expect(blendIfRangeMask(10, range)).toBe(0);
  });

  it('ramps 0..1 across the black range', () => {
    expect(blendIfRangeMask(20, range)).toBe(0);
    expect(blendIfRangeMask(40, range)).toBeCloseTo(0.5, 5);
    expect(blendIfRangeMask(60, range)).toBeCloseTo(1, 5);
  });

  it('is 1 on the plateau between the two ranges', () => {
    expect(blendIfRangeMask(120, range)).toBe(1);
  });

  it('ramps 1..0 across the white range', () => {
    expect(blendIfRangeMask(180, range)).toBeCloseTo(1, 5);
    expect(blendIfRangeMask(200, range)).toBeCloseTo(0.5, 5);
    expect(blendIfRangeMask(220, range)).toBeCloseTo(0, 5);
  });

  it('is 0 above whiteMax', () => {
    expect(blendIfRangeMask(230, range)).toBe(0);
  });

  it('is a no-op (always 1) at the default full-range settings', () => {
    const noop = { blackMin: 0, blackMax: 0, whiteMin: 255, whiteMax: 255 };
    for (const v of [0, 1, 128, 254, 255]) expect(blendIfRangeMask(v, noop)).toBe(1);
  });
});

describe('applyBlendIf', () => {
  function rgba(r: number, g: number, b: number, a: number): Uint8ClampedArray {
    return new Uint8ClampedArray([r, g, b, a]);
  }

  it('zeroes alpha for a this-layer pixel outside the gray range', () => {
    const data = rgba(10, 10, 10, 255); // luminance ~10, below blackMin
    applyBlendIf(data, { blackMin: 20, blackMax: 20, whiteMin: 255, whiteMax: 255 }, 'gray');
    expect(data[3]).toBe(0);
  });

  it('leaves alpha untouched at default no-op settings', () => {
    const data = rgba(200, 50, 50, 200);
    applyBlendIf(data, { blackMin: 0, blackMax: 0, whiteMin: 255, whiteMax: 255 }, 'gray');
    expect(data[3]).toBe(200);
  });

  it('reads a single channel when channel is r/g/b instead of gray', () => {
    const data = rgba(255, 0, 0, 255); // red-only pixel — gray luminance would be mid-range, red channel is 255
    applyBlendIf(data, { blackMin: 0, blackMax: 0, whiteMin: 100, whiteMax: 100 }, 'r');
    expect(data[3]).toBe(0); // red channel (255) is above whiteMax (100) -> gated to 0
  });

  it('gates on the underlying backdrop when provided, in addition to this layer', () => {
    const thisData = rgba(128, 128, 128, 255); // passes This Layer's wide-open range
    const underlyingData = rgba(10, 10, 10, 255); // fails Underlying's range
    applyBlendIf(
      thisData,
      { blackMin: 0, blackMax: 0, whiteMin: 255, whiteMax: 255 },
      'gray',
      { data: underlyingData, range: { blackMin: 20, blackMax: 20, whiteMin: 255, whiteMax: 255 } },
    );
    expect(thisData[3]).toBe(0);
  });

  it('omitting underlying skips the underlying gate entirely', () => {
    const data = rgba(128, 128, 128, 255);
    applyBlendIf(data, { blackMin: 0, blackMax: 0, whiteMin: 255, whiteMax: 255 }, 'gray');
    expect(data[3]).toBe(255);
  });
});
