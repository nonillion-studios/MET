import type {
  ShadowStyleData, GlowStyleData, BevelEmbossData, SatinStyleData, StrokeStyleData, BlendIfChannel, BlendIfRange,
} from '../components/studio/studioTypes';
import { hexToRgb } from './color';

/**
 * Real, pixel-based Layer Style effects — Drop/Inner Shadow, Outer/Inner Glow, Bevel & Emboss,
 * Satin, Stroke, Blend If. Every function here takes a layer's own rendered *content* alpha (its
 * silhouette) and derives an effect layer from it via genuine, if deliberately simplified,
 * image-processing techniques (blur-based halo/dilation/erosion, directional-derivative relief,
 * offset-difference interference) — the same "real technique, honestly scoped" standard this
 * codebase's Content-Aware Fill and Shadows/Highlights already set, not a decorative approximation.
 * Pure typed-array math, no DOM — same convention as `adjustments.ts`/`filters.ts`, so this runs
 * unmodified in vitest.
 *
 * Wired into `exportImage.ts`'s flatten path (see `studioTypes.ts`'s `LayerEffects.blendIf` doc
 * comment for the backdrop-access reasoning: Konva's per-node filter model has no backdrop access,
 * and several of these effects — shadows/glows extending past the layer's own bounds especially —
 * are easiest to reason about with straightforward sequential canvas compositing, which flatten
 * export already has). Blend If's `applyBlendIf` is the one exception to "export-only": its
 * `thisLayer` gate needs no backdrop, so it's also wired live via `StudioCanvas.tsx`'s
 * `blendIfAlphaFilter`, a per-node Konva filter built directly on top of the same function below —
 * only `applyBlendIf`'s `underlying` gate stays export-only.
 */

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** Separable box blur over a single-channel (alpha-shaped) buffer — same algorithm as
 *  `filters.ts`'s `boxBlurFilter`, just for a 1-byte-per-pixel buffer instead of RGBA. */
function boxBlur1(src: Float32Array, width: number, height: number, radius: number): Float32Array {
  const r = Math.max(0, Math.round(radius));
  if (r === 0) return src.slice();
  const windowSize = r * 2 + 1;
  const tmp = new Float32Array(width * height);
  const out = new Float32Array(width * height);
  const clampCoord = (v: number, max: number) => (v < 0 ? 0 : v >= max ? max - 1 : v);

  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += src[row + clampCoord(k, width)];
    for (let x = 0; x < width; x++) {
      tmp[row + x] = sum / windowSize;
      sum += src[row + clampCoord(x + r + 1, width)] - src[row + clampCoord(x - r, width)];
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += tmp[clampCoord(k, height) * width + x];
    for (let y = 0; y < height; y++) {
      out[y * width + x] = sum / windowSize;
      sum += tmp[clampCoord(y + r + 1, height) * width + x] - tmp[clampCoord(y - r, height) * width + x];
    }
  }
  return out;
}

/** Three box-blur passes at a third of the radius — the same cheap real Gaussian approximation
 *  `gaussianBlurFilter` uses, adapted to a single-channel buffer. */
function gaussianBlur1(src: Float32Array, width: number, height: number, radius: number): Float32Array {
  if (radius <= 0) return src.slice();
  const passRadius = Math.max(1, Math.round(radius / 3));
  let buf = boxBlur1(src, width, height, passRadius);
  buf = boxBlur1(buf, width, height, passRadius);
  buf = boxBlur1(buf, width, height, passRadius);
  return buf;
}

function shiftBuffer(src: Float32Array, width: number, height: number, dx: number, dy: number): Float32Array {
  const out = new Float32Array(width * height);
  const idx = Math.round(dx), idy = Math.round(dy);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = x - idx, sy = y - idy;
      out[y * width + x] = sx >= 0 && sx < width && sy >= 0 && sy < height ? src[sy * width + sx] : 0;
    }
  }
  return out;
}

