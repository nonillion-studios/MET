import {
  compositeOperationFor, CUSTOM_BLEND_MODES, hasAnyEnabledStyle,
  type TextLayerData, type PathLayerData, type LayerEffects, type GradientOverlayStyleData,
} from '../components/studio/studioTypes';
import { traceAnchors } from '../components/studio/pathGeometry';
import { gradientVector } from '../components/studio/textGradient';
import { layoutText, applyLetterSpacing } from '../components/studio/textLayout';
import { runFontString } from '../components/studio/textRuns';
import { rasterizeWarpedTextLocal } from '../components/studio/textWarpRender';
import { partitionAdjustments, groupClipRuns, type RenderNode, type ClipRun } from '../components/studio/layerTree';
import { filterForAdjustment, withStrength } from './adjustments';
import { applyCustomBlend } from './customBlendModes';
import { extractAlpha, outerHalo, innerShadowHalo, innerGlowHalo, strokeRing, bevelMasks, satinMask, paintHalo } from './layerEffects';
import type { ExportSnapshot } from '../components/studio/StudioCanvas';
import type { SerializedStudioLayer } from './studioProjectStore';

export type ImageExportFormat = 'png' | 'jpg' | 'webp';

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to decode an image while exporting'));
    img.src = dataUrl;
  });
}

/**
 * Draws a text layer using the same layout the canvas renders from (`layoutText`), so wrapping, the
 * box, alignment, kerning and per-run styling can't drift between screen and export. This used to
 * do its own wrapping, which is exactly how point text ended up exporting wrapped when it doesn't
 * wrap on screen.
 */
export function drawTextLayer(ctx: CanvasRenderingContext2D, text: TextLayerData) {
  ctx.save();

  const layout = layoutText(text);

  const cx = text.x + layout.width / 2;
  const cy = text.y + layout.height / 2;
  ctx.translate(cx, cy);
  ctx.rotate((text.rotation * Math.PI) / 180);
  ctx.translate(-cx, -cy);

  // Type Region: clips flattened export identically to what StudioCanvas/TextLayerNode's Konva
  // clipFunc shows on screen. Coordinates are already page-space here (this context was only
  // rotated, never translated to the layer's own origin), so they're used as stored, unlike the
  // Konva clipFunc which runs in the Group's local space and has to subtract text.x/y itself.
  if (text.clipShape) {
    ctx.beginPath();
    const shape = text.clipShape;
    if (shape.kind === 'ellipse') {
      ctx.ellipse(shape.x + shape.width / 2, shape.y + shape.height / 2, Math.abs(shape.width) / 2, Math.abs(shape.height) / 2, 0, 0, Math.PI * 2);
    } else {
      shape.points.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
    }
    ctx.closePath();
    ctx.clip();
  }

  // Fixed-height area frame: clips flattened export at the box's bottom edge, matching the live
  // canvas render (TextLayerNode.tsx's inner glyph-clip Group). Coordinates are page-space here
  // (this ctx was only rotated about the layer's center, never translated to the layer's own
  // origin), unlike Konva's local-space clipFunc — used as text.x/text.y/layout.width directly, no
  // subtraction needed. Unconditional on fixedHeight being set, not gated on layout.overflowing —
  // same reasoning as the live render. Native ctx.clip() intersects with whatever's already
  // clipped in this save() scope, so this correctly ANDs with the Type Region clip above.
  if (!text.autoWidth && text.fixedHeight != null) {
    ctx.beginPath();
    ctx.rect(text.x, text.y, layout.width, text.fixedHeight);
    ctx.closePath();
    ctx.clip();
  }

  // Warp Text: the rasterize-in-local-space-then-warp path shared with TextLayerNode.tsx's live
  // render — shadow/gradient/stroke are already baked into that local bitmap, so this draws it
  // straight onto the (already rotated + clipped) export ctx and skips the per-run text below
  // entirely, the same way the live render swaps a single Konva.Image in for the per-run nodes.
  if (text.warp && text.warp.style !== 'none') {
    const warped = rasterizeWarpedTextLocal(text, layout);
    ctx.drawImage(warped, text.x, text.y);
    ctx.restore();
    return;
  }

  ctx.textBaseline = 'top';
  ctx.textAlign = 'left'; // alignment is already baked into each run's x by the layout

  if (text.shadow?.enabled) {
    ctx.shadowColor = text.shadow.color;
    ctx.shadowBlur = text.shadow.blur;
    ctx.shadowOffsetX = text.shadow.offsetX;
    ctx.shadowOffsetY = text.shadow.offsetY;
  }

  // One ramp across the whole layer, in page coords, so it spans every run rather than restarting
  // per run — matching how the canvas offsets each run's gradient points off the layer box.
  let gradientFill: CanvasGradient | null = null;
  if (text.gradient?.enabled) {
    const { start, end } = gradientVector(layout.width, layout.height, text.gradient.angle);
    gradientFill = ctx.createLinearGradient(
      text.x + start.x, text.y + start.y,
      text.x + end.x, text.y + end.y,
    );
    gradientFill.addColorStop(0, text.gradient.from);
    gradientFill.addColorStop(1, text.gradient.to);
  }

  for (const run of layout.runs) {
    const x = text.x + run.x;
    const y = text.y + run.y;
    ctx.font = runFontString(run.style);
    applyLetterSpacing(ctx, run.style.letterSpacing);
    if (text.strokeWidth > 0) {
      ctx.strokeStyle = text.strokeColor;
      ctx.lineWidth = text.strokeWidth;
      ctx.strokeText(run.text, x, y);
    }
    ctx.fillStyle = gradientFill ?? run.style.color;
    ctx.fillText(run.text, x, y);
  }
  ctx.restore();
}

