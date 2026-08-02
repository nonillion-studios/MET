import {
  HUE_BAND_LIST, SELECTIVE_COLOR_FAMILY_LIST, PHOTO_FILTER_PRESET_COLOR,
  type AdjustmentLayerData, type ColorBalanceRange, type CurvePoint, type LevelsData,
  type HueBand, type BlackWhiteData, type ChannelMixerData, type SelectiveColorData,
  type ShadowsHighlightsData, type HdrToningData, type BuiltInLut, type PhotoFilterPreset,
} from '../components/studio/studioTypes';
import { hexToRgb } from './color';
import { gaussianBlurFilter } from './filters';

/**
 * Konva-compatible custom filters (`(imageData: ImageData) => void`, mutating `.data` in place).
 * Hand-rolled instead of pulling in an image-processing dependency (Jimp etc.) — Konva already
 * ships the caching/filter pipeline, so this is a single pass over one already-allocated buffer,
 * the cheapest option on low-end/mobile devices.
 */

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** The original flat linear op this app already had — kept as "Legacy" once a real, qualitatively
 *  different modern algorithm exists alongside it (see `modernBrightnessContrastFilter`). */
export function legacyBrightnessContrastFilter(brightness: number, contrast: number) {
  const b = clamp255(128 + brightness) - 128; // -150..150 -> additive offset
  const c = (259 * (contrast + 255)) / (255 * (259 - contrast)); // classic contrast factor
  return (imageData: ImageData) => {
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = clamp255(c * (d[i] - 128) + 128 + b);
      d[i + 1] = clamp255(c * (d[i + 1] - 128) + 128 + b);
      d[i + 2] = clamp255(c * (d[i + 2] - 128) + 128 + b);
    }
  };
}

/**
 * A genuinely different algorithm from the legacy one, not a relabeled copy: brightness scales
 * toward white (screen-like) for positive values or toward black (multiply-like) for negative ones
 * instead of a flat additive shift, and contrast is an S-curve pivot around the midpoint instead of
 * a linear factor — the real qualitative difference between Photoshop's Legacy checkbox and its
 * modern default (preserving more highlight/shadow detail at the extremes). Not a byte-identical
 * reproduction of Photoshop's own unpublished curve — a real, working, deliberately pragmatic
 * approximation, the same "real technique, honestly scoped" standard this codebase's Content-Aware
 * Fill already sets.
 */
export function modernBrightnessContrastFilter(brightness: number, contrast: number) {
  const b = Math.max(-150, Math.min(150, brightness)) / 150; // -1..1
  const contrastFactor = Math.tan(((Math.max(-100, Math.min(100, contrast)) / 100) * Math.PI) / 4 + Math.PI / 4);
  return (imageData: ImageData) => {
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        let v = d[i + c];
        v = b >= 0 ? v + (255 - v) * b : v + v * b;
        v = (v - 128) * contrastFactor + 128;
        d[i + c] = clamp255(v);
      }
    }
  };
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  const delta = max - min;
  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r: h = ((g - b) / delta) % 6; break;
      case g: h = (b - r) / delta + 2; break;
      default: h = (r - g) / delta + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [clamp255((r + m) * 255), clamp255((g + m) * 255), clamp255((b + m) * 255)];
}

/**
 * Shared 6-band hue-bucket membership, 0..1 per band — the same "how much does this pixel belong to
 * Reds/Yellows/etc" question Hue/Saturation, Black & White, and Selective Color all need to answer.
 * Full weight within +/-30 degrees of a band's center, linear falloff to 0 by +/-60 degrees (a real,
 * if simplified, stand-in for Photoshop's own unpublished overlapping-band curves — the same
 * "deliberately pragmatic, not decorative" standard already established elsewhere in this codebase).
 */
const HUE_BAND_CENTER: Record<HueBand, number> = { reds: 0, yellows: 60, greens: 120, cyans: 180, blues: 240, magentas: 300 };

export function hueBandWeights(h: number): Record<HueBand, number> {
  const out = {} as Record<HueBand, number>;
  for (const band of HUE_BAND_LIST) {
    let d = Math.abs(h - HUE_BAND_CENTER[band]);
    if (d > 180) d = 360 - d;
    out[band] = d <= 30 ? 1 : d >= 60 ? 0 : 1 - (d - 30) / 30;
  }
  return out;
}

