import { BLEND_TO_COMPOSITE, type TextLayerData } from '../components/studio/studioTypes';
import { gradientVector } from '../components/studio/textGradient';
import { layoutText, applyLetterSpacing } from '../components/studio/textLayout';
import { runFontString } from '../components/studio/textRuns';
import { partitionAdjustments, groupClipRuns, type RenderNode, type ClipRun } from '../components/studio/layerTree';
import { filterForAdjustment, withStrength } from './adjustments';
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
function drawTextLayer(ctx: CanvasRenderingContext2D, text: TextLayerData) {
  ctx.save();

  const layout = layoutText(text);

  const cx = text.x + layout.width / 2;
  const cy = text.y + layout.height / 2;
  ctx.translate(cx, cy);
  ctx.rotate((text.rotation * Math.PI) / 180);
  ctx.translate(-cx, -cy);

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
 * that function for why child count is not a factor.
 */
const isolatesGroup = (layer: SerializedStudioLayer) =>
  layer.opacity < 1 || layer.blendMode !== 'normal';

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
  ctx.globalCompositeOperation = BLEND_TO_COMPOSITE[base.blendMode];
  ctx.drawImage(scratch, 0, 0);
  ctx.restore();
}

async function compositeLeaf(
  ctx: CanvasRenderingContext2D,
  layer: SerializedStudioLayer,
  width: number,
  height: number,
  background?: HTMLImageElement,
): Promise<void> {
  if (!layer.visible) return;

  if (layer.type === 'group' && !isolatesGroup(layer)) {
    await compositeLayers(ctx, layer.children ?? [], width, height, background);
    return;
  }

  ctx.save();
  ctx.globalAlpha = layer.opacity;
  ctx.globalCompositeOperation = BLEND_TO_COMPOSITE[layer.blendMode];

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
  }

  ctx.restore();
}

/** Flattens a Studio export snapshot (background + visible layers, respecting opacity/blend
 *  mode/visibility) into a single raster image blob. JPG has no alpha channel, so it flattens
 *  onto white first, matching standard export conventions. */
export async function compositeFlattenedImage(snapshot: ExportSnapshot, format: ImageExportFormat): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = snapshot.width;
  canvas.height = snapshot.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  if (format === 'jpg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // The background is root index 0 of the layer tree, not a special case drawn beforehand — an
  // adjustment above it has to be able to enclose and filter it, same as on the canvas.
  const background = await loadImage(snapshot.backgroundDataUrl);
  await compositeLayers(ctx, snapshot.layers, canvas.width, canvas.height, background);

  const mime = format === 'png' ? 'image/png' : format === 'webp' ? 'image/webp' : 'image/jpeg';
  const quality = format === 'jpg' ? 0.92 : undefined;
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Failed to encode exported image'))), mime, quality);
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
