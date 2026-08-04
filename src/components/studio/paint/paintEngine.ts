import { clipToSelection, magicWandMask, type Selection } from './selection';
import { getBrushTip, type BrushShape } from './brushTip';
import { traceAnchors, flattenPathToPolygon } from '../pathGeometry';
import { compositeOperationFor, type PathLayerData } from '../studioTypes';
import type { ContentAwareMode } from './contentAwareAlgorithms';
import type { SampleMode } from '../../../lib/sampleComposite';

export type PaintTool =
  | 'brush' | 'pencil' | 'eraser' | 'background-eraser' | 'magic-eraser' | 'bucket' | 'gradient' | 'clone' | 'heal'
  | 'blur' | 'sharpen' | 'smudge' | 'dodge' | 'burn' | 'sponge' | 'contentAware'
  | 'shape-rect' | 'shape-ellipse' | 'shape-line' | 'spot-heal' | 'liquify';

/** Mirrors brush/pencil/eraser strokes across the canvas center — 'horizontal' flips left-right (mirror axis is the vertical centerline), 'vertical' flips top-bottom, 'both' does both (4-way). */
export type SymmetryMode = 'none' | 'horizontal' | 'vertical' | 'both';

/** Background Eraser: where the "background color to erase" comes from — resampled at the brush's
 *  hotspot on every stamp, fixed to whatever was under the first stamp of the stroke, or always the
 *  current background swatch regardless of what's under the cursor. */
export type BackgroundEraserSampling = 'continuous' | 'once' | 'swatch';
/** Background Eraser: which pixels under the brush actually erase — every matching pixel
 *  regardless of connectivity, only pixels connected to the hotspot itself, or the same
 *  connectivity with erasure reduced near detected edges to protect sharp boundaries. */
export type BackgroundEraserLimits = 'discontiguous' | 'contiguous' | 'findEdges';

export interface PaintSettings {
  size: number;
  hardness: number; // 0-1
  /** Stroke-level cap. Overlapping stamps within one stroke never exceed this — see strokeSegment. */
  opacity: number; // 0-1
  /** Per-stamp deposit. Accumulates within a stroke, up to `opacity`. */
  flow: number; // 0-1
  color: string; // hex
  bgColor: string; // hex — used as the Gradient tool's "to" color (foreground-to-background, Photoshop convention)
  tolerance: number; // 0-255, used by bucket/wand
  liquifyMode: LiquifyMode;
  symmetry: SymmetryMode;
  /** Distance between stamps as a fraction of size. 0.15 ≈ the old hardcoded value. */
  spacing: number; // 0.01-1
  brushShape: BrushShape | 'image';
  /** Only for brushShape==='image': the active preset's baked alpha mask + its cache id. */
  tipMask?: HTMLCanvasElement;
  tipMaskId?: string;
  angle: number; // -180..180 degrees
  roundness: number; // 0.05-1 (1 = circular)
  /** Random per-stamp offset perpendicular/along the stroke, as a fraction of size. */
  scatter: number; // 0-1
  /** Pull-string smoothing: 0 = raw pointer, 1 = heavy lag. Applied in usePaintLayer. */
  smoothing: number; // 0-1
  /** Whether stylus pressure drives size / opacity (PointerEvent.pressure). */
  pressureSize: boolean;
  pressureOpacity: boolean;
  /** Spot Healing Brush / Content-Aware Fill's repair algorithm — see `contentAwareAlgorithms.ts`. */
  contentAwareMode: ContentAwareMode;
  /** Clone/Heal source and Eyedropper pick: which layers contribute to what gets sampled. See
   *  `sampleComposite.ts`'s `compositeLayersForSampling` for what each option actually composites. */
  sampleMode: SampleMode;
  backgroundEraserSampling: BackgroundEraserSampling;
  backgroundEraserLimits: BackgroundEraserLimits;
  /** Pixels that read as close to the current foreground color are never erased, regardless of
   *  tolerance — Background Eraser's "Protect Foreground Color". */
  backgroundEraserProtectForeground: boolean;
  /** Magic Eraser's own options — kept separate from the wand/bucket's shared `tolerance` field
   *  above (which Magic Eraser also reuses) since these three have no equivalent on any other tool. */
  magicEraserAntiAlias: boolean;
  magicEraserContiguous: boolean;
  /** Colors are matched against the full layer composite instead of just the active layer, but
   *  erasure always still only ever touches the active layer's own pixels — matches Photoshop's
   *  own "Sample All Layers" semantics for this tool. */
  magicEraserSampleAllLayers: boolean;
  magicEraserOpacity: number; // 0-1
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** HSL conversion + a hue/saturation/luminance-weighted distance (not raw RGB Euclidean) — hue
 *  differences read as "different color" much more reliably than RGB distance does for the kind of
 *  flat-color-background-vs-line-art discrimination the Background/Magic Eraser tools need. */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  else if (max === gn) h = ((bn - rn) / d + 2) * 60;
  else h = ((rn - gn) / d + 4) * 60;
  return [h, s, l];
}