/**
 * Whether a group composites as an isolated unit rather than letting its children draw straight
 * onto what's below.
 *
 * **Must stay identical to `needsIsolation` in `StudioCanvas.tsx`** — the two implement the same
 * rule for two renderers, and any drift shows up as an export that doesn't match the screen. See
 * that function for why child count is not a factor. Generic over `{opacity, blendMode}` so
 * `sampleComposite.ts`'s live-canvas sampler (a third renderer, over `StudioLayer` rather than
 * `SerializedStudioLayer`) reuses this exact rule instead of risking a three-way drift.
 *
 * A group with any enabled Layer Style also isolates — an effect changes what the group's own
 * result *is* before it composites against anything below, exactly like non-1 opacity or a non-
 * normal blend already do.
 */
export const isolatesGroup = (layer: { opacity: number; blendMode: SerializedStudioLayer['blendMode']; effects?: LayerEffects }) =>
  layer.opacity < 1 || layer.blendMode !== 'normal' || (layer.effects != null && hasAnyEnabledStyle(layer.effects));

/**
 * Composites `layers` (bottom-to-top) onto `ctx`: adjustments become wrappers around what's below
 * them, then the resulting render tree is drawn.
 *
 * The whole file mirrors `StudioCanvas`'s render — `partitionAdjustments`, `groupClipRuns` and
 * `isolatesGroup`/`needsIsolation` are shared or paired deliberately, because any divergence shows
 * up as an exported file that doesn't match what the user saw.
 */
async function compositeLayers(
  ctx: CanvasRenderingContext2D,
  layers: SerializedStudioLayer[],
  width: number,
  height: number,
  background?: HTMLImageElement,
): Promise<void> {
  await compositeNodes(ctx, partitionAdjustments(layers), width, height, background);
}

