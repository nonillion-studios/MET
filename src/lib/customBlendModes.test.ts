import { describe, it, expect } from 'vitest';
import { applyCustomBlend } from './customBlendModes';

function onePixel(r: number, g: number, b: number, a = 255) {
  return { data: new Uint8ClampedArray([r, g, b, a]) };
}

describe('applyCustomBlend', () => {
  it('linear-burn: white source is the identity (cb+255-255=cb), matching the real formula', () => {
    const backdrop = onePixel(100, 120, 140);
    const source = onePixel(255, 255, 255);
    applyCustomBlend('linear-burn', backdrop, source);
    expect(Array.from(source.data.slice(0, 3))).toEqual([100, 120, 140]);
  });

  it('linear-burn: black source over any backdrop goes to black (cb+0-255 clamped to 0)', () => {
    const backdrop = onePixel(200, 150, 50);
    const source = onePixel(0, 0, 0);
    applyCustomBlend('linear-burn', backdrop, source);
    expect(Array.from(source.data.slice(0, 3))).toEqual([0, 0, 0]);
  });

  it('darker-color picks the whole darker color, not a per-channel min', () => {
    const backdrop = onePixel(10, 10, 250); // luma low-ish but has a bright blue channel
    const source = onePixel(200, 200, 200); // flat gray, higher luma
    applyCustomBlend('darker-color', backdrop, source);
    // Backdrop's luma (0.299*10+0.587*10+0.114*250=37.3) is lower, so the whole backdrop color wins.
    expect(Array.from(source.data.slice(0, 3))).toEqual([10, 10, 250]);
  });

  it('subtract clamps at 0 rather than wrapping negative', () => {
    const backdrop = onePixel(10, 10, 10);
    const source = onePixel(50, 50, 50);
    applyCustomBlend('subtract', backdrop, source);
    expect(Array.from(source.data.slice(0, 3))).toEqual([0, 0, 0]);
  });

  it('divide: backdrop divided by white source is unchanged', () => {
    const backdrop = onePixel(100, 150, 200);
    const source = onePixel(255, 255, 255);
    applyCustomBlend('divide', backdrop, source);
    expect(Array.from(source.data.slice(0, 3))).toEqual([100, 150, 200]);
  });

  it('hard-mix posterizes to pure primaries', () => {
    const backdrop = onePixel(200, 50, 200);
    const source = onePixel(200, 50, 200);
    applyCustomBlend('hard-mix', backdrop, source);
    for (const v of source.data.slice(0, 3)) expect(v === 0 || v === 255).toBe(true);
  });

  it('dissolve fully discards a fully-transparent source pixel', () => {
    const backdrop = onePixel(0, 0, 0);
    const source = onePixel(255, 0, 0, 0);
    applyCustomBlend('dissolve', backdrop, source);
    expect(source.data[3]).toBe(0);
  });
});
