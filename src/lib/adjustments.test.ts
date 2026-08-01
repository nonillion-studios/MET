import { describe, it, expect } from 'vitest';
import {
  curveLut, curvesFilter, exposureFilter, vibranceFilter, colorBalanceFilter,
  posterizeFilter, thresholdFilter, gradientMapFilter,
  legacyBrightnessContrastFilter, modernBrightnessContrastFilter, hueBandWeights,
  blackWhiteFilter, photoFilterFilter, channelMixerFilter, invertFilter,
  selectiveColorFilter, shadowsHighlightsFilter, hdrToningFilter, colorLookupFilter,
} from './adjustments';
import type { AdjustmentLayerData } from '../components/studio/studioTypes';

/** A single-pixel ImageData-shaped object — the filters only ever read/write `.data`, so a plain
 *  Uint8ClampedArray-backed object is enough; no real DOM/canvas needed for this (node) test env. */
function onePixel(r: number, g: number, b: number, a = 255): ImageData {
  return { data: new Uint8ClampedArray([r, g, b, a]), width: 1, height: 1, colorSpace: 'srgb' } as ImageData;
}

/** A W x H solid-color ImageData, for filters (Shadows/Highlights, HDR Toning) that need a real
 *  neighborhood to blur, not just a single pixel. */
function solidBlock(size: number, r: number, g: number, b: number): ImageData {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255; }
  return { data, width: size, height: size, colorSpace: 'srgb' } as ImageData;
}

const IDENTITY_CURVE = [{ input: 0, output: 0 }, { input: 255, output: 255 }];
const IDENTITY_CURVES: AdjustmentLayerData['curves'] = {
  rgb: IDENTITY_CURVE, r: IDENTITY_CURVE, g: IDENTITY_CURVE, b: IDENTITY_CURVE, luminosity: IDENTITY_CURVE,
};
const NEUTRAL_COLOR_BALANCE: AdjustmentLayerData['colorBalance'] = {
  shadows: { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 },
  midtones: { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 },
  highlights: { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 },
  preserveLuminosity: true,
};

describe('curveLut', () => {
  it('is the identity function for the default two-point curve', () => {
    const lut = curveLut(IDENTITY_CURVE);
    for (let v = 0; v < 256; v++) expect(lut[v]).toBe(v);
  });

  it('raises midtones when a middle control point is raised', () => {
    const lut = curveLut([{ input: 0, output: 0 }, { input: 128, output: 200 }, { input: 255, output: 255 }]);
    expect(lut[128]).toBe(200);
    expect(lut[64]).toBeGreaterThan(64); // midtone lift pulls the neighborhood up too
  });

  it('clamps outside the first/last point rather than extrapolating', () => {
    const lut = curveLut([{ input: 50, output: 100 }, { input: 200, output: 150 }]);
    expect(lut[0]).toBe(100);
    expect(lut[255]).toBe(150);
  });
});

describe('curvesFilter', () => {
  it('applies the RGB composite LUT to R/G/B, leaves alpha untouched', () => {
    const filter = curvesFilter({ ...IDENTITY_CURVES, rgb: [{ input: 0, output: 0 }, { input: 255, output: 128 }] });
    const img = onePixel(255, 255, 255, 200);
    filter(img);
    expect(img.data[0]).toBe(128);
    expect(img.data[1]).toBe(128);
    expect(img.data[2]).toBe(128);
    expect(img.data[3]).toBe(200);
  });

  it('is a no-op when every channel is identity', () => {
    const filter = curvesFilter(IDENTITY_CURVES);
    const img = onePixel(100, 150, 200);
    filter(img);
    expect(Array.from(img.data.slice(0, 3))).toEqual([100, 150, 200]);
  });

  it('applies a per-channel curve only to its own channel', () => {
    const filter = curvesFilter({ ...IDENTITY_CURVES, r: [{ input: 0, output: 0 }, { input: 255, output: 128 }] });
    const img = onePixel(255, 100, 50);
    filter(img);
    expect(img.data[0]).toBe(128);
    expect(img.data[1]).toBe(100);
    expect(img.data[2]).toBe(50);
  });
});