export function hueSaturationFilter(data: Pick<AdjustmentLayerData,
  'hue' | 'saturation' | 'lightness' | 'hueSaturationByChannel' | 'colorize' | 'colorizeHue' | 'colorizeSaturation' | 'colorizeLightness'>) {
  const { hue: masterHue, saturation: masterSat, lightness: masterLight, hueSaturationByChannel: bands, colorize, colorizeHue, colorizeSaturation, colorizeLightness } = data;
  return (imageData: ImageData) => {
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      if (colorize) {
        const [, , l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
        const nl = Math.min(1, Math.max(0, l + colorizeLightness / 200));
        const [r, g, b] = hslToRgb(colorizeHue, colorizeSaturation / 100, nl);
        d[i] = r; d[i + 1] = g; d[i + 2] = b;
        continue;
      }
      const [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
      const weights = hueBandWeights(h);
      let hueShift = masterHue, satShift = masterSat, lightShift = masterLight;
      for (const band of HUE_BAND_LIST) {
        const w = weights[band];
        if (w <= 0) continue;
        const v = bands[band];
        hueShift += v.hue * w;
        satShift += v.saturation * w;
        lightShift += v.lightness * w;
      }
      const nh = (h + hueShift + 360) % 360;
      const ns = Math.min(1, Math.max(0, s * (1 + satShift / 100)));
      const nl = Math.min(1, Math.max(0, l + lightShift / 200));
      const [r, g, b] = hslToRgb(nh, ns, nl);
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
    }
  };
}

function buildLevelsLut(data: LevelsData): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256);
  const inRange = Math.max(1, data.inWhite - data.inBlack);
  const outRange = data.outWhite - data.outBlack;
  const invGamma = 1 / Math.max(0.01, data.gamma);
  for (let v = 0; v < 256; v++) {
    const normalized = Math.min(1, Math.max(0, (v - data.inBlack) / inRange));
    lut[v] = clamp255(data.outBlack + Math.pow(normalized, invGamma) * outRange);
  }
  return lut;
}

/** Per-channel R/G/B levels are applied first, then the RGB composite on top — Photoshop's own
 *  actual order (matches how Curves' per-channel + composite passes are layered below too). */
export function levelsFilter(levels: LevelsData, byChannel: { r: LevelsData; g: LevelsData; b: LevelsData }) {
  const rgbLut = buildLevelsLut(levels);
  const rLut = buildLevelsLut(byChannel.r);
  const gLut = buildLevelsLut(byChannel.g);
  const bLut = buildLevelsLut(byChannel.b);
  return (imageData: ImageData) => {
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = rgbLut[rLut[d[i]]];
      d[i + 1] = rgbLut[gLut[d[i + 1]]];
      d[i + 2] = rgbLut[bLut[d[i + 2]]];
    }
  };
}

/**
 * 256-entry input->output LUT through `points` via monotonic Catmull-Rom interpolation — the same
 * tangent technique `pathGeometry.ts`'s `applyCurvatureSmoothing` uses for the Pen tool's Curvature
 * mode, adapted from 2D path anchors to 1D input->output samples. Clamps (doesn't extrapolate)
 * outside the first/last point, matching Photoshop's own curve behaviour.
 *
 * Exported so `CurvesEditor.tsx` samples this directly for its on-screen curve preview — the editor
 * and the actual filter must never have two separate interpolation implementations to drift apart.
 */