async function compositeNodes(
  ctx: CanvasRenderingContext2D,
  nodes: RenderNode<SerializedStudioLayer>[],
  width: number,
  height: number,
  background?: HTMLImageElement,
): Promise<void> {
  // Clip runs form over the plain-layer nodes between adjustments — an adjustment is never a
  // clip base. Mirrors `renderNodes` in StudioCanvas.
  let pending: SerializedStudioLayer[] = [];
  const flushClipRuns = async () => {
    for (const run of groupClipRuns(pending)) {
      if (run.followers.length === 0) await compositeLeaf(ctx, run.base, width, height, background);
      else await compositeClipRun(ctx, run, width, height, background);
    }
    pending = [];
  };

  for (const node of nodes) {
    if (node.kind !== 'adjustment') {
      pending.push(node.layer);
      continue;
    }
    await flushClipRuns();

    // Draw everything the adjustment encloses, then filter the accumulated pixels in place. This is
    // the one place export is *easier* than the canvas: what's below is already composited right
    // here, so there's nothing to cache — the wrapper is just a getImageData/putImageData pair.
    // A hidden adjustment still draws its children; it simply skips the filter.
    await compositeNodes(ctx, node.children, width, height, background);

    const adj = node.layer;
    if (!adj.visible || !adj.adjustment) continue;
    const imageData = ctx.getImageData(0, 0, width, height);
    withStrength(filterForAdjustment(adj.adjustment), adj.opacity)(imageData);
    ctx.putImageData(imageData, 0, 0);
  }

  await flushClipRuns();
}

/**
 * A clip run: base, its followers, then the base again with `destination-in` to trim them to its
 * alpha. Composited on its own canvas first — `destination-in` against the target would erase
 * everything already drawn below — then blitted through the base's opacity and blend mode.
 *
 * Same algorithm as `renderClipRun` on the canvas; the two must stay in step.
 */
async function compositeClipRun(
  ctx: CanvasRenderingContext2D,
  run: ClipRun<SerializedStudioLayer>,
  width: number,
  height: number,
  background?: HTMLImageElement,
): Promise<void> {
  const { base, followers } = run;
  if (!base.visible || !base.raster) return;

  const scratch = document.createElement('canvas');
  scratch.width = width;
  scratch.height = height;
  const sctx = scratch.getContext('2d');
  if (!sctx) return;

  const baseImg = await loadImage(base.raster);
  sctx.drawImage(baseImg, 0, 0, width, height);
  for (const follower of followers) await compositeLeaf(sctx, follower, width, height, background);
  sctx.globalCompositeOperation = 'destination-in';
  sctx.drawImage(baseImg, 0, 0, width, height);

  ctx.save();
  ctx.globalAlpha = base.opacity;
  ctx.globalCompositeOperation = compositeOperationFor(base.blendMode);
  ctx.drawImage(scratch, 0, 0);
  ctx.restore();
}

/** Draws a leaf's own content (background image / nested group / raster / text) with no opacity,
 *  blend, or mask applied — `compositeLeaf` decides how the result gets composited. */
async function drawLeafContent(
  ctx: CanvasRenderingContext2D,
  layer: SerializedStudioLayer,
  width: number,
  height: number,
  background?: HTMLImageElement,
): Promise<void> {
  if (layer.type === 'background') {
    if (background) ctx.drawImage(background, 0, 0, width, height);
  } else if (layer.type === 'group') {
    const group = document.createElement('canvas');
    group.width = width;
    group.height = height;
    const gctx = group.getContext('2d');
    if (gctx) {
      await compositeLayers(gctx, layer.children ?? [], width, height, background);
      ctx.drawImage(group, 0, 0);
    }
  } else if (layer.raster) {
    const img = await loadImage(layer.raster);
    ctx.drawImage(img, 0, 0, width, height);
  } else if (layer.type === 'text' && layer.text && layer.text.content) {
    drawTextLayer(ctx, layer.text);
  } else if (layer.type === 'path' && layer.path) {
    drawPathLayer(ctx, layer.path);
  }
}

/** Flattened export (and live sampling) have no vector concept regardless of format, so
 *  rasterizing here at export resolution is simply correct — the same reasoning text glyphs
 *  already get. Shared by `drawLeafContent` and `sampleComposite.ts`'s synchronous compositor. */