/** 0..1 — hue-weighted color distance used by both eraser tools' tolerance tests. */
function hslColorDistance(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  const [h1, s1, l1] = rgbToHsl(r1, g1, b1);
  const [h2, s2, l2] = rgbToHsl(r2, g2, b2);
  const hueDiff = Math.min(Math.abs(h1 - h2), 360 - Math.abs(h1 - h2)) / 180;
  const satDiff = Math.abs(s1 - s2);
  const lumDiff = Math.abs(l1 - l2);
  return hueDiff * 0.6 + satDiff * 0.2 + lumDiff * 0.2;
}

/** Effective tip geometry for a tool, after its own overrides (Pencil is always small + hard). */
export function effectiveTip(settings: PaintSettings, tool: 'brush' | 'pencil' | 'eraser') {
  return {
    size: tool === 'pencil' ? Math.max(1, Math.round(settings.size / 4)) : settings.size,
    hardness: tool === 'pencil' ? 1 : settings.hardness,
    shape: settings.brushShape,
    angle: settings.angle,
    roundness: settings.roundness,
    // The eraser only ever uses its tip's alpha (it composites destination-out),
    // so its colour is arbitrary — pin it to black to avoid a second cache entry.
    color: tool === 'eraser' ? '#000000' : settings.color,
    maskCanvas: settings.tipMask,
    maskId: settings.tipMaskId,
  };
}

/** One tip blit. Tips are cached white canvases (see brushTip.ts); colour is applied by the caller's tint pass. */
function stampTip(ctx: CanvasRenderingContext2D, tip: HTMLCanvasElement, x: number, y: number, alpha: number) {
  ctx.globalAlpha = alpha;
  ctx.drawImage(tip, x - tip.width / 2, y - tip.height / 2);
}

/**
 * Brush / Pencil / Eraser: lays interpolated stamps along a segment.
 *
 * `ctx` here is the *stroke buffer*, not the layer — usePaintLayer accumulates a
 * whole stroke into a scratch canvas at `flow` alpha and then composites that
 * buffer onto the layer once at `opacity`. That split is what makes flow and
 * opacity behave like Photoshop's: flow builds up where a stroke overlaps
 * itself, while opacity caps the stroke as a whole. (The previous version
 * stamped straight onto the layer at `opacity * flow`, so overlapping stamps
 * accumulated straight past the opacity cap and the two sliders were
 * indistinguishable.)
 *
 * Returns the bounding box touched, so the caller can composite just that region.
 */
export function strokeSegment(
  ctx: CanvasRenderingContext2D,
  x0: number, y0: number, x1: number, y1: number,
  settings: PaintSettings,
  tool: 'brush' | 'pencil' | 'eraser',
  selection: Selection,
  pressure = 1,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  clipToSelection(ctx, selection);

  const geom = effectiveTip(settings, tool);
  const sizeScale = settings.pressureSize ? 0.25 + 0.75 * pressure : 1;
  const size = Math.max(1, geom.size * sizeScale);
  const tip = getBrushTip({ ...geom, size });

  const flow = settings.flow * (settings.pressureOpacity ? pressure : 1);
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const step = Math.max(0.5, size * Math.max(0.01, Math.min(1, settings.spacing)));
  const scatterAmp = settings.scatter * size;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const half = tip.width / 2 + 1;

  for (let d = 0; d <= dist || d === 0; d += step) {
    const t = dist ? Math.min(1, d / dist) : 0;
    let sx = x0 + (x1 - x0) * t;
    let sy = y0 + (y1 - y0) * t;
    if (scatterAmp > 0) {
      sx += (Math.random() * 2 - 1) * scatterAmp;
      sy += (Math.random() * 2 - 1) * scatterAmp;
    }
    stampTip(ctx, tip, sx, sy, flow);
    if (sx - half < minX) minX = sx - half;
    if (sy - half < minY) minY = sy - half;
    if (sx + half > maxX) maxX = sx + half;
    if (sy + half > maxY) maxY = sy + half;
    if (dist === 0) break;
  }

  ctx.globalAlpha = 1;
  ctx.restore();
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}


/** Paint Bucket: flood-fill by color similarity, writing pixels back (shares the traversal core with the Magic Wand selection tool). */
export function floodFillAt(ctx: CanvasRenderingContext2D, width: number, height: number, x: number, y: number, settings: PaintSettings, selection: Selection) {
  const mask = magicWandMask(ctx, width, height, x, y, settings.tolerance);
  if (mask.kind !== 'mask') return;
  const [r, g, b] = hexToRgb(settings.color);
  const img = ctx.getImageData(0, 0, width, height);
  const inSel = selectionTester(selection);
  for (let i = 0; i < mask.data.length; i++) {
    if (mask.data[i] < 128) continue;
    const px = i % width, py = Math.floor(i / width);
    if (!inSel(px, py)) continue;
    const o = i * 4;
    img.data[o] = r;
    img.data[o + 1] = g;
    img.data[o + 2] = b;
    img.data[o + 3] = Math.round(255 * settings.opacity);
  }
  ctx.putImageData(img, 0, 0);
}