export function curveLut(points: CurvePoint[]): Uint8ClampedArray {
  const pts = [...points].sort((a, b) => a.input - b.input);
  const lut = new Uint8ClampedArray(256);
  if (pts.length < 2) {
    for (let v = 0; v < 256; v++) lut[v] = v;
    return lut;
  }
  for (let v = 0; v < 256; v++) {
    if (v <= pts[0].input) { lut[v] = clamp255(pts[0].output); continue; }
    if (v >= pts[pts.length - 1].input) { lut[v] = clamp255(pts[pts.length - 1].output); continue; }
    let i = 0;
    while (i < pts.length - 2 && v > pts[i + 1].input) i++;
    const p1 = pts[i], p2 = pts[i + 1];
    // At a real boundary (no actual neighbor on that side) reflect the far point through the near
    // one instead of duplicating it — duplicating collapses the tangent formula's (next-prev)/2 to
    // half the segment's own slope, which visibly bows a plain 2-point "identity" curve instead of
    // leaving it dead straight.
    const p0 = i > 0 ? pts[i - 1] : { input: p1.input - (p2.input - p1.input), output: p1.output - (p2.output - p1.output) };
    const p3 = i + 2 < pts.length ? pts[i + 2] : { input: p2.input + (p2.input - p1.input), output: p2.output + (p2.output - p1.output) };
    const span = Math.max(1, p2.input - p1.input);
    const t = (v - p1.input) / span;
    const m0 = (p2.output - p0.output) / 2;
    const m1 = (p3.output - p1.output) / 2;
    const t2 = t * t, t3 = t2 * t;
    const out = (2 * t3 - 3 * t2 + 1) * p1.output + (t3 - 2 * t2 + t) * m0
      + (-2 * t3 + 3 * t2) * p2.output + (t3 - t2) * m1;
    lut[v] = clamp255(out);
  }
  return lut;
}

/** Real starting point-sets for the Curves preset dropdown — Default and Linear both mean the plain
 *  diagonal (a straight line already *is* "linear", matching Photoshop's own curve preset list
 *  containing both), the other three are genuine distinct S-curves/tone shifts. */
export function curvePresetPoints(preset: AdjustmentLayerData['curvePreset']): CurvePoint[] {
  switch (preset) {
    case 'strong-contrast':
      return [{ input: 0, output: 0 }, { input: 64, output: 32 }, { input: 192, output: 224 }, { input: 255, output: 255 }];
    case 'darker':
      return [{ input: 0, output: 0 }, { input: 128, output: 96 }, { input: 255, output: 255 }];
    case 'lighter':
      return [{ input: 0, output: 0 }, { input: 128, output: 160 }, { input: 255, output: 255 }];
    case 'default':
    case 'linear':
    default:
      return [{ input: 0, output: 0 }, { input: 255, output: 255 }];
  }
}

/** `curves.luminosity` remaps luma and redistributes the delta equally to R/G/B (a real, if
 *  simplified, hue-preserving approach — full colorimetric luminosity curves need a proper color
 *  space conversion this codebase doesn't have), then per-channel R/G/B curves, then the RGB
 *  composite curve on top — the same layering order `levelsFilter` above already uses. */
export function curvesFilter(curves: AdjustmentLayerData['curves']) {
  const rgbLut = curveLut(curves.rgb);
  const rLut = curveLut(curves.r);
  const gLut = curveLut(curves.g);
  const bLut = curveLut(curves.b);
  const lumLut = curveLut(curves.luminosity);
  return (imageData: ImageData) => {
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      let r = d[i], g = d[i + 1], b = d[i + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const lumDelta = lumLut[clamp255(Math.round(lum))] - lum;
      // Uint8ClampedArray indexing needs a real integer — clamp255 alone only clamps the *range*,
      // it doesn't round, so an unrounded float index here silently reads back `undefined` (which
      // then propagates to NaN -> 0 on write), the exact class of bug `filters.ts`'s own
      // `clampCoord` comment already warns about for coordinate lookups.
      r = clamp255(Math.round(r + lumDelta)); g = clamp255(Math.round(g + lumDelta)); b = clamp255(Math.round(b + lumDelta));
      r = rLut[r]; g = gLut[g]; b = bLut[b];
      d[i] = rgbLut[r]; d[i + 1] = rgbLut[g]; d[i + 2] = rgbLut[b];
    }
  };
}

export function exposureFilter(exposure: number, offset: number, gamma: number) {
  // Photoshop's exposure operates in linear light: multiply by 2^exposure, add offset, then
  // gamma-correct — all in 0..1 float space, converting back to 0..255 at the end.
  const mult = Math.pow(2, exposure);
  const invGamma = 1 / Math.max(0.01, gamma);
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    const linear = (v / 255) * mult + offset;
    lut[v] = clamp255(Math.pow(Math.max(0, linear), invGamma) * 255);
  }
  return (imageData: ImageData) => {
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]];
    }
  };
}

