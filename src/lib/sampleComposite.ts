import { compositeOperationFor, type StudioLayer } from '../components/studio/studioTypes';
import {
  partitionAdjustments, groupClipRuns, flattenTree, findLayer,
  type RenderNode, type ClipRun,
} from '../components/studio/layerTree';
import { filterForAdjustment, withStrength } from './adjustments';
import { drawTextLayer, drawPathLayer, isolatesGroup } from './exportImage';

/**
 * What the Clone Stamp/Healing Brush source and the Eyedropper read pixels from — the same five
 * options Photoshop's own "Sample" dropdown offers. Lives alongside `PaintSettings` in
 * `paint/paintEngine.ts` as `sampleMode`.
 */
export type SampleMode = 'current' | 'currentBelow' | 'all' | 'allNoAdj' | 'currentBelowNoAdj';

/**
 * Live accessors into the two id-keyed canvas registries (`paintCanvasRegistry`/
 * `maskCanvasRegistry`) `StudioCanvas.tsx` already owns as refs — this module never keeps its own
 * copy of a layer's pixels, it only reads whatever's already there at call time.
 */
export interface SampleLayerSource {
  layers: StudioLayer[];
  background: CanvasImageSource;
  width: number;
  height: number;
  getRaster: (layerId: string) => HTMLCanvasElement | null;
  getMask: (maskId: string) => HTMLCanvasElement | null;
}

/**
 * A synchronous, live-canvas twin of `exportImage.ts`'s `compositeLayers`/`compositeNodes`/
 * `compositeClipRun`/`compositeLeaf` — same compositing rules (adjustments wrap what's below them,
 * clip runs, masks, group isolation via the shared `isolatesGroup`, blend modes), but reading
 * already-decoded `HTMLCanvasElement`s straight out of the live registries instead of `await`ing a
 * `toDataURL`/`Image.onload` round trip. That async path is fine for a one-shot file export; it's
 * too slow to run on every eyedropper hover or clone-stroke pointerdown. Any change to the
 * compositing *rules* (not just perf) should land in both files.
 */
/** Renders just one leaf's own content (no opacity/blend/mask/effects applied) onto a fresh
 *  page-sized canvas — the same synchronous, no-round-trip drawing `drawLeafContentSync` already
 *  does for the sampling compositor, exposed standalone so `liveLayerEffects.ts` can extract a
 *  layer's own alpha silhouette without re-deriving how each layer type draws itself. */
export function renderLeafContentOnly(layer: StudioLayer, src: SampleLayerSource): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = src.width;
  canvas.height = src.height;
  const ctx = canvas.getContext('2d');
  if (ctx) drawLeafContentSync(ctx, layer, src);
  return canvas;
}

function drawLeafContentSync(ctx: CanvasRenderingContext2D, layer: StudioLayer, src: SampleLayerSource): void {
  if (layer.type === 'background') {
    ctx.drawImage(src.background, 0, 0, src.width, src.height);
  } else if (layer.type === 'group') {
    const group = document.createElement('canvas');
    group.width = src.width;
    group.height = src.height;
    const gctx = group.getContext('2d');
    if (gctx) {
      compositeLayersSync(gctx, layer.children ?? [], src);
      ctx.drawImage(group, 0, 0);
    }
  } else if (layer.type === 'clean-patch') {
    const raster = src.getRaster(layer.id);
    if (raster) ctx.drawImage(raster, 0, 0, src.width, src.height);
  } else if (layer.type === 'text' && layer.text && layer.text.content) {
    drawTextLayer(ctx, layer.text);
  } else if (layer.type === 'path' && layer.path) {
    drawPathLayer(ctx, layer.path);
  }
}

function compositeLeafSync(ctx: CanvasRenderingContext2D, layer: StudioLayer, src: SampleLayerSource): void {
  if (!layer.visible) return;
  const activeMask = layer.mask?.enabled ? src.getMask(layer.mask.id) : null;

  if (layer.type === 'group' && !isolatesGroup(layer) && !activeMask) {
    compositeLayersSync(ctx, layer.children ?? [], src);
    return;
  }

  if (activeMask) {
    const scratch = document.createElement('canvas');
    scratch.width = src.width;
    scratch.height = src.height;
    const sctx = scratch.getContext('2d');
    if (!sctx) return;
    drawLeafContentSync(sctx, layer, src);
    sctx.globalCompositeOperation = 'destination-in';
    sctx.drawImage(activeMask, 0, 0, src.width, src.height);

    ctx.save();
    ctx.globalAlpha = layer.opacity;
    ctx.globalCompositeOperation = compositeOperationFor(layer.blendMode);
    ctx.drawImage(scratch, 0, 0);
    ctx.restore();
    return;
  }

  ctx.save();
  ctx.globalAlpha = layer.opacity;
  ctx.globalCompositeOperation = compositeOperationFor(layer.blendMode);
  drawLeafContentSync(ctx, layer, src);
  ctx.restore();
}