function selectionTester(sel: Selection): (x: number, y: number) => boolean {
  if (sel.kind === 'none') return () => true;
  if (sel.kind === 'rect') return (x, y) => x >= sel.x && x < sel.x + sel.width && y >= sel.y && y < sel.y + sel.height;
  if (sel.kind === 'ellipse') {
    const cx = sel.x + sel.width / 2, cy = sel.y + sel.height / 2, rx = sel.width / 2, ry = sel.height / 2;
    return (x, y) => ((x - cx) ** 2) / (rx * rx || 1) + ((y - cy) ** 2) / (ry * ry || 1) <= 1;
  }
  if (sel.kind === 'mask') return (x, y) => x >= 0 && y >= 0 && x < sel.width && y < sel.height && sel.data[y * sel.width + x] > 127;
  return () => true; // polygon: approximated as unconstrained here; live clip already handled the vector case elsewhere
}

/** RGB at one pixel, clamped inside the canvas — the Background Eraser's "hotspot" sample. */
export function sampleColorAt(ctx: CanvasRenderingContext2D, x: number, y: number): { r: number; g: number; b: number } {
  const px = Math.max(0, Math.min(ctx.canvas.width - 1, Math.round(x)));
  const py = Math.max(0, Math.min(ctx.canvas.height - 1, Math.round(y)));
  const d = ctx.getImageData(px, py, 1, 1).data;
  return { r: d[0], g: d[1], b: d[2] };
}

/**
 * Background Eraser: for each stamp along the segment, samples (or reuses) a "hotspot" color and
 * erases pixels under the brush tip whose color is within `settings.tolerance` of it — proportional
 * to both the tip's own soft-edge alpha (hardness) and how close the color match is, not a hard
 * cutoff. `fixedHotspot` is the "Once"/"Background Swatch" sampling modes' color, held constant for
 * the whole stroke; pass `null` for "Continuous" sampling, which resamples fresh at every stamp's
 * center instead (matching the tool's real Photoshop behavior of the hotspot tracking the cursor).
 *
 * Deliberately writes straight to `ctx` per stamp rather than going through the shared stroke-buffer
 * + `compositeStroke` path the brush/pencil/eraser tools use — this tool's erase amount depends on
 * live-sampling the layer's *current* pixels at each stamp, which a flow/opacity buffer composited
 * only once at the end can't do (each stamp needs to see the previous stamp's own erasure).
 */
export function backgroundEraseSegment(
  ctx: CanvasRenderingContext2D,
  x0: number, y0: number, x1: number, y1: number,
  settings: PaintSettings,
  fixedHotspot: { r: number; g: number; b: number } | null,
  selection: Selection,
): void {
  const geom = effectiveTip(settings, 'eraser');
  const size = Math.max(2, geom.size);
  const tip = getBrushTip({ ...geom, size });
  const tipCtx = tip.getContext('2d');
  const tipData = tipCtx ? tipCtx.getImageData(0, 0, tip.width, tip.height) : null;
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const step = Math.max(0.5, size * Math.max(0.01, Math.min(1, settings.spacing)));
  const [fgR, fgG, fgB] = hexToRgb(settings.color);
  const tolerance = Math.max(0, Math.min(1, settings.tolerance / 255));
  const inSel = selectionTester(selection);
  const radius = size / 2;
  const canvasW = ctx.canvas.width, canvasH = ctx.canvas.height;
  const findEdges = settings.backgroundEraserLimits === 'findEdges';
  const limitToConnected = settings.backgroundEraserLimits !== 'discontiguous';

  for (let d = 0; d <= dist || d === 0; d += step) {
    const t = dist ? Math.min(1, d / dist) : 0;
    const cx = x0 + (x1 - x0) * t;
    const cy = y0 + (y1 - y0) * t;
    const hotspot = fixedHotspot ?? sampleColorAt(ctx, cx, cy);

    const left = Math.max(0, Math.floor(cx - radius - 1));
    const top = Math.max(0, Math.floor(cy - radius - 1));
    const right = Math.min(canvasW, Math.ceil(cx + radius + 1));
    const bottom = Math.min(canvasH, Math.ceil(cy + radius + 1));
    const w = right - left, h = bottom - top;
    if (w <= 0 || h <= 0) { if (dist === 0) break; continue; }

    const region = ctx.getImageData(left, top, w, h);
    const tipOriginX = cx - tip.width / 2, tipOriginY = cy - tip.height / 2;
    const tipAlphaAt = (gx: number, gy: number): number => {
      if (!tipData) return 1;
      const lx = Math.round(gx - tipOriginX), ly = Math.round(gy - tipOriginY);
      if (lx < 0 || ly < 0 || lx >= tip.width || ly >= tip.height) return 0;
      return tipData.data[(ly * tip.width + lx) * 4 + 3] / 255;
    };

    const matches = new Uint8Array(w * h);
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const gx = left + px, gy = top + py;
        if (tipAlphaAt(gx, gy) <= 0 || !inSel(gx, gy)) continue;
        const o = (py * w + px) * 4;
        if (region.data[o + 3] === 0) continue;
        const r = region.data[o], g = region.data[o + 1], b = region.data[o + 2];
        if (hslColorDistance(r, g, b, hotspot.r, hotspot.g, hotspot.b) > tolerance) continue;
        if (settings.backgroundEraserProtectForeground && hslColorDistance(r, g, b, fgR, fgG, fgB) < 0.12) continue;
        matches[py * w + px] = 1;
      }
    }

    let allowed = matches;
    if (limitToConnected) {
      allowed = new Uint8Array(w * h);
      const startPx = Math.round(cx) - left, startPy = Math.round(cy) - top;
      const startIdx = startPy * w + startPx;
      if (startPx >= 0 && startPx < w && startPy >= 0 && startPy < h && matches[startIdx]) {
        const seen = new Uint8Array(w * h);
        const stack = [startIdx];
        seen[startIdx] = 1;
        while (stack.length) {
          const p = stack.pop()!;
          allowed[p] = 1;
          const px = p % w, py = (p - px) / w;
          if (px > 0 && !seen[p - 1] && matches[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
          if (px < w - 1 && !seen[p + 1] && matches[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
          if (py > 0 && !seen[p - w] && matches[p - w]) { seen[p - w] = 1; stack.push(p - w); }
          if (py < h - 1 && !seen[p + w] && matches[p + w]) { seen[p + w] = 1; stack.push(p + w); }
        }
      }
    }

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const idx = py * w + px;
        if (!allowed[idx]) continue;
        const gx = left + px, gy = top + py;
        let eraseAmount = tipAlphaAt(gx, gy) * settings.opacity;
        if (findEdges) {
          // Cheap local-gradient estimate straight from the region buffer — reduces erasure near
          // sharp brightness boundaries instead of running a separate edge-detection pass.
          const o = idx * 4;
          const rightO = (px < w - 1 ? idx + 1 : idx) * 4;
          const downO = (py < h - 1 ? idx + w : idx) * 4;
          const grad = Math.abs(region.data[o] - region.data[rightO]) + Math.abs(region.data[o] - region.data[downO]);
          eraseAmount *= 1 - Math.min(1, grad / 80) * 0.85;
        }
        const o = idx * 4 + 3;
        region.data[o] = Math.round(region.data[o] * (1 - eraseAmount));
      }
    }
    ctx.putImageData(region, left, top);
    if (dist === 0) break;
  }
}