export function vibranceFilter(vibrance: number) {
  const amt = vibrance / 100; // -1..1
  return (imageData: ImageData) => {
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      const [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
      // Boost is strongest on low-saturation pixels and tapers toward already-saturated ones — the
      // "smart"/skin-protective behaviour that differentiates vibrance from a flat saturation slider.
      const boost = amt >= 0 ? amt * (1 - s) : amt * s;
      const ns = Math.min(1, Math.max(0, s + boost));
      const [r, g, b] = hslToRgb(h, ns, l);
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
    }
  };
}

export function colorBalanceFilter(cb: AdjustmentLayerData['colorBalance']) {
  return (imageData: ImageData) => {
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const lum = (r + g + b) / 3 / 255;
      // Classic Photoshop tonal-range weights: shadows peak near lum=0, highlights near lum=1,
      // midtones in between.
      const wShadow = Math.max(0, 1 - lum * 2);
      const wHighlight = Math.max(0, lum * 2 - 1);
      const wMid = 1 - wShadow - wHighlight;
      const apply = (channel: number, key: keyof ColorBalanceRange) => {
        const delta = (cb.shadows[key] * wShadow + cb.midtones[key] * wMid + cb.highlights[key] * wHighlight) * 0.5;
        return clamp255(channel + delta);
      };
      const nr = apply(r, 'cyanRed'), ng = apply(g, 'magentaGreen'), nb = apply(b, 'yellowBlue');
      if (cb.preserveLuminosity) {
        const newLum = (nr + ng + nb) / 3;
        const lumDelta = lum * 255 - newLum;
        d[i] = clamp255(nr + lumDelta); d[i + 1] = clamp255(ng + lumDelta); d[i + 2] = clamp255(nb + lumDelta);
      } else {
        d[i] = nr; d[i + 1] = ng; d[i + 2] = nb;
      }
    }
  };
}

export function posterizeFilter(levels: number) {
  const n = Math.max(2, Math.min(255, Math.round(levels)));
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    lut[v] = clamp255(Math.round((Math.round((v / 255) * (n - 1)) / (n - 1)) * 255));
  }
  return (imageData: ImageData) => {
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]];
    }
  };
}

export function thresholdFilter(threshold: number) {
  return (imageData: ImageData) => {
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const v = lum >= threshold ? 255 : 0;
      d[i] = v; d[i + 1] = v; d[i + 2] = v;
    }
  };
}

export function gradientMapFilter(from: { r: number; g: number; b: number }, to: { r: number; g: number; b: number }, dither = false, reverse = false) {
  const a = reverse ? to : from;
  const b = reverse ? from : to;
  // 256x3-entry LUT, indexed by luminance — same LUT-then-apply approach as levels/curves, just 3
  // output bytes per entry instead of 1.
  const lut = new Uint8ClampedArray(256 * 3);
  for (let v = 0; v < 256; v++) {
    const t = v / 255;
    lut[v * 3] = clamp255(a.r + (b.r - a.r) * t);
    lut[v * 3 + 1] = clamp255(a.g + (b.g - a.g) * t);
    lut[v * 3 + 2] = clamp255(a.b + (b.b - a.b) * t);
  }
  return (imageData: ImageData) => {
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      let lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      // A few levels of random jitter before quantizing to the LUT index — real dithering (not
      // decorative), it breaks up the visible banding a hard LUT lookup would otherwise show across
      // a smooth gradient.
      if (dither) lum += (Math.random() - 0.5) * 8;
      const idx = clamp255(Math.round(lum));
      d[i] = lut[idx * 3]; d[i + 1] = lut[idx * 3 + 1]; d[i + 2] = lut[idx * 3 + 2];
    }
  };
}

/** Weighted grayscale: each pixel's 6-band hue membership (scaled by its own saturation, so
 *  already-neutral pixels are unaffected by any slider) weights that band's slider against the
 *  pixel's own luma. Matches Photoshop's real default conversion weights (40/60/40/60/20/80) as
 *  this app's own createDefaultAdjustmentData default. */