describe('exposureFilter', () => {
  it('is a no-op at exposure=0, offset=0, gamma=1', () => {
    const filter = exposureFilter(0, 0, 1);
    const img = onePixel(100, 150, 200);
    filter(img);
    expect(Array.from(img.data.slice(0, 3))).toEqual([100, 150, 200]);
  });

  it('brightens at a positive exposure stop', () => {
    const filter = exposureFilter(1, 0, 1); // +1 stop = 2x linear light
    const img = onePixel(100, 100, 100);
    filter(img);
    expect(img.data[0]).toBeGreaterThan(100);
  });
});

describe('vibranceFilter', () => {
  it('is a no-op at vibrance=0', () => {
    const filter = vibranceFilter(0);
    const img = onePixel(200, 100, 50);
    filter(img);
    expect(Array.from(img.data.slice(0, 3))).toEqual([200, 100, 50]);
  });

  it('boosts a low-saturation pixel more than a high positive vibrance would leave untouched', () => {
    const filter = vibranceFilter(100);
    const img = onePixel(140, 130, 120); // low saturation
    filter(img);
    // Saturation increases -> the channels should spread further apart than they started.
    const spreadBefore = 140 - 120;
    const spreadAfter = Math.max(img.data[0], img.data[1], img.data[2]) - Math.min(img.data[0], img.data[1], img.data[2]);
    expect(spreadAfter).toBeGreaterThan(spreadBefore);
  });
});

describe('colorBalanceFilter', () => {
  it('is a no-op with all-neutral sliders', () => {
    const filter = colorBalanceFilter(NEUTRAL_COLOR_BALANCE);
    const img = onePixel(120, 130, 140);
    filter(img);
    expect(Array.from(img.data.slice(0, 3))).toEqual([120, 130, 140]);
  });

  it('shifts shadows toward red without touching a pure-highlight pixel', () => {
    const cb: AdjustmentLayerData['colorBalance'] = {
      ...NEUTRAL_COLOR_BALANCE,
      shadows: { cyanRed: 100, magentaGreen: 0, yellowBlue: 0 },
      preserveLuminosity: false,
    };
    const filter = colorBalanceFilter(cb);
    const shadowPixel = onePixel(10, 10, 10);
    filter(shadowPixel);
    expect(shadowPixel.data[0]).toBeGreaterThan(10);

    const highlightPixel = onePixel(250, 250, 250);
    filter(highlightPixel);
    expect(highlightPixel.data[0]).toBe(250); // shadow-only slider shouldn't move a highlight pixel
  });
});

describe('posterizeFilter', () => {
  it('quantizes to exactly N distinct output levels across the input range', () => {
    const filter = posterizeFilter(2);
    const outputs = new Set<number>();
    for (let v = 0; v <= 255; v += 5) {
      const img = onePixel(v, v, v);
      filter(img);
      outputs.add(img.data[0]);
    }
    expect(outputs.size).toBeLessThanOrEqual(2);
  });
});

describe('thresholdFilter', () => {
  it('sends below-threshold luminance to black and above to white', () => {
    const filter = thresholdFilter(128);
    const dark = onePixel(50, 50, 50); // luminance 50 < 128
    filter(dark);
    expect(Array.from(dark.data.slice(0, 3))).toEqual([0, 0, 0]);

    const light = onePixel(200, 200, 200); // luminance 200 >= 128
    filter(light);
    expect(Array.from(light.data.slice(0, 3))).toEqual([255, 255, 255]);
  });
});

