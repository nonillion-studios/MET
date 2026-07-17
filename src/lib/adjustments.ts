import type { AdjustmentLayerData } from '../components/studio/studioTypes';

/**
 * Konva-compatible custom filters (`(imageData: ImageData) => void`, mutating `.data` in place).
 * Hand-rolled instead of pulling in an image-processing dependency (Jimp etc.) — Konva already
 * ships the caching/filter pipeline, so this is a single pass over one already-allocated buffer,
 * the cheapest option on low-end/mobile devices.
 */

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

export function brightnessContrastFilter(brightness: number, contrast: number) {
  const b = clamp255(128 + brightness) - 128; // -100..100 -> additive offset
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

export function hueSaturationFilter(hue: number, saturation: number, lightness: number) {
  const satFactor = 1 + saturation / 100;
  const lightOffset = lightness / 200; // -100..100 -> -0.5..0.5
  return (imageData: ImageData) => {
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      const [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
      const nh = (h + hue + 360) % 360;
      const ns = Math.min(1, Math.max(0, s * satFactor));
      const nl = Math.min(1, Math.max(0, l + lightOffset));
      const [r, g, b] = hslToRgb(nh, ns, nl);
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
    }
  };
}

export function levelsFilter(inBlack: number, inWhite: number, gamma: number, outBlack: number, outWhite: number) {
  // Precompute a 256-entry lookup table once per filter instance instead of per-pixel math.
  const lut = new Uint8ClampedArray(256);
  const inRange = Math.max(1, inWhite - inBlack);
  const outRange = outWhite - outBlack;
  const invGamma = 1 / Math.max(0.01, gamma);
  for (let v = 0; v < 256; v++) {
    const normalized = Math.min(1, Math.max(0, (v - inBlack) / inRange));
    lut[v] = clamp255(outBlack + Math.pow(normalized, invGamma) * outRange);
  }
  return (imageData: ImageData) => {
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = lut[d[i]];
      d[i + 1] = lut[d[i + 1]];
      d[i + 2] = lut[d[i + 2]];
    }
  };
}

export function filterForAdjustment(data: AdjustmentLayerData): (imageData: ImageData) => void {
  switch (data.kind) {
    case 'brightness-contrast':
      return brightnessContrastFilter(data.brightness, data.contrast);
    case 'hue-saturation':
      return hueSaturationFilter(data.hue, data.saturation, data.lightness);
    case 'levels':
      return levelsFilter(data.levels.inBlack, data.levels.inWhite, data.levels.gamma, data.levels.outBlack, data.levels.outWhite);
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