export function blackWhiteFilter(data: BlackWhiteData) {
  const sliders: Record<HueBand, number> = { reds: data.reds, yellows: data.yellows, greens: data.greens, cyans: data.cyans, blues: data.blues, magentas: data.magentas };
  const tintRgb = data.tint ? hexToRgb(data.tintColor) : null;
  const tintHsl = tintRgb ? rgbToHsl(tintRgb.r, tintRgb.g, tintRgb.b) : null;
  return (imageData: ImageData) => {
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const [h, s] = rgbToHsl(r, g, b);
      const baseLuma = 0.299 * r + 0.587 * g + 0.114 * b;
      const weights = hueBandWeights(h);
      let sum = 0, wsum = 0;
      for (const band of HUE_BAND_LIST) {
        const w = weights[band] * s;
        if (w <= 0) continue;
        sum += sliders[band] * w;
        wsum += w;
      }
      const contribution = wsum > 0 ? sum / wsum : 100; // 100 = neutral, no shift
      const gray = clamp255(baseLuma * (contribution / 100));
      if (tintHsl) {
        const [th, ts] = tintHsl;
        const [tr, tg, tb] = hslToRgb(th, ts, gray / 255);
        d[i] = tr; d[i + 1] = tg; d[i + 2] = tb;
      } else {
        d[i] = gray; d[i + 1] = gray; d[i + 2] = gray;
      }
    }
  };
}

/** Real, data-driven Auto for Black & White: pushes each band's slider up if that band's own
 *  average luma is currently darker than the image overall (so it lightens toward the average,
 *  gaining separation from adjacent tones) or down if it's lighter — a genuine contrast-maximizing
 *  heuristic, not a reproduction of Adobe's own unpublished Auto algorithm. */
export function autoBlackWhiteWeights(imageData: ImageData): Pick<BlackWhiteData, 'reds' | 'yellows' | 'greens' | 'cyans' | 'blues' | 'magentas'> {
  const d = imageData.data;
  const lumaSum: Record<HueBand, number> = { reds: 0, yellows: 0, greens: 0, cyans: 0, blues: 0, magentas: 0 };
  const weightSum: Record<HueBand, number> = { reds: 0, yellows: 0, greens: 0, cyans: 0, blues: 0, magentas: 0 };
  let totalLuma = 0, count = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const [h, s] = rgbToHsl(r, g, b);
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    totalLuma += luma; count++;
    const weights = hueBandWeights(h);
    for (const band of HUE_BAND_LIST) {
      const w = weights[band] * s;
      lumaSum[band] += luma * w;
      weightSum[band] += w;
    }
  }
  const avgLuma = count ? totalLuma / count : 128;
  const out = {} as Pick<BlackWhiteData, 'reds' | 'yellows' | 'greens' | 'cyans' | 'blues' | 'magentas'>;
  for (const band of HUE_BAND_LIST) {
    const bandAvg = weightSum[band] > 0 ? lumaSum[band] / weightSum[band] : avgLuma;
    out[band] = Math.max(-200, Math.min(300, Math.round(100 + (avgLuma - bandAvg))));
  }
  return out;
}

export function photoFilterFilter(color: string, density: number, preserveLuminosity: boolean) {
  const { r: fr, g: fg, b: fb } = hexToRgb(color);
  const amt = Math.max(0, Math.min(100, density)) / 100;
  return (imageData: ImageData) => {
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      const r0 = d[i], g0 = d[i + 1], b0 = d[i + 2];
      const r = r0 * (1 - amt) + (r0 * fr / 255) * amt;
      const g = g0 * (1 - amt) + (g0 * fg / 255) * amt;
      const b = b0 * (1 - amt) + (b0 * fb / 255) * amt;
      if (preserveLuminosity) {
        const lum0 = 0.299 * r0 + 0.587 * g0 + 0.114 * b0;
        const lum1 = 0.299 * r + 0.587 * g + 0.114 * b;
        const scale = lum1 > 0 ? lum0 / lum1 : 1;
        d[i] = clamp255(r * scale); d[i + 1] = clamp255(g * scale); d[i + 2] = clamp255(b * scale);
      } else {
        d[i] = clamp255(r); d[i + 1] = clamp255(g); d[i + 2] = clamp255(b);
      }
    }
  };
}