describe('gradientMapFilter', () => {
  it('maps black-luminance pixels to the from-color and white-luminance pixels to the to-color', () => {
    const filter = gradientMapFilter({ r: 255, g: 0, b: 0 }, { r: 0, g: 0, b: 255 });
    const black = onePixel(0, 0, 0);
    filter(black);
    expect(Array.from(black.data.slice(0, 3))).toEqual([255, 0, 0]);

    const white = onePixel(255, 255, 255);
    filter(white);
    expect(Array.from(white.data.slice(0, 3))).toEqual([0, 0, 255]);
  });

  it('reverse swaps which end gets which color', () => {
    const filter = gradientMapFilter({ r: 255, g: 0, b: 0 }, { r: 0, g: 0, b: 255 }, false, true);
    const black = onePixel(0, 0, 0);
    filter(black);
    expect(Array.from(black.data.slice(0, 3))).toEqual([0, 0, 255]);
  });
});

describe('legacyBrightnessContrastFilter / modernBrightnessContrastFilter', () => {
  it('are both no-ops at brightness=0, contrast=0', () => {
    const legacy = legacyBrightnessContrastFilter(0, 0);
    const modern = modernBrightnessContrastFilter(0, 0);
    const a = onePixel(120, 130, 140);
    const b = onePixel(120, 130, 140);
    legacy(a); modern(b);
    expect(Array.from(a.data.slice(0, 3))).toEqual([120, 130, 140]);
    expect(Array.from(b.data.slice(0, 3))).toEqual([120, 130, 140]);
  });

  it('produce genuinely different results for the same non-zero brightness', () => {
    const legacy = legacyBrightnessContrastFilter(80, 0);
    const modern = modernBrightnessContrastFilter(80, 0);
    const a = onePixel(200, 200, 200);
    const b = onePixel(200, 200, 200);
    legacy(a); modern(b);
    expect(a.data[0]).not.toBe(b.data[0]);
  });
});

describe('hueBandWeights', () => {
  it('gives Reds full weight at hue=0 and ~zero weight at hue=180 (Cyans)', () => {
    const w = hueBandWeights(0);
    expect(w.reds).toBe(1);
    expect(w.cyans).toBe(0);
  });
});

describe('blackWhiteFilter', () => {
  it('produces a neutral gray pixel (R=G=B)', () => {
    const filter = blackWhiteFilter({ reds: 40, yellows: 60, greens: 40, cyans: 60, blues: 20, magentas: 80, tint: false, tintColor: '#000000' });
    const img = onePixel(200, 100, 50);
    filter(img);
    expect(img.data[0]).toBe(img.data[1]);
    expect(img.data[1]).toBe(img.data[2]);
  });

  it('leaves an already-neutral (gray) pixel unaffected by the sliders', () => {
    const filter = blackWhiteFilter({ reds: 300, yellows: -200, greens: 40, cyans: 60, blues: 20, magentas: 80, tint: false, tintColor: '#000000' });
    const img = onePixel(128, 128, 128);
    filter(img);
    expect(Array.from(img.data.slice(0, 3))).toEqual([128, 128, 128]);
  });
});

describe('invertFilter', () => {
  it('inverts each RGB channel, leaves alpha untouched', () => {
    const filter = invertFilter();
    const img = onePixel(0, 100, 255, 200);
    filter(img);
    expect(Array.from(img.data)).toEqual([255, 155, 0, 200]);
  });
});

describe('channelMixerFilter', () => {
  it('is the identity mix at 100/0/0, 0/100/0, 0/0/100 with no constant', () => {
    const filter = channelMixerFilter({
      monochrome: false,
      red: { red: 100, green: 0, blue: 0, constant: 0 },
      green: { red: 0, green: 100, blue: 0, constant: 0 },
      blue: { red: 0, green: 0, blue: 100, constant: 0 },
    });
    const img = onePixel(10, 20, 30);
    filter(img);
    expect(Array.from(img.data.slice(0, 3))).toEqual([10, 20, 30]);
  });

  it('monochrome collapses all three outputs to the red mix', () => {
    const filter = channelMixerFilter({
      monochrome: true,
      red: { red: 0, green: 0, blue: 100, constant: 0 },
      green: { red: 100, green: 0, blue: 0, constant: 0 },
      blue: { red: 0, green: 100, blue: 0, constant: 0 },
    });
    const img = onePixel(10, 20, 30);
    filter(img);
    expect(img.data[0]).toBe(30);
    expect(img.data[1]).toBe(30);
    expect(img.data[2]).toBe(30);
  });
});