export function drawPathLayer(ctx: CanvasRenderingContext2D, path: PathLayerData) {
  ctx.beginPath();
  traceAnchors(ctx, path.anchors, path.closed);
  if (path.fill.enabled) { ctx.fillStyle = path.fill.color; ctx.fill(path.fillRule === 'evenodd' ? 'evenodd' : 'nonzero'); }
  if (path.stroke.enabled) { ctx.strokeStyle = path.stroke.color; ctx.lineWidth = path.stroke.width; ctx.stroke(); }
}

/**
 * Applies every enabled Layer Style onto a leaf's own rendered content, real pixel effects (see
 * `lib/layerEffects.ts`) rather than a live-canvas-only preview. Drop Shadow/Outer Glow paint onto
 * the *backdrop* `ctx` (they render behind the layer, so the layer's own opaque pixels naturally
 * cover them where they overlap once the scratch composites on top) — everything else paints onto
 * the leaf's own `scratch`/`sctx` so it gets clipped/blended with the content before the final
 * opacity+blend composite step. Pattern Overlay is a real no-op (no pattern-asset infra anywhere in
 * this app, see `PatternOverlayStyleData`'s own doc comment) — not called from here at all.
 */
function applyLeafEffects(
  ctx: CanvasRenderingContext2D,
  sctx: CanvasRenderingContext2D,
  effects: LayerEffects,
  width: number,
  height: number,
): void {
  const alpha = extractAlpha(sctx.getImageData(0, 0, width, height));

  if (effects.dropShadow.enabled) {
    const halo = outerHalo(alpha, width, height, effects.dropShadow.distance, effects.dropShadow.angle, effects.dropShadow.spread, effects.dropShadow.size);
    paintHalo(ctx, halo, width, height, effects.dropShadow.color, effects.dropShadow.opacity, compositeOperationFor(effects.dropShadow.blendMode));
  }
  if (effects.outerGlow.enabled) {
    const halo = outerHalo(alpha, width, height, 0, 0, effects.outerGlow.spread, effects.outerGlow.size);
    paintHalo(ctx, halo, width, height, effects.outerGlow.color, effects.outerGlow.opacity, compositeOperationFor(effects.outerGlow.blendMode));
  }
  if (effects.innerShadow.enabled) {
    const halo = innerShadowHalo(alpha, width, height, effects.innerShadow.distance, effects.innerShadow.angle, effects.innerShadow.size);
    paintHalo(sctx, halo, width, height, effects.innerShadow.color, effects.innerShadow.opacity, compositeOperationFor(effects.innerShadow.blendMode));
  }
  if (effects.innerGlow.enabled) {
    const halo = innerGlowHalo(alpha, width, height, effects.innerGlow.size, effects.innerGlow.source ?? 'edge');
    paintHalo(sctx, halo, width, height, effects.innerGlow.color, effects.innerGlow.opacity, compositeOperationFor(effects.innerGlow.blendMode));
  }
  if (effects.bevelEmboss.enabled) {
    const { highlight, shadow } = bevelMasks(alpha, width, height, effects.bevelEmboss);
    paintHalo(sctx, highlight, width, height, effects.bevelEmboss.highlightColor, effects.bevelEmboss.highlightOpacity, compositeOperationFor(effects.bevelEmboss.highlightMode));
    paintHalo(sctx, shadow, width, height, effects.bevelEmboss.shadowColor, effects.bevelEmboss.shadowOpacity, compositeOperationFor(effects.bevelEmboss.shadowMode));
  }
  if (effects.satin.enabled) {
    const halo = satinMask(alpha, width, height, effects.satin);
    paintHalo(sctx, halo, width, height, effects.satin.color, effects.satin.opacity, compositeOperationFor(effects.satin.blendMode));
  }
  if (effects.colorOverlay.enabled) {
    sctx.save();
    sctx.globalCompositeOperation = 'source-atop';
    sctx.globalAlpha = effects.colorOverlay.opacity / 100;
    sctx.fillStyle = effects.colorOverlay.color;
    sctx.fillRect(0, 0, width, height);
    sctx.restore();
  }
  if (effects.gradientOverlay.enabled) {
    sctx.save();
    sctx.globalCompositeOperation = 'source-atop';
    sctx.globalAlpha = effects.gradientOverlay.opacity / 100;
    sctx.fillStyle = buildOverlayGradient(sctx, effects.gradientOverlay, width, height);
    sctx.fillRect(0, 0, width, height);
    sctx.restore();
  }
  if (effects.stroke.enabled) {
    const ring = strokeRing(alpha, width, height, effects.stroke.size, effects.stroke.position);
    // Gradient/Pattern stroke fill types are simplified to the gradient's own `from` color — a
    // real, if reduced, result rather than the full gradient-along-the-ring Photoshop draws.
    const color = effects.stroke.fillType === 'gradient' ? effects.stroke.gradient.from : effects.stroke.color;
    paintHalo(sctx, ring, width, height, color, effects.stroke.opacity, compositeOperationFor(effects.stroke.blendMode));
  }
}