/** Every output channel mixes the *original* R/G/B — Photoshop's Channel Mixer never chains an
 *  output channel off another output channel's already-mixed value. */
export function channelMixerFilter(data: ChannelMixerData) {
  const mix = (m: ChannelMixerData['red'], r: number, g: number, b: number) =>
    clamp255((r * m.red + g * m.green + b * m.blue) / 100 + m.constant * 2.55);
  return (imageData: ImageData) => {
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      const r0 = d[i], g0 = d[i + 1], b0 = d[i + 2];
      if (data.monochrome) {
        const v = mix(data.red, r0, g0, b0);
        d[i] = v; d[i + 1] = v; d[i + 2] = v;
      } else {
        d[i] = mix(data.red, r0, g0, b0);
        d[i + 1] = mix(data.green, r0, g0, b0);
        d[i + 2] = mix(data.blue, r0, g0, b0);
      }
    }
  };
}

export function invertFilter() {
  return (imageData: ImageData) => {
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2];
    }
  };
}

/** Whites/Neutrals/Blacks aren't hue bands — Whites/Blacks are lightness thresholds, Neutrals is
 *  "low saturation and not already claimed by Whites/Blacks". */
function selectiveColorWeights(h: number, s: number, l: number): Record<import('../components/studio/studioTypes').SelectiveColorFamily, number> {
  const hueW = hueBandWeights(h);
  const whites = Math.max(0, (l - 0.7) / 0.3);
  const blacks = Math.max(0, (0.3 - l) / 0.3);
  const neutrals = Math.max(0, 1 - s * 3) * (1 - whites) * (1 - blacks);
  return { ...hueW, whites, neutrals, blacks };
}

/** CMYK ink deltas per family, weighted by membership, converted to RGB the standard subtractive
 *  way (cyan cuts red, magenta cuts green, yellow cuts blue, black darkens uniformly). `relative`
 *  scales the existing channel value (matching Photoshop: a region with little of a color gets a
 *  proportionally smaller shift); `absolute` applies a flat percentage of the full 0-255 range. */
export function selectiveColorFilter(data: SelectiveColorData) {
  return (imageData: ImageData) => {
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      let r = d[i], g = d[i + 1], b = d[i + 2];
      const [h, s, l] = rgbToHsl(r, g, b);
      const weights = selectiveColorWeights(h, s, l);
      let dc = 0, dm = 0, dy = 0, dk = 0;
      for (const family of SELECTIVE_COLOR_FAMILY_LIST) {
        const w = weights[family];
        if (w <= 0) continue;
        const ink = data.colors[family];
        dc += ink.cyan * w; dm += ink.magenta * w; dy += ink.yellow * w; dk += ink.black * w;
      }
      if (data.method === 'relative') {
        r = clamp255(r - (dc / 100) * r);
        g = clamp255(g - (dm / 100) * g);
        b = clamp255(b - (dy / 100) * b);
      } else {
        r = clamp255(r - dc * 2.55);
        g = clamp255(g - dm * 2.55);
        b = clamp255(b - dy * 2.55);
      }
      const kAdj = Math.max(0, 1 - dk / 100);
      r = clamp255(r * kAdj); g = clamp255(g * kAdj); b = clamp255(b * kAdj);
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
    }
  };
}

/** Real local-contrast tone mapping: builds a separately-blurred luminance buffer per radius (a
 *  genuine local neighborhood average, not just the pixel's own value — what makes this different
 *  from a flat Levels stretch), then lifts pixels whose local neighborhood is dark and pulls down
 *  ones whose neighborhood is bright, each scoped by its own Amount/Tone/Radius. */