function compositeClipRunSync(ctx: CanvasRenderingContext2D, run: ClipRun<StudioLayer>, src: SampleLayerSource): void {
  const { base, followers } = run;
  if (!base.visible) return;

  const scratch = document.createElement('canvas');
  scratch.width = src.width;
  scratch.height = src.height;
  const sctx = scratch.getContext('2d');
  if (!sctx) return;

  drawLeafContentSync(sctx, base, src);
  for (const follower of followers) compositeLeafSync(sctx, follower, src);
  sctx.globalCompositeOperation = 'destination-in';
  drawLeafContentSync(sctx, base, src);

  ctx.save();
  ctx.globalAlpha = base.opacity;
  ctx.globalCompositeOperation = compositeOperationFor(base.blendMode);
  ctx.drawImage(scratch, 0, 0);
  ctx.restore();
}

function compositeNodesSync(ctx: CanvasRenderingContext2D, nodes: RenderNode<StudioLayer>[], src: SampleLayerSource): void {
  let pending: StudioLayer[] = [];
  const flushClipRuns = () => {
    for (const run of groupClipRuns(pending)) {
      if (run.followers.length === 0) compositeLeafSync(ctx, run.base, src);
      else compositeClipRunSync(ctx, run, src);
    }
    pending = [];
  };

  for (const node of nodes) {
    if (node.kind !== 'adjustment') {
      pending.push(node.layer);
      continue;
    }
    flushClipRuns();
    compositeNodesSync(ctx, node.children, src);

    const adj = node.layer;
    if (!adj.visible || !adj.adjustment) continue;
    const imageData = ctx.getImageData(0, 0, src.width, src.height);
    withStrength(filterForAdjustment(adj.adjustment), adj.opacity)(imageData);
    ctx.putImageData(imageData, 0, 0);
  }

  flushClipRuns();
}

function compositeLayersSync(ctx: CanvasRenderingContext2D, layers: StudioLayer[], src: SampleLayerSource): void {
  compositeNodesSync(ctx, partitionAdjustments(layers), src);
}

function stripAdjustments(layers: StudioLayer[]): StudioLayer[] {
  return layers
    .filter((l) => l.type !== 'adjustment')
    .map((l) => (l.type === 'group' && l.children ? { ...l, children: stripAdjustments(l.children) } : l));
}

/**
 * Builds the composite a clone/heal/eyedropper sample should read from, per `mode`. `current` and
 * `currentBelow` truncate to the active layer's own position in **paint order** (`flattenTree`,
 * with group wrapper nodes dropped since their children are already present individually) rather
 * than to its position within just its own parent's children — matching Photoshop's own "Current &
 * Below", which sees through group boundaries. That's a deliberate simplification for a slice that
 * cuts through the middle of a group: the truncated composite ignores that group's own opacity/
 * blend/mask (which only make sense once *all* of the group's children are present), and instead
 * composites the surviving leaves as one flat list. `all`/`allNoAdj` don't truncate, so they go
 * through the full tree-aware path and get real group semantics.
 */
export function compositeLayersForSampling(mode: SampleMode, activeLayerId: string | null, src: SampleLayerSource): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = src.width;
  canvas.height = src.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  if (mode === 'current' && activeLayerId) {
    const raw = src.getRaster(activeLayerId);
    if (raw) {
      ctx.drawImage(raw, 0, 0, src.width, src.height);
      return canvas;
    }
    if (findLayer(src.layers, activeLayerId)?.type === 'background') {
      ctx.drawImage(src.background, 0, 0, src.width, src.height);
      return canvas;
    }
    // No raster of its own (group/text/path/adjustment) — fall through to the slice path below,
    // which composites just that one layer's own content (a group's children, a text/path layer's
    // vector content, or nothing for a bare adjustment, which never holds pixels either way).
  }

  const noAdj = mode === 'allNoAdj' || mode === 'currentBelowNoAdj';
  const workingLayers = noAdj ? stripAdjustments(src.layers) : src.layers;

  if (mode === 'all' || mode === 'allNoAdj') {
    compositeLayersSync(ctx, workingLayers, src);
    return canvas;
  }

  const flat = flattenTree(workingLayers).filter((l) => l.type !== 'group');
  const idx = activeLayerId ? flat.findIndex((l) => l.id === activeLayerId) : -1;
  const slice = idx < 0 ? flat : mode === 'current' ? flat.slice(idx, idx + 1) : flat.slice(0, idx + 1);
  compositeLayersSync(ctx, slice, src);
  return canvas;
}