/** Same tolerance-squared-RGB-distance test `magicWandMask` uses, but scanning every pixel instead
 *  of flood-filling from the click point — Magic Eraser's "Contiguous" unchecked. */
function globalColorMask(source: CanvasRenderingContext2D, width: number, height: number, x: number, y: number, tolerance: number): Uint8ClampedArray | null {
  const img = source.getImageData(0, 0, width, height);
  const d = img.data;
  const startIdx = (Math.floor(y) * width + Math.floor(x)) * 4;
  if (startIdx < 0 || startIdx >= d.length) return null;
  const sr = d[startIdx], sg = d[startIdx + 1], sb = d[startIdx + 2];
  const tol = tolerance * tolerance * 3;
  const mask = new Uint8ClampedArray(width * height);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    if (d[o + 3] === 0) continue;
    const dr = d[o] - sr, dg = d[o + 1] - sg, db = d[o + 2] - sb;
    if (dr * dr + dg * dg + db * db <= tol) mask[i] = 255;
  }
  return mask;
}

/**
 * Magic Eraser: single-click flood/global erase by color similarity — the Magic Wand's selection
 * logic repurposed to erase alpha instead of producing a `Selection`. `sampleCtx` is what the color
 * test reads from (the active layer's own canvas, or the full layer composite when "Sample All
 * Layers" is on); erasure itself always writes to `ctx` — the active layer — only, matching
 * Photoshop's own "samples all layers, erases just the active one" behavior for this tool.
 */
export function applyMagicErase(
  ctx: CanvasRenderingContext2D,
  sampleCtx: CanvasRenderingContext2D,
  width: number, height: number,
  x: number, y: number,
  settings: PaintSettings,
  selection: Selection,
): void {
  const wandMask = settings.magicEraserContiguous ? magicWandMask(sampleCtx, width, height, x, y, settings.tolerance) : null;
  const maskData = wandMask && wandMask.kind === 'mask' ? wandMask.data : globalColorMask(sampleCtx, width, height, x, y, settings.tolerance);
  if (!maskData) return;

  const startIdx = (Math.floor(y) * width + Math.floor(x)) * 4;
  const sampleImg = sampleCtx.getImageData(0, 0, width, height);
  const sr = sampleImg.data[startIdx], sg = sampleImg.data[startIdx + 1], sb = sampleImg.data[startIdx + 2];
  const spread = Math.max(1, settings.tolerance) * Math.sqrt(3);

  const img = ctx.getImageData(0, 0, width, height);
  const inSel = selectionTester(selection);
  for (let i = 0; i < maskData.length; i++) {
    if (maskData[i] < 128) continue;
    const px = i % width, py = Math.floor(i / width);
    if (!inSel(px, py)) continue;
    const o = i * 4;
    let eraseAmount = settings.magicEraserOpacity;
    if (settings.magicEraserAntiAlias) {
      const dr = sampleImg.data[o] - sr, dg = sampleImg.data[o + 1] - sg, db = sampleImg.data[o + 2] - sb;
      const normalized = Math.sqrt(dr * dr + dg * dg + db * db) / spread;
      eraseAmount *= Math.max(0, 1 - normalized * 0.7);
    }
    img.data[o + 3] = Math.round(img.data[o + 3] * (1 - eraseAmount));
  }
  ctx.putImageData(img, 0, 0);
}