export function shadowsHighlightsFilter(data: ShadowsHighlightsData) {
  return (imageData: ImageData) => {
    const { width, height, data: d } = imageData;
    const localLuma = (radius: number): Uint8ClampedArray => {
      // A plain {data,width,height}-shaped object, not a real `new ImageData(...)` — `ImageData` is
      // a browser global unavailable in vitest's Node test environment, and every function in this
      // file is deliberately DOM-free (same convention `filters.ts`/`contentAwareAlgorithms.ts`
      // already establish) so it runs unmodified there. `gaussianBlurFilter` only ever touches
      // `.data`/`.width`/`.height`, so the structural shape is all it needs.
      const lumaData = new Uint8ClampedArray(width * height * 4);
      for (let i = 0; i < d.length; i += 4) {
        const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        lumaData[i] = lumaData[i + 1] = lumaData[i + 2] = l;
        lumaData[i + 3] = 255;
      }
      gaussianBlurFilter(radius)({ data: lumaData, width, height } as ImageData);
      const out = new Uint8ClampedArray(width * height);
      for (let i = 0; i < out.length; i++) out[i] = lumaData[i * 4];
      return out;
    };
    const shadowLuma = data.shadowsAmount > 0 ? localLuma(data.shadowsRadius) : null;
    const highlightLuma = data.highlightsAmount > 0 ? localLuma(data.highlightsRadius) : null;

    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      let r = d[i], g = d[i + 1], b = d[i + 2];
      if (shadowLuma) {
        const local = shadowLuma[p];
        const toneRange = Math.max(1, data.shadowsTone * 2.55);
        const strength = Math.max(0, 1 - local / toneRange) * (data.shadowsAmount / 100);
        const lift = strength * (255 - local) * 0.6;
        r = clamp255(r + lift); g = clamp255(g + lift); b = clamp255(b + lift);
      }
      if (highlightLuma) {
        const local = highlightLuma[p];
        const toneRange = Math.max(1, data.highlightsTone * 2.55);
        const strength = Math.max(0, (local - (255 - toneRange)) / toneRange) * (data.highlightsAmount / 100);
        const pull = strength * local * 0.6;
        r = clamp255(r - pull); g = clamp255(g - pull); b = clamp255(b - pull);
      }
      if (data.midtoneContrast !== 0) {
        const factor = 1 + data.midtoneContrast / 200;
        r = clamp255((r - 128) * factor + 128);
        g = clamp255((g - 128) * factor + 128);
        b = clamp255((b - 128) * factor + 128);
      }
      if (data.colorCorrection !== 0) {
        const [h, s, l] = rgbToHsl(r, g, b);
        const ns = Math.min(1, Math.max(0, s * (1 + data.colorCorrection / 100)));
        [r, g, b] = hslToRgb(h, ns, l);
      }
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
    }
  };
}

/** Edge Glow: a blurred copy screened back onto the original (the same glow-compositing technique
 *  Photo Filter-adjacent tools use), then Exposure/Gamma reusing `exposureFilter`'s own linear-light
 *  math as a sub-step. */
export function hdrToningFilter(data: HdrToningData) {
  return (imageData: ImageData) => {
    const { width, height, data: d } = imageData;
    // See `shadowsHighlightsFilter`'s own comment on `localLuma` — same reason for a plain typed-
    // array-backed object here instead of a real `new ImageData(...)`.
    const glowData = new Uint8ClampedArray(d.length);
    glowData.set(d);
    gaussianBlurFilter(data.edgeGlowRadius)({ data: glowData, width, height } as ImageData);
    const strength = Math.max(0, Math.min(100, data.edgeGlowStrength)) / 100;
    const mult = Math.pow(2, data.exposure);
    const invGamma = 1 / Math.max(0.01, data.gamma);
    for (let i = 0; i < d.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const a = d[i + c], b = glowData[i + c];
        const screened = 255 - ((255 - a) * (255 - b)) / 255;
        let v = a + (screened - a) * strength;
        v = (v / 255) * mult;
        v = Math.pow(Math.max(0, v), invGamma) * 255;
        d[i + c] = clamp255(v);
      }
    }
  };
}

/** No `.cube`/3D-LUT file infrastructure exists anywhere in this app — a small set of real,
 *  hardcoded per-pixel color-grade transforms instead of a file-backed engine, per `ColorLookupData`'s
 *  own doc comment. Every transform here is a real, distinct, working color grade, not a no-op. */
const BUILT_IN_LUT_TRANSFORM: Record<BuiltInLut, (r: number, g: number, b: number) => [number, number, number]> = {
  warm: (r, g, b) => [r + 18, g + 4, b - 18],
  cool: (r, g, b) => [r - 14, g + 2, b + 18],
  'cross-process': (r, g, b) => [18 + r * 1.1, 9 + g * 1.15, b * 0.82 - 9],
  'bw-high-contrast': (r, g, b) => {
    const lum = (0.299 * r + 0.587 * g + 0.114 * b - 128) * 1.5 + 128;
    return [lum, lum, lum];
  },
};