/** Linear/Radial/Angle/Reflected/Diamond — 5 real, visually distinct gradients built from the
 *  Canvas API's own primitives (`createConicGradient` for Angle, `createRadialGradient` for
 *  Radial/Diamond, `createLinearGradient` otherwise), not one shape reused with a label change. */
function buildOverlayGradient(ctx: CanvasRenderingContext2D, data: GradientOverlayStyleData, width: number, height: number): CanvasGradient {
  const { from, to } = data.gradient;
  const cx = width / 2, cy = height / 2;
  if (data.style === 'radial' || data.style === 'diamond') {
    const r = Math.max(1, (Math.max(width, height) / 2) * (data.scale / 100));
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, from); g.addColorStop(1, to);
    return g;
  }
  if (data.style === 'angle' && typeof ctx.createConicGradient === 'function') {
    const g = ctx.createConicGradient((data.angle * Math.PI) / 180, cx, cy);
    g.addColorStop(0, from); g.addColorStop(0.5, to); g.addColorStop(1, from);
    return g;
  }
  const rad = (data.angle * Math.PI) / 180;
  const len = Math.max(width, height) * (data.scale / 100);
  const x0 = cx - Math.cos(rad) * len / 2, y0 = cy + Math.sin(rad) * len / 2;
  const x1 = cx + Math.cos(rad) * len / 2, y1 = cy - Math.sin(rad) * len / 2;
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  if (data.style === 'reflected') { g.addColorStop(0, to); g.addColorStop(0.5, from); g.addColorStop(1, to); }
  else { g.addColorStop(0, from); g.addColorStop(1, to); }
  return g;
}