/** Linear gradient fill (Gradient tool), constrained to the active selection if any. */
export function applyGradient(ctx: CanvasRenderingContext2D, width: number, height: number, x0: number, y0: number, x1: number, y1: number, fromColor: string, toColor: string, selection: Selection) {
  clipToSelection(ctx, selection);
  const grad = ctx.createLinearGradient(x0, y0, x1, y1);
  grad.addColorStop(0, fromColor);
  grad.addColorStop(1, toColor);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

/** Clone Stamp: interpolated clipped copies from a source canvas, offset by a fixed (dx, dy). Ported from the legacy prototype's cloneSegment(). */
export function cloneSegment(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  x0: number, y0: number, x1: number, y1: number,
  size: number, offsetX: number, offsetY: number,
  selection: Selection,
) {
  clipToSelection(ctx, selection);
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const step = Math.max(1, size * 0.15);
  for (let d = 0; d <= dist; d += step) {
    const t = dist ? d / dist : 0;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, size / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(source, x - offsetX - size / 2, y - offsetY - size / 2, size, size, x - size / 2, y - size / 2, size, size);
    ctx.restore();
  }
  ctx.restore();
}

/**
 * Core of Photoshop's Healing Brush / Patch Tool: blends `sourceData`'s texture into `destData`
 * (same-sized, already positionally aligned by the caller) but corrects for the two regions'
 * differing average color first, so the source's brush strokes/paper grain transfer without
 * dragging its color along — the actual thing that distinguishes Heal/Patch from a raw copy
 * (Clone Stamp). `falloffAt` returns 0..1 per-pixel blend strength — radial for Heal's per-stamp
 * use, a feathered-rect falloff for Patch's one-shot whole-region use.
 */
function colorMatchBlend(
  destData: ImageData,
  sourceData: ImageData,
  falloffAt: (ix: number, iy: number, w: number, h: number) => number,
): ImageData {
  const { width: w, height: h } = destData;
  let dr = 0, dg = 0, db = 0, sr = 0, sg = 0, sb = 0;
  const n = w * h;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    dr += destData.data[o]; dg += destData.data[o + 1]; db += destData.data[o + 2];
    sr += sourceData.data[o]; sg += sourceData.data[o + 1]; sb += sourceData.data[o + 2];
  }
  const diffR = dr / n - sr / n, diffG = dg / n - sg / n, diffB = db / n - sb / n;

  const out = new ImageData(w, h);
  for (let iy = 0; iy < h; iy++) {
    for (let ix = 0; ix < w; ix++) {
      const i = iy * w + ix;
      const o = i * 4;
      const alpha = falloffAt(ix, iy, w, h);
      const correctedR = sourceData.data[o] + diffR;
      const correctedG = sourceData.data[o + 1] + diffG;
      const correctedB = sourceData.data[o + 2] + diffB;
      out.data[o] = destData.data[o] * (1 - alpha) + correctedR * alpha;
      out.data[o + 1] = destData.data[o + 1] * (1 - alpha) + correctedG * alpha;
      out.data[o + 2] = destData.data[o + 2] * (1 - alpha) + correctedB * alpha;
      out.data[o + 3] = destData.data[o + 3] * (1 - alpha) + sourceData.data[o + 3] * alpha;
    }
  }
  return out;
}

/** Healing Brush: like Clone Stamp (interpolated stamps offset from an alt-clicked source — see
 *  usePaintLayer.ts, which intentionally shares Clone's source-point refs with this tool, matching
 *  Photoshop's own behavior), but each stamp is color-matched via colorMatchBlend rather than a raw
 *  copy, so the source's texture transfers without dragging its color/lighting along. */
export function healSegment(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  x0: number, y0: number, x1: number, y1: number,
  size: number, offsetX: number, offsetY: number,
  selection: Selection,
) {
  clipToSelection(ctx, selection);
  const srcCtx = source.getContext('2d');
  if (!srcCtx) { ctx.restore(); return; }
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const step = Math.max(1, size * 0.15);
  const r = size / 2;
  for (let d = 0; d <= dist; d += step) {
    const t = dist ? d / dist : 0;
    const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
    const bx = Math.round(x - r), by = Math.round(y - r), bs = Math.max(1, Math.round(size));
    const cw = ctx.canvas.width, ch = ctx.canvas.height;
    const cx0 = Math.max(0, bx), cy0 = Math.max(0, by);
    const cx1 = Math.min(cw, bx + bs), cy1 = Math.min(ch, by + bs);
    if (cx1 <= cx0 || cy1 <= cy0) continue;
    const w = cx1 - cx0, h = cy1 - cy0;
    const destData = ctx.getImageData(cx0, cy0, w, h);
    // Source region uses the same window offset by (offsetX, offsetY) — clamp so it never reads
    // outside the snapshot; a clamped read is a visible seam, an out-of-bounds read is a crash.
    const sx0 = Math.max(0, Math.min(source.width - w, cx0 - offsetX));
    const sy0 = Math.max(0, Math.min(source.height - h, cy0 - offsetY));
    const sourceData = srcCtx.getImageData(sx0, sy0, w, h);
    const cx = w / 2, cy = h / 2, rad = Math.min(cx, cy);
    const blended = colorMatchBlend(destData, sourceData, (ix, iy) => {
      const fx = ix - cx, fy = iy - cy;
      return Math.max(0, 1 - Math.hypot(fx, fy) / (rad || 1));
    });
    ctx.putImageData(blended, cx0, cy0);
  }
  ctx.restore();
}