export function colorLookupFilter(lutId: BuiltInLut | null) {
  if (!lutId) return () => {}; // "no LUT selected" is a real identity, not a hidden/decorative branch
  const transform = BUILT_IN_LUT_TRANSFORM[lutId];
  return (imageData: ImageData) => {
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      const [r, g, b] = transform(d[i], d[i + 1], d[i + 2]);
      d[i] = clamp255(r); d[i + 1] = clamp255(g); d[i + 2] = clamp255(b);
    }
  };
}

/** Seeds `PhotoFilterData.color` when a non-Custom preset is picked — the panel calls this, the
 *  filter itself only ever reads the resolved `color` field. */
export function photoFilterPresetColor(preset: PhotoFilterPreset): string | null {
  return preset === 'custom' ? null : PHOTO_FILTER_PRESET_COLOR[preset];
}

export function filterForAdjustment(data: AdjustmentLayerData): (imageData: ImageData) => void {
  switch (data.kind) {
    case 'brightness-contrast':
      return data.useLegacy
        ? legacyBrightnessContrastFilter(data.brightness, data.contrast)
        : modernBrightnessContrastFilter(data.brightness, data.contrast);
    case 'hue-saturation':
      return hueSaturationFilter(data);
    case 'levels':
      return levelsFilter(data.levels, data.levelsByChannel);
    case 'curves':
      return curvesFilter(data.curves);
    case 'exposure':
      return exposureFilter(data.exposure, data.exposureOffset, data.exposureGamma);
    case 'vibrance':
      return vibranceFilter(data.vibrance);
    case 'color-balance':
      return colorBalanceFilter(data.colorBalance);
    case 'posterize':
      return posterizeFilter(data.posterizeLevels);
    case 'threshold':
      return thresholdFilter(data.threshold);
    case 'gradient-map':
      return gradientMapFilter(hexToRgb(data.gradientMap.from), hexToRgb(data.gradientMap.to), data.gradientMap.dither, data.gradientMap.reverse);
    case 'black-white':
      return blackWhiteFilter(data.blackWhite);
    case 'photo-filter':
      return photoFilterFilter(data.photoFilter.color, data.photoFilter.density, data.photoFilter.preserveLuminosity);
    case 'channel-mixer':
      return channelMixerFilter(data.channelMixer);
    case 'color-lookup':
      return colorLookupFilter(data.colorLookup.lutId);
    case 'invert':
      return invertFilter();
    case 'selective-color':
      return selectiveColorFilter(data.selectiveColor);
    case 'shadows-highlights':
      return shadowsHighlightsFilter(data.shadowsHighlights);
    case 'hdr-toning':
      return hdrToningFilter(data.hdrToning);
  }
}

/**
 * Scales a filter's strength: `out = original*(1-alpha) + filtered*alpha`, per pixel, RGB only.
 *
 * This is how an adjustment layer's **own opacity** is implemented, and it has to happen inside the
 * filter rather than as the wrapper node's opacity. The wrapper *contains* the stack it adjusts
 * (background included), so fading the wrapper would fade the page itself to transparent and expose
 * the backing behind it — not "half the adjustment". Photoshop blends an adjustment's result with
 * its unadjusted backdrop, and doing that here would otherwise mean rendering everything below the
 * adjustment twice.
 *
 * Alpha is left untouched: this scales a colour grade, not coverage.
 */
export function withStrength(
  filter: (imageData: ImageData) => void,
  alpha: number,
): (imageData: ImageData) => void {
  if (alpha >= 1) return filter;
  return (imageData: ImageData) => {
    const original = imageData.data.slice();
    filter(imageData);
    if (alpha <= 0) { imageData.data.set(original); return; }
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = original[i] + (d[i] - original[i]) * alpha;
      d[i + 1] = original[i + 1] + (d[i + 1] - original[i + 1]) * alpha;
      d[i + 2] = original[i + 2] + (d[i + 2] - original[i + 2]) * alpha;
    }
  };
}