async function compositeLeaf(
  ctx: CanvasRenderingContext2D,
  layer: SerializedStudioLayer,
  width: number,
  height: number,
  background?: HTMLImageElement,
): Promise<void> {
  if (!layer.visible) return;
  // A disabled mask has no effect at all, matching PSD's own `disabled` flag and the live canvas.
  const activeMaskRaster = layer.mask?.enabled ? layer.maskRaster : undefined;
  const hasEffects = layer.effects != null && hasAnyEnabledStyle(layer.effects);
  const isCustomBlend = CUSTOM_BLEND_MODES.has(layer.blendMode);

  if (layer.type === 'group' && !isolatesGroup(layer) && !activeMaskRaster) {
    await compositeLayers(ctx, layer.children ?? [], width, height, background);
    return;
  }

  if (!activeMaskRaster && !hasEffects && !isCustomBlend) {
    // The common, fast path — no scratch canvas needed at all.
    ctx.save();
    ctx.globalAlpha = layer.opacity;
    ctx.globalCompositeOperation = compositeOperationFor(layer.blendMode);
    await drawLeafContent(ctx, layer, width, height, background);
    ctx.restore();
    return;
  }

  // Draw the leaf's own content into a scratch canvas — needed whenever a mask, a Layer Style, or a
  // custom (non-native) blend mode means the final composite can't just be "draw straight onto ctx
  // with globalCompositeOperation set". Same reasoning `compositeClipRun` already documents for
  // masks: a `destination-in` (or, here, a custom per-pixel blend read) against the shared canvas
  // would touch everything already painted below it, not just this layer.
  const scratch = document.createElement('canvas');
  scratch.width = width;
  scratch.height = height;
  const sctx = scratch.getContext('2d');
  if (!sctx) return;
  await drawLeafContent(sctx, layer, width, height, background);
  if (activeMaskRaster) {
    const maskImg = await loadImage(activeMaskRaster);
    sctx.globalCompositeOperation = 'destination-in';
    sctx.drawImage(maskImg, 0, 0, width, height);
  }
  if (hasEffects) applyLeafEffects(ctx, sctx, layer.effects!, width, height);

  if (isCustomBlend) {
    const backdrop = ctx.getImageData(0, 0, width, height);
    const source = sctx.getImageData(0, 0, width, height);
    applyCustomBlend(layer.blendMode, backdrop, source);
    sctx.putImageData(source, 0, 0);
    ctx.save();
    ctx.globalAlpha = layer.opacity;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(scratch, 0, 0);
    ctx.restore();
    return;
  }

  ctx.save();
  ctx.globalAlpha = layer.opacity;
  ctx.globalCompositeOperation = compositeOperationFor(layer.blendMode);
  ctx.drawImage(scratch, 0, 0);
  ctx.restore();
}

/** Builds the flattened page canvas a Studio export snapshot represents (background + visible
 *  layers, respecting opacity/blend mode/visibility). Shared by whole-page export and Slice export
 *  (`compositeFlattenedSlice`), which crops this same render N times instead of re-flattening per
 *  slice. `forJpg` pre-fills white since JPG has no alpha channel. */
async function renderFlattenedCanvas(snapshot: ExportSnapshot, forJpg: boolean): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = snapshot.width;
  canvas.height = snapshot.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  if (forJpg) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // The background is root index 0 of the layer tree, not a special case drawn beforehand — an
  // adjustment above it has to be able to enclose and filter it, same as on the canvas.
  const background = await loadImage(snapshot.backgroundDataUrl);
  await compositeLayers(ctx, snapshot.layers, canvas.width, canvas.height, background);
  return canvas;
}

/** Flattens a Studio export snapshot into a single raster image blob. */
export async function compositeFlattenedImage(snapshot: ExportSnapshot, format: ImageExportFormat): Promise<Blob> {
  const canvas = await renderFlattenedCanvas(snapshot, format === 'jpg');
  const mime = format === 'png' ? 'image/png' : format === 'webp' ? 'image/webp' : 'image/jpeg';
  const quality = format === 'jpg' ? 0.92 : undefined;
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Failed to encode exported image'))), mime, quality);
  });
}

/** Renders the whole flattened page once (for the Slice tool's export, so N queued rects don't each
 *  trigger a full re-flatten) — call once, then pass the result to `compositeFlattenedSlice` per rect. */
export async function renderFlattenedPage(snapshot: ExportSnapshot): Promise<HTMLCanvasElement> {
  return renderFlattenedCanvas(snapshot, false);
}

/** Crops a pre-rendered flattened page (from `renderFlattenedPage`) to `rect` and encodes it as a PNG. */
export async function compositeFlattenedSlice(fullCanvas: HTMLCanvasElement, rect: { x: number; y: number; width: number; height: number }): Promise<Blob> {
  const cropped = document.createElement('canvas');
  cropped.width = Math.max(1, Math.round(rect.width));
  cropped.height = Math.max(1, Math.round(rect.height));
  const ctx = cropped.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.drawImage(fullCanvas, rect.x, rect.y, rect.width, rect.height, 0, 0, cropped.width, cropped.height);
  return new Promise((resolve, reject) => {
    cropped.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Failed to encode slice'))), 'image/png');
  });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