/**
 * Patch Tool: one-shot color-matched blend of a dragged source region into the untouched defect
 * region at `originBounds` — `dx,dy` is the drag offset (source = originBounds shifted by dx,dy).
 * Unlike Heal, this is a single whole-region blend, not a brush stroke, so the falloff feathers the
 * region's own edge inward rather than radiating from a stamp center.
 */
export function applyPatch(
  ctx: CanvasRenderingContext2D,
  originBounds: { x: number; y: number; width: number; height: number },
  dx: number, dy: number,
) {
  const { x, y, width: w, height: h } = originBounds;
  if (w <= 0 || h <= 0) return;
  const cw = ctx.canvas.width, ch = ctx.canvas.height;
  const sx = Math.max(0, Math.min(cw - w, x + dx));
  const sy = Math.max(0, Math.min(ch - h, y + dy));
  const destData = ctx.getImageData(x, y, w, h);
  const sourceData = ctx.getImageData(sx, sy, w, h);
  const feather = Math.max(2, Math.min(w, h) * 0.15);
  const blended = colorMatchBlend(destData, sourceData, (ix, iy, ww, hh) => {
    const edgeDist = Math.min(ix, iy, ww - 1 - ix, hh - 1 - iy);
    return Math.min(1, edgeDist / feather);
  });
  ctx.putImageData(blended, x, y);
}

type FilterKind = 'blur' | 'sharpen' | 'smudge' | 'dodge' | 'burn' | 'sponge';

/** Blur/Sharpen/Smudge/Dodge/Burn/Sponge: brush-driven per-stamp pixel transforms over a small patch. Simple, real, not photoreal. */
export function applyFilterBrush(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, size: number, strength: number,
  kind: FilterKind,
  dragDx: number, dragDy: number,
  selection: Selection,
) {
  const r = Math.max(2, Math.round(size / 2));
  const px = Math.round(x - r), py = Math.round(y - r);
  const w = r * 2, h = r * 2;
  const cw = ctx.canvas.width, ch = ctx.canvas.height;
  const bx = Math.max(0, px), by = Math.max(0, py);
  const bw = Math.min(w, cw - bx), bh = Math.min(h, ch - by);
  if (bw <= 0 || bh <= 0) return;
  const inSel = selectionTester(selection);

  const img = ctx.getImageData(bx, by, bw, bh);
  const src = new Uint8ClampedArray(img.data);
  const at = (ix: number, iy: number, c: number) => src[(Math.max(0, Math.min(bh - 1, iy)) * bw + Math.max(0, Math.min(bw - 1, ix))) * 4 + c];

  for (let iy = 0; iy < bh; iy++) {
    for (let ix = 0; ix < bw; ix++) {
      if (!inSel(bx + ix, by + iy)) continue;
      const dcx = ix - bw / 2, dcy = iy - bh / 2;
      const falloff = Math.max(0, 1 - Math.hypot(dcx, dcy) / (r || 1));
      if (falloff <= 0) continue;
      const o = (iy * bw + ix) * 4;

      if (kind === 'blur') {
        for (let c = 0; c < 3; c++) {
          const avg = (at(ix - 1, iy, c) + at(ix + 1, iy, c) + at(ix, iy - 1, c) + at(ix, iy + 1, c) + at(ix, iy, c)) / 5;
          img.data[o + c] = src[o + c] + (avg - src[o + c]) * strength * falloff;
        }
      } else if (kind === 'sharpen') {
        for (let c = 0; c < 3; c++) {
          const avg = (at(ix - 1, iy, c) + at(ix + 1, iy, c) + at(ix, iy - 1, c) + at(ix, iy + 1, c)) / 4;
          img.data[o + c] = src[o + c] + (src[o + c] - avg) * strength * falloff;
        }
      } else if (kind === 'smudge') {
        for (let c = 0; c < 3; c++) {
          img.data[o + c] = at(ix - dragDx, iy - dragDy, c) * falloff + src[o + c] * (1 - falloff);
        }
      } else if (kind === 'dodge' || kind === 'burn') {
        const sign = kind === 'dodge' ? 1 : -1;
        for (let c = 0; c < 3; c++) {
          img.data[o + c] = src[o + c] + sign * strength * 60 * falloff;
        }
      } else if (kind === 'sponge') {
        const gray = 0.299 * src[o] + 0.587 * src[o + 1] + 0.114 * src[o + 2];
        for (let c = 0; c < 3; c++) {
          img.data[o + c] = src[o + c] + (gray - src[o + c]) * strength * falloff;
        }
      }
    }
  }
  ctx.putImageData(img, bx, by);
}

export type LiquifyMode = 'push' | 'swirl' | 'pinch' | 'bloat' | 'crystalize' | 'reconstruct';