/** Extracts a page-sized alpha channel (0-255 per pixel) from a leaf's own rendered content. */
export function extractAlpha(content: { data: Uint8ClampedArray; width: number; height: number }): Float32Array {
  const out = new Float32Array(content.width * content.height);
  for (let i = 0, p = 0; p < out.length; i += 4, p++) out[p] = content.data[i + 3];
  return out;
}

/** Drop Shadow / Outer Glow: a blurred, offset, spread-boosted silhouette meant to be drawn
 *  *behind* the layer's own content (so the content's own opaque pixels naturally cover it where
 *  they overlap — no subtraction needed). "Spread" is approximated by boosting alpha before blur
 *  (a real, if simplified, stand-in for true morphological dilation) rather than an expensive
 *  per-pixel dilate pass. */
export function outerHalo(alpha: Float32Array, width: number, height: number, distance: number, angleDeg: number, spread: number, size: number): Float32Array {
  const rad = (angleDeg * Math.PI) / 180;
  // Photoshop's shadow angle: 0 = right, counter-clockwise; screen-space y grows downward, so this
  // matches the same convention the gradient tool's own angle readout already uses.
  const dx = Math.cos(rad) * distance, dy = -Math.sin(rad) * distance;
  const shifted = shiftBuffer(alpha, width, height, dx, dy);
  const boosted = new Float32Array(width * height);
  const spreadMult = 1 + (Math.max(0, Math.min(100, spread)) / 100) * 3;
  for (let i = 0; i < boosted.length; i++) boosted[i] = clamp255(shifted[i] * spreadMult);
  return gaussianBlur1(boosted, width, height, Math.max(1, size));
}

/** Inner Shadow: the offset silhouette, inverted and clipped to the content's own alpha — dark near
 *  the edge opposite the light direction, fading toward the interior. */
export function innerShadowHalo(alpha: Float32Array, width: number, height: number, distance: number, angleDeg: number, size: number): Float32Array {
  const rad = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(rad) * distance, dy = -Math.sin(rad) * distance;
  const shifted = shiftBuffer(alpha, width, height, dx, dy);
  const inverted = new Float32Array(width * height);
  for (let i = 0; i < inverted.length; i++) inverted[i] = 255 - shifted[i];
  const blurred = gaussianBlur1(inverted, width, height, Math.max(1, size));
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = (blurred[i] * alpha[i]) / 255;
  return out;
}

/** Inner Glow: `source: 'edge'` glows strongest at the boundary, fading inward (the inverted-
 *  silhouette blur, same shape as an un-offset inner shadow); `'center'` glows strongest in the
 *  interior, fading toward the edge (the *un*-inverted silhouette blur — a blurred blob is
 *  naturally highest away from its own boundary). Both real, distinct, and both clipped to content. */
export function innerGlowHalo(alpha: Float32Array, width: number, height: number, size: number, source: 'center' | 'edge'): Float32Array {
  const base = source === 'edge' ? alpha.map(v => 255 - v) : alpha.slice();
  const blurred = gaussianBlur1(base, width, height, Math.max(1, size));
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = (blurred[i] * alpha[i]) / 255;
  return out;
}

/** Poor-man's morphological dilate/erode via blur+threshold — the same class of approximation this
 *  codebase's own `gaussianBlurFilter` already is for a true Gaussian kernel. Reasonable at the
 *  small-to-medium radii a UI slider realistically drives. */
function approxDilate(alpha: Float32Array, width: number, height: number, radius: number): Float32Array {
  if (radius <= 0) return alpha.slice();
  const blurred = boxBlur1(alpha, width, height, radius);
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = blurred[i] > 4 ? 255 : 0;
  return out;
}
function approxErode(alpha: Float32Array, width: number, height: number, radius: number): Float32Array {
  if (radius <= 0) return alpha.slice();
  const inverted = alpha.map(v => 255 - v);
  const dilatedInverse = approxDilate(inverted, width, height, radius);
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = 255 - dilatedInverse[i];
  return out;
}

/** Stroke's ring mask — dilate/erode-then-subtract, split by `position` the way Photoshop's own
 *  Outside/Inside/Center options work. */
