import { describe, it, expect } from 'vitest';
import { proximityMatchFill, createTextureFill, contentAwareFillPatches, runContentAwareFill, extractSubRegion, type PixelBuffer, type RepairMask } from './contentAwareAlgorithms';

function makeFlatPatch(size: number, r: number, g: number, b: number): PixelBuffer {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 255;
  }
  return { data, width: size, height: size };
}

/** A square mask of `maskSize` centered in a `size`x`size` patch. */
function makeCenterMask(size: number, maskSize: number): RepairMask {
  const data = new Uint8ClampedArray(size * size);
  const start = Math.floor((size - maskSize) / 2);
  for (let y = start; y < start + maskSize; y++) {
    for (let x = start; x < start + maskSize; x++) {
      data[y * size + x] = 255;
    }
  }
  return { data, width: size, height: size };
}

function pixelAt(buf: PixelBuffer, x: number, y: number): [number, number, number, number] {
  const o = (y * buf.width + x) * 4;
  return [buf.data[o], buf.data[o + 1], buf.data[o + 2], buf.data[o + 3]];
}

describe('proximityMatchFill', () => {
  it('fills a masked region on a flat background with that same background color', () => {
    const patch = makeFlatPatch(20, 200, 100, 50);
    const mask = makeCenterMask(20, 6);
    const filled = proximityMatchFill(patch, mask);
    const [r, g, b] = pixelAt(filled, 10, 10);
    expect(r).toBeCloseTo(200, 0);
    expect(g).toBeCloseTo(100, 0);
    expect(b).toBeCloseTo(50, 0);
  });

  it('leaves unmasked pixels untouched outside the boundary blur band', () => {
    const patch = makeFlatPatch(20, 10, 20, 30);
    const mask = makeCenterMask(20, 4);
    const filled = proximityMatchFill(patch, mask);
    expect(pixelAt(filled, 0, 0)).toEqual([10, 20, 30, 255]);
  });

  it('is a no-op when nothing is masked', () => {
    const patch = makeFlatPatch(10, 1, 2, 3);
    const mask: RepairMask = { data: new Uint8ClampedArray(100), width: 10, height: 10 };
    const filled = proximityMatchFill(patch, mask);
    expect(pixelAt(filled, 5, 5)).toEqual([1, 2, 3, 255]);
  });
});

describe('createTextureFill', () => {
  it('produces fully-opaque pixels inside the mask on a flat surrounding', () => {
    const patch = makeFlatPatch(24, 128, 128, 128);
    const mask = makeCenterMask(24, 8);
    const filled = createTextureFill(patch, mask);
    const [, , , a] = pixelAt(filled, 12, 12);
    expect(a).toBe(255);
  });

  it('stays close to the surrounding mean color (no wild color shift)', () => {
    const patch = makeFlatPatch(24, 100, 150, 200);
    const mask = makeCenterMask(24, 8);
    const filled = createTextureFill(patch, mask);
    const [r, g, b] = pixelAt(filled, 12, 12);
    expect(r).toBeGreaterThan(50);
    expect(r).toBeLessThan(200);
    expect(g).toBeGreaterThan(100);
    expect(g).toBeLessThan(220);
    expect(b).toBeGreaterThan(150);
    expect(b).toBeLessThan(255);
  });

  it('leaves unmasked pixels unchanged', () => {
    const patch = makeFlatPatch(24, 5, 5, 5);
    const mask = makeCenterMask(24, 8);
    const filled = createTextureFill(patch, mask);
    expect(pixelAt(filled, 0, 0)).toEqual([5, 5, 5, 255]);
  });
});

describe('contentAwareFillPatches', () => {
  it('fills the mask region without crashing and keeps colors in range', () => {
    const patch = makeFlatPatch(40, 90, 60, 30);
    const mask = makeCenterMask(40, 12);
    const filled = contentAwareFillPatches(patch, mask, 12);
    const [r, g, b, a] = pixelAt(filled, 20, 20);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(255);
    expect(g).toBeGreaterThanOrEqual(0);
    expect(g).toBeLessThanOrEqual(255);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThanOrEqual(255);
    expect(a).toBe(255);
  });

  it('falls back gracefully (via proximity match) when there is no ring to sample', () => {
    const size = 6;
    const patch = makeFlatPatch(size, 40, 40, 40);
    const data = new Uint8ClampedArray(size * size).fill(255); // entire patch masked
    const mask: RepairMask = { data, width: size, height: size };
    expect(() => contentAwareFillPatches(patch, mask, 8)).not.toThrow();
  });
});

describe('extractSubRegion', () => {
  it('slices the requested region out of a larger buffer', () => {
    const full = makeFlatPatch(20, 1, 2, 3);
    full.data[(5 * 20 + 5) * 4] = 99; // one distinguishing pixel at (5,5)
    const sub = extractSubRegion(full, 3, 3, 6, 6);
    expect(sub.width).toBe(6);
    expect(sub.height).toBe(6);
    expect(pixelAt(sub, 2, 2)[0]).toBe(99); // (5,5) in full == (2,2) in the sub-region
    expect(pixelAt(sub, 0, 0)).toEqual([1, 2, 3, 255]);
  });

  it('reads out-of-bounds area as transparent black instead of throwing', () => {
    const full = makeFlatPatch(4, 10, 20, 30);
    const sub = extractSubRegion(full, -2, -2, 6, 6);
    expect(pixelAt(sub, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(pixelAt(sub, 2, 2)).toEqual([10, 20, 30, 255]);
  });
});

describe('runContentAwareFill', () => {
  it('dispatches to the right mode', () => {
    const patch = makeFlatPatch(16, 60, 60, 60);
    const mask = makeCenterMask(16, 4);
    for (const mode of ['proximity', 'texture', 'contentAware'] as const) {
      const result = runContentAwareFill(mode, patch, mask, 8);
      expect(result.width).toBe(16);
      expect(result.height).toBe(16);
    }
  });
});