/**
 * Liquify: per-stamp pixel-displacement warp, ported (as math, not code — the original is a
 * Konva/canvas-based React app) from Flowy's liquify tool concept (see CLAUDE.md for the
 * attribution note). Each mode computes a *source sample offset* per pixel and reads from
 * there instead of the pixel's own position, which is what makes it a true warp rather than a
 * blend like the Smudge filter brush above. `reconstruct` gradually blends each stamped pixel
 * back toward `pristine` (a full-canvas snapshot taken before the layer's first-ever liquify
 * edit, owned by the caller — see `liquifySnapshots` in StudioCanvas.tsx) instead of computing a
 * sample offset, so it needs that extra param the other modes ignore.
 */
export function liquify(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, size: number, strength: number,
  mode: LiquifyMode,
  dragDx: number, dragDy: number,
  selection: Selection,
  pristine?: ImageData | null,
) {
  const r = Math.max(4, Math.round(size / 2));
  const px = Math.round(x - r), py = Math.round(y - r);
  const w = r * 2, h = r * 2;
  const cw = ctx.canvas.width, ch = ctx.canvas.height;
  const bx = Math.max(0, px), by = Math.max(0, py);
  const bw = Math.min(w, cw - bx), bh = Math.min(h, ch - by);
  if (bw <= 0 || bh <= 0) return;
  const inSel = selectionTester(selection);

  const img = ctx.getImageData(bx, by, bw, bh);
  const src = new Uint8ClampedArray(img.data);
  const at = (ix: number, iy: number, c: number) => {
    const cx = Math.max(0, Math.min(bw - 1, Math.round(ix)));
    const cy = Math.max(0, Math.min(bh - 1, Math.round(iy)));
    return src[(cy * bw + cx) * 4 + c];
  };

  const cx = bw / 2, cy = bh / 2;
  const amount = Math.max(0.05, Math.min(1, strength));

  for (let iy = 0; iy < bh; iy++) {
    for (let ix = 0; ix < bw; ix++) {
      if (!inSel(bx + ix, by + iy)) continue;
      const dcx = ix - cx, dcy = iy - cy;
      const dist = Math.hypot(dcx, dcy);
      const falloff = Math.max(0, 1 - dist / (r || 1));
      if (falloff <= 0) continue;
      const o = (iy * bw + ix) * 4;

      let sampleX = ix, sampleY = iy;
      if (mode === 'push') {
        // Forward warp: sample from "behind" the drag direction so pixels appear pushed along it.
        sampleX = ix - dragDx * falloff * amount * 2;
        sampleY = iy - dragDy * falloff * amount * 2;
      } else if (mode === 'swirl') {
        const angle = falloff * amount * 1.2;
        const cos = Math.cos(angle), sin = Math.sin(angle);
        sampleX = cx + dcx * cos - dcy * sin;
        sampleY = cy + dcx * sin + dcy * cos;
      } else if (mode === 'pinch') {
        const pull = 1 - falloff * amount * 0.8;
        sampleX = cx + dcx * pull;
        sampleY = cy + dcy * pull;
      } else if (mode === 'bloat') {
        const push = 1 + falloff * amount * 0.8;
        sampleX = cx + dcx / push;
        sampleY = cy + dcy / push;
      } else if (mode === 'crystalize') {
        const cell = Math.max(2, Math.round(4 + (1 - amount) * 10));
        sampleX = Math.round(ix / cell) * cell;
        sampleY = Math.round(iy / cell) * cell;
      } else if (mode === 'reconstruct') {
        if (!pristine) continue;
        const px = bx + ix, py = by + iy;
        if (px < 0 || py < 0 || px >= pristine.width || py >= pristine.height) continue;
        const pi = (py * pristine.width + px) * 4;
        const blend = falloff * amount;
        for (let c = 0; c < 4; c++) {
          img.data[o + c] = pristine.data[pi + c] * blend + src[o + c] * (1 - blend);
        }
        continue;
      }

      for (let c = 0; c < 4; c++) {
        img.data[o + c] = at(sampleX, sampleY, c) * falloff + src[o + c] * (1 - falloff);
      }
    }
  }
  ctx.putImageData(img, bx, by);
}

export interface ShapeStyle {
  fillColor: string | null;
  strokeColor: string | null;
  strokeWidth: number;
}