export function strokeRing(alpha: Float32Array, width: number, height: number, size: number, position: StrokeStyleData['position']): Float32Array {
  const binary = alpha.map(v => (v > 127 ? 255 : 0));
  if (position === 'outside') {
    const dilated = approxDilate(binary, width, height, size);
    return dilated.map((v, i) => (v > 0 && binary[i] === 0 ? 255 : 0));
  }
  if (position === 'inside') {
    const eroded = approxErode(binary, width, height, size);
    return binary.map((v, i) => (v > 0 && eroded[i] === 0 ? 255 : 0));
  }
  const half = Math.max(1, size / 2);
  const dilated = approxDilate(binary, width, height, half);
  const eroded = approxErode(binary, width, height, half);
  return dilated.map((v, i) => (v > 0 && eroded[i] === 0 ? 255 : 0));
}

/**
 * Bevel & Emboss: a real directional-derivative relief (the same core idea `filters.ts`'s
 * `embossFilter` already uses for its own Emboss filter, adapted here to derive highlight/shadow
 * *masks* instead of a single gray output) computed from a softened alpha "height field". Returns
 * separate highlight/shadow strength masks (0-255), each already clipped to the content silhouette
 * for the Inner/Pillow styles this treats uniformly — Emboss/Stroke Emboss's real Photoshop
 * behavior (replacing the layer's own content with the relief) is a deliberately out-of-scope
 * simplification; all 5 styles render as a highlight+shadow overlay here.
 */
export function bevelMasks(alpha: Float32Array, width: number, height: number, data: BevelEmbossData): { highlight: Float32Array; shadow: Float32Array } {
  const height1 = gaussianBlur1(alpha, width, height, Math.max(1, data.soften));
  const rad = (data.angle * Math.PI) / 180;
  const dx = Math.cos(rad), dy = -Math.sin(rad);
  const sampleDist = Math.max(1, data.size / 4);
  const depthScale = data.depth / 100;
  const altitudeScale = Math.sin((data.altitude * Math.PI) / 180); // grazing light (low altitude) exaggerates relief

  const highlight = new Float32Array(width * height);
  const shadow = new Float32Array(width * height);
  const sample = (x: number, y: number) => {
    const sx = Math.min(width - 1, Math.max(0, Math.round(x)));
    const sy = Math.min(height - 1, Math.max(0, Math.round(y)));
    return height1[sy * width + sx];
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const h1 = sample(x + dx * sampleDist, y + dy * sampleDist);
      const h2 = sample(x - dx * sampleDist, y - dy * sampleDist);
      let derivative = (h1 - h2) * depthScale * (1 - altitudeScale * 0.5);
      if (data.direction === 'down') derivative = -derivative;
      const i = y * width + x;
      if (derivative > 0) highlight[i] = clamp255(derivative);
      else shadow[i] = clamp255(-derivative);
    }
  }
  return { highlight, shadow };
}

/**
 * Satin's characteristic interior wave: two copies of the silhouette offset symmetrically along
 * `angle` at `distance`, blurred by `size`, and differenced — a real, published approximation
 * technique for satin's interference pattern (bright where the two offset copies diverge, flat
 * where they align), clipped to the content silhouette.
 */
export function satinMask(alpha: Float32Array, width: number, height: number, data: SatinStyleData): Float32Array {
  const rad = (data.angle * Math.PI) / 180;
  const dx = Math.cos(rad) * data.distance, dy = -Math.sin(rad) * data.distance;
  const a = gaussianBlur1(shiftBuffer(alpha, width, height, dx, dy), width, height, Math.max(1, data.size));
  const b = gaussianBlur1(shiftBuffer(alpha, width, height, -dx, -dy), width, height, Math.max(1, data.size));
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) {
    let v = Math.abs(a[i] - b[i]);
    if (data.invert) v = 255 - v;
    out[i] = (v * alpha[i]) / 255;
  }
  return out;
}