describe('photoFilterFilter', () => {
  it('is a no-op at density=0', () => {
    const filter = photoFilterFilter('#ff0000', 0, false);
    const img = onePixel(100, 150, 200);
    filter(img);
    expect(Array.from(img.data.slice(0, 3))).toEqual([100, 150, 200]);
  });
});

describe('selectiveColorFilter', () => {
  it('is a no-op with every family at zero ink', () => {
    const colors = { reds: { cyan: 0, magenta: 0, yellow: 0, black: 0 }, yellows: { cyan: 0, magenta: 0, yellow: 0, black: 0 }, greens: { cyan: 0, magenta: 0, yellow: 0, black: 0 }, cyans: { cyan: 0, magenta: 0, yellow: 0, black: 0 }, blues: { cyan: 0, magenta: 0, yellow: 0, black: 0 }, magentas: { cyan: 0, magenta: 0, yellow: 0, black: 0 }, whites: { cyan: 0, magenta: 0, yellow: 0, black: 0 }, neutrals: { cyan: 0, magenta: 0, yellow: 0, black: 0 }, blacks: { cyan: 0, magenta: 0, yellow: 0, black: 0 } };
    const filter = selectiveColorFilter({ method: 'relative', colors });
    const img = onePixel(200, 100, 50);
    filter(img);
    expect(Array.from(img.data.slice(0, 3))).toEqual([200, 100, 50]);
  });
});

describe('shadowsHighlightsFilter', () => {
  it('is a no-op when both amounts are zero', () => {
    const filter = shadowsHighlightsFilter({ shadowsAmount: 0, shadowsTone: 50, shadowsRadius: 30, highlightsAmount: 0, highlightsTone: 50, highlightsRadius: 30, colorCorrection: 0, midtoneContrast: 0 });
    const img = solidBlock(4, 60, 60, 60);
    filter(img);
    for (let i = 0; i < img.data.length; i += 4) expect(img.data[i]).toBe(60);
  });

  it('lifts a uniformly dark block when shadowsAmount > 0', () => {
    const filter = shadowsHighlightsFilter({ shadowsAmount: 80, shadowsTone: 80, shadowsRadius: 10, highlightsAmount: 0, highlightsTone: 50, highlightsRadius: 30, colorCorrection: 0, midtoneContrast: 0 });
    const img = solidBlock(8, 40, 40, 40);
    filter(img);
    expect(img.data[0]).toBeGreaterThan(40);
  });
});

describe('hdrToningFilter', () => {
  it('is close to a no-op at strength=0, exposure=0, gamma=1', () => {
    const filter = hdrToningFilter({ edgeGlowRadius: 10, edgeGlowStrength: 0, gamma: 1, exposure: 0 });
    const img = solidBlock(4, 100, 100, 100);
    filter(img);
    expect(img.data[0]).toBe(100);
  });
});

describe('colorLookupFilter', () => {
  it('is the identity when no LUT is selected', () => {
    const filter = colorLookupFilter(null);
    const img = onePixel(50, 100, 150);
    filter(img);
    expect(Array.from(img.data.slice(0, 3))).toEqual([50, 100, 150]);
  });

  it('applies a real, non-identity transform for a selected built-in LUT', () => {
    const filter = colorLookupFilter('warm');
    const img = onePixel(100, 100, 100);
    filter(img);
    expect(Array.from(img.data.slice(0, 3))).not.toEqual([100, 100, 100]);
  });
});