/** Rect/Ellipse/Line shape tools — rasterized straight onto the active layer (no separate vector layer type yet). */
export function drawShape(
  ctx: CanvasRenderingContext2D,
  kind: 'shape-rect' | 'shape-ellipse' | 'shape-line',
  x0: number, y0: number, x1: number, y1: number,
  style: ShapeStyle,
  selection: Selection,
) {
  clipToSelection(ctx, selection);
  ctx.beginPath();
  if (kind === 'shape-rect') {
    ctx.rect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
  } else if (kind === 'shape-ellipse') {
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    ctx.ellipse(cx, cy, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, 0, 0, Math.PI * 2);
  } else {
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
  }
  if (style.fillColor && kind !== 'shape-line') {
    ctx.fillStyle = style.fillColor;
    ctx.fill();
  }
  if (style.strokeColor && style.strokeWidth > 0) {
    ctx.strokeStyle = style.strokeColor;
    ctx.lineWidth = style.strokeWidth;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Traces a smooth curve through every point (quadratic-through-midpoints, the standard
 * "smooth a polyline" technique): each segment ends at the midpoint of its two source points,
 * with the source point itself as the curve's control point, so the path passes near every
 * click rather than sharply cornering at it. Used by the Curvature Pen — the straight-edged
 * Pen tool traces the same points with plain `lineTo` instead.
 */
function tracePenPath(ctx: CanvasRenderingContext2D, points: { x: number; y: number }[], closed: boolean, smooth: boolean) {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  if (!smooth) {
    for (const p of points.slice(1)) ctx.lineTo(p.x, p.y);
    if (closed) ctx.closePath();
    return;
  }
  const pts = closed ? [...points, points[0], points[1]] : points;
  for (let i = 1; i < pts.length - 1; i++) {
    const xc = (pts[i].x + pts[i + 1].x) / 2;
    const yc = (pts[i].y + pts[i + 1].y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
  }
  if (!closed) {
    const last = pts[pts.length - 1];
    ctx.quadraticCurveTo(last.x, last.y, last.x, last.y);
  } else {
    ctx.closePath();
  }
}

/** Basic Pen tool: a closed/open path, stroked and/or filled onto the active layer on commit. `smooth` traces a curve through the points instead of straight edges — the Curvature Pen. */
export function strokePenPath(
  ctx: CanvasRenderingContext2D,
  points: { x: number; y: number }[],
  closed: boolean,
  style: ShapeStyle,
  selection: Selection,
  smooth = false,
) {
  if (points.length < 2) return;
  clipToSelection(ctx, selection);
  tracePenPath(ctx, points, closed, smooth);
  if (closed && style.fillColor) {
    ctx.fillStyle = style.fillColor;
    ctx.fill();
  }
  if (style.strokeColor && style.strokeWidth > 0) {
    ctx.strokeStyle = style.strokeColor;
    ctx.lineWidth = style.strokeWidth;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * One-shot bake of a real vector path layer's geometry onto a raster canvas (Stroke Path / Fill
 * Path menu actions). Uses real per-anchor cubic bezier via `traceAnchors` (`pathGeometry.ts`) —
 * genuinely different math from `tracePenPath`'s polyline-smoothing above, which has no
 * independent per-anchor handle concept. Uses the path's own stroke/fill color regardless of that
 * style's `enabled` flag — the menu action itself is the intent to stroke/fill, matching how
 * Photoshop's Stroke Path dialog bakes a stroke even for a path with no live stroke appearance.
 */
/**
 * Stroke Path bakes real brush dynamics along the path's actual bezier curve — sampling it via the
 * same `flattenPathToPolygon` Make-Selection-from-Path already uses, then replaying each sampled
 * segment through `strokeSegment`, the exact per-segment stamp function live Brush/Pencil/Eraser
 * strokes already call — not a flat 2D-context `ctx.stroke()` outline. `simulatePressure` (the
 * dialog's own checkbox) ramps a synthetic 0->1->0 pressure across the stroke's length, tapering
 * both ends — the one honest way to "simulate pressure" on a static path that has no real per-point
 * pressure data of its own, and it genuinely drives `strokeSegment`'s existing pressure-size/
 * pressure-opacity behavior rather than being decorative.
 */
export function strokePathOntoCanvas(
  ctx: CanvasRenderingContext2D,
  path: PathLayerData,
  selection: Selection,
  settings: PaintSettings,
  tool: 'brush' | 'pencil' | 'eraser',
  simulatePressure = false,
) {
  const points = flattenPathToPolygon(path, 24);
  if (points.length === 0) return;
  if (path.closed) points.push(points[0]);
  const rampCount = Math.max(1, Math.floor(points.length / 6));
  for (let i = 1; i < points.length; i++) {
    const pressure = simulatePressure
      ? Math.max(0.05, Math.min(1, i / rampCount, (points.length - i) / rampCount))
      : 1;
    strokeSegment(ctx, points[i - 1].x, points[i - 1].y, points[i].x, points[i].y, settings, tool, selection, pressure);
  }
}

/** Fill Path's dialog resolves a fill type + blend mode + opacity + Preserve Transparency into
 *  concrete values written onto `path.fill` before this runs (see Studio.tsx's `confirmFillPath`) —
 *  this function just applies whatever's there, same "the caller already resolved intent" contract
 *  `strokePathOntoCanvas`'s own doc comment above describes. */
export function fillPathOntoCanvas(ctx: CanvasRenderingContext2D, path: PathLayerData, selection: Selection) {
  clipToSelection(ctx, selection);
  ctx.beginPath();
  traceAnchors(ctx, path.anchors, path.closed);
  ctx.globalAlpha = path.fill.opacity ?? 1;
  // Preserve Transparency locks the fill to pixels the canvas already has color on — expressed as
  // 'source-atop' instead of the chosen blend mode, since "only paint where there's already paint"
  // and "blend against the backdrop" are two different, mutually exclusive intents.
  ctx.globalCompositeOperation = path.fill.preserveTransparency
    ? 'source-atop'
    : compositeOperationFor(path.fill.blendMode ?? 'normal');
  ctx.fillStyle = path.fill.color;
  ctx.fill(path.fillRule === 'evenodd' ? 'evenodd' : 'nonzero');
  ctx.restore();
}