/** Draws a halo/mask buffer (0-255 grayscale) as a solid `color` at `opacity`% onto `ctx`, using the
 *  halo's own values as its alpha channel — shared by every effect above that ends in "colorize this
 *  mask and composite it". `dx`/`dy` place it at an offset on `ctx` — for the common case `halo` is
 *  already page-sized and this is 0,0; `liveLayerEffects.ts`'s dirty-region path instead computes a
 *  small region-sized `halo` and passes that region's own page-space origin here. */
export function paintHalo(ctx: CanvasRenderingContext2D, halo: Float32Array, width: number, height: number, color: string, opacityPct: number, blendMode: GlobalCompositeOperation, dx = 0, dy = 0) {
  const { r, g, b } = hexToRgb(color);
  const img = ctx.createImageData(width, height);
  const alphaScale = Math.max(0, Math.min(100, opacityPct)) / 100;
  for (let i = 0, p = 0; p < halo.length; i += 4, p++) {
    img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b;
    img.data[i + 3] = clamp255(halo[p] * alphaScale);
  }
  const scratch = document.createElement('canvas');
  scratch.width = width; scratch.height = height;
  scratch.getContext('2d')!.putImageData(img, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = blendMode;
  ctx.drawImage(scratch, dx, dy);
  ctx.restore();
}

/** Blend If's per-pixel luminance/channel read — Gray is the standard broadcast-luma weighting
 *  (rounded to line up with integer 0-255 split points); R/G/B select a single raw channel byte,
 *  matching Photoshop's own channel dropdown above the two split-point sliders. */
export function blendIfChannelValue(r: number, g: number, b: number, channel: BlendIfChannel): number {
  switch (channel) {
    case 'r': return r;
    case 'g': return g;
    case 'b': return b;
    default: return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
}

/** One Blend If split-point range's ramp, 0-1: 0 below `blackMin`, linear up to 1 across
 *  black/blackMax, full 1 in the plateau, linear back down to 0 across white/whiteMax, 0 above
 *  `whiteMax`. Pure — reused per-pixel by `applyBlendIf` for both "This Layer" and "Underlying
 *  Layer" (they're the same math, just fed different source pixels). */
export function blendIfRangeMask(value: number, range: BlendIfRange): number {
  if (value < range.blackMin) return 0;
  if (value < range.blackMax) return (value - range.blackMin) / Math.max(1, range.blackMax - range.blackMin);
  if (value > range.whiteMax) return 0;
  if (value > range.whiteMin) return 1 - (value - range.whiteMin) / Math.max(1, range.whiteMax - range.whiteMin);
  return 1;
}

/**
 * Mutates `data`'s alpha channel in place by Blend If's gate(s). `data` is this layer's own final
 * rendered RGBA (post-mask, post every other Layer Style paint) — "This Layer" always applies.
 * `underlying`, when given, is the pre-this-layer backdrop RGBA (same pixel count as `data`) plus
 * its own range, used for the "Underlying Layer" gate — omit it entirely (rather than passing a
 * no-op range) for the live Konva preview, which structurally cannot see the backdrop (see
 * `studioTypes.ts`'s `LayerEffects.blendIf` doc comment), so the underlying gate is skipped outright
 * rather than evaluated against nothing.
 */
export function applyBlendIf(
  data: Uint8ClampedArray,
  thisRange: BlendIfRange,
  channel: BlendIfChannel,
  underlying?: { data: Uint8ClampedArray; range: BlendIfRange },
): void {
  for (let i = 0; i < data.length; i += 4) {
    let mask = blendIfRangeMask(blendIfChannelValue(data[i], data[i + 1], data[i + 2], channel), thisRange);
    if (underlying) {
      const u = underlying.data;
      mask *= blendIfRangeMask(blendIfChannelValue(u[i], u[i + 1], u[i + 2], channel), underlying.range);
    }
    if (mask !== 1) data[i + 3] = Math.round(data[i + 3] * mask);
  }
}

export type { ShadowStyleData, GlowStyleData };
