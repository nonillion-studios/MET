import { compositeOperationFor, type LayerEffects, type StudioLayer } from '../components/studio/studioTypes';
import { extractAlpha, outerHalo, innerShadowHalo, innerGlowHalo, bevelMasks, satinMask, strokeRing, paintHalo } from './layerEffects';
import { renderLeafContentOnly, type SampleLayerSource } from './sampleComposite';

/** A page-space pixel rect known to be the only region whose content actually changed (e.g. a
 *  brush stroke's accumulated bounding box) — lets `paintLiveEffectCanvases` recompute just that
 *  region instead of the full page. Omit entirely when no such region is known (a structural/
 *  effect-parameter change, or the first recompute after a fresh mount) — the full page is always
 *  correct; a box is only ever an optimization, never required for correctness. */
export interface EffectDirtyBox { minX: number; minY: number; maxX: number; maxY: number; }

/** How far (in px) any one of `effects`' enabled halo effects can reach from a source pixel it's
 *  derived from — the blur/offset/sample radius that must be included around a dirty box so the
 *  cropped recompute sees the same neighboring alpha the effect would read at full-page scope.
 *  Every halo function in `layerEffects.ts` is local (bounded blur + bounded shift), so padding a
 *  dirty box by this amount makes a region-scoped recompute exact, not approximate — a halo pixel
 *  further than this from any changed alpha pixel provably can't have changed. */
export function maxEffectReach(effects: LayerEffects): number {
  let reach = 0;
  const consider = (v: number) => { if (v > reach) reach = v; };
  if (effects.dropShadow.enabled) consider(effects.dropShadow.distance + effects.dropShadow.size);
  if (effects.outerGlow.enabled) consider(effects.outerGlow.size);
  if (effects.innerShadow.enabled) consider(effects.innerShadow.distance + effects.innerShadow.size);
  if (effects.innerGlow.enabled) consider(effects.innerGlow.size);
  if (effects.bevelEmboss.enabled) consider(effects.bevelEmboss.soften + effects.bevelEmboss.size);
  if (effects.satin.enabled) consider(effects.satin.distance + effects.satin.size);
  if (effects.stroke.enabled) consider(effects.stroke.size);
  return reach;
}

/**
 * Live-canvas counterpart to `exportImage.ts`'s `applyLeafEffects` — reuses the exact same halo
 * math from `layerEffects.ts` rather than re-deriving it, so the on-screen preview and the
 * flattened export can never drift.
 *
 * Color Overlay / Gradient Overlay are deliberately NOT painted here: those two already render
 * live via a `source-atop` Konva Rect directly inside the layer's own cached Group (see
 * `StudioCanvas.tsx`'s `renderLeaf`), which needs the real cached content underneath to know what
 * "atop" means. The five effects this file *does* handle are different: every halo function in
 * `layerEffects.ts` (`outerHalo`, `innerShadowHalo`, `innerGlowHalo`, `bevelMasks`, `satinMask`,
 * `strokeRing`) already multiplies its own output by the source alpha (or is computed from a
 * dilate/erode of it), so the result is already zero outside the layer's own silhouette — it never
 * needs real content pixels as a backdrop, and can be drawn as a plain, self-contained extra
 * `Konva.Image` layered at the right position instead.
 *
 * Draws directly into the three caller-owned target canvases (mirrors `paintCanvasRegistry`'s
 * "one persistent canvas per id, mutated in place" convention) rather than allocating fresh ones,
 * so a `Konva.Image` pointed at a target only ever needs a `.batchDraw()` to pick up a change, the
 * same as the main paint canvases already do.
 *
 * `dirtyBox`, when given, scopes every step (content render's getImageData crop, alpha extraction,
 * every blur/halo pass, and the final composite) to that region padded by `maxEffectReach` instead
 * of the full page — the dominant cost here is the per-pixel JS loops (`extractAlpha` and the
 * blur/halo math), not the single `renderLeafContentOnly` drawImage call, so cropping before those
 * loops run is what actually matters. Omitted (full-page) for the first recompute of a layer and
 * for any non-paint-stroke trigger (an effect's own parameters changing, mask edits, etc.), where
 * there's no known "only this region changed" guarantee to exploit.
 *
 * Padding is `2×` the effect's reach, not `1×`: a composited output pixel right at the padded
 * region's own edge itself needs input samples up to `reach` beyond *it*, not just beyond the
 * original dirty box — so the region has to be big enough to give its own boundary pixels correct
 * context, or they'd read a locally-clamped edge instead of the real neighboring content. The
 * resulting extra margin (still tiny next to a full manga page) is deliberately generous rather
 * than exact, consistent with this module's "real technique, honestly scoped" standard elsewhere.
 */
export function paintLiveEffectCanvases(
  layer: StudioLayer,
  src: SampleLayerSource,
  targets: { behind: HTMLCanvasElement; overlayBase: HTMLCanvasElement; stroke: HTMLCanvasElement },
  dirtyBox?: EffectDirtyBox,
): void {
  const width = src.width, height = src.height;
  const effects = layer.effects;

  const needsBehind = !!effects && (effects.dropShadow.enabled || effects.outerGlow.enabled);
  const needsOverlayBase = !!effects && (effects.innerShadow.enabled || effects.innerGlow.enabled || effects.bevelEmboss.enabled || effects.satin.enabled);
  const needsStroke = !!effects && effects.stroke.enabled;

  if (!effects || (!needsBehind && !needsOverlayBase && !needsStroke)) {
    // Nothing enabled — go fully blank across the whole canvas (not just the dirty box): an effect
    // that was just disabled needs its old halo gone across its entire previous extent, which this
    // function has no record of, so a full clear is the only safe move here regardless of dirtyBox.
    const clear = (c: HTMLCanvasElement) => c.getContext('2d')?.clearRect(0, 0, width, height);
    clear(targets.behind);
    clear(targets.overlayBase);
    clear(targets.stroke);
    return;
  }

  const pad = dirtyBox ? Math.ceil(maxEffectReach(effects)) * 2 + 8 : 0;
  const rx = dirtyBox ? Math.max(0, Math.floor(dirtyBox.minX) - pad) : 0;
  const ry = dirtyBox ? Math.max(0, Math.floor(dirtyBox.minY) - pad) : 0;
  const rMaxX = dirtyBox ? Math.min(width, Math.ceil(dirtyBox.maxX) + pad) : width;
  const rMaxY = dirtyBox ? Math.min(height, Math.ceil(dirtyBox.maxY) + pad) : height;
  const rw = Math.max(1, rMaxX - rx);
  const rh = Math.max(1, rMaxY - ry);

  const clearRegion = (c: HTMLCanvasElement) => c.getContext('2d')?.clearRect(rx, ry, rw, rh);
  clearRegion(targets.behind);
  clearRegion(targets.overlayBase);
  clearRegion(targets.stroke);

  const content = renderLeafContentOnly(layer, src);
  const contentCtx = content.getContext('2d');
  if (!contentCtx) return;
  const alpha = extractAlpha(contentCtx.getImageData(rx, ry, rw, rh));

  if (needsBehind) {
    const ctx = targets.behind.getContext('2d');
    if (ctx) {
      if (effects.dropShadow.enabled) {
        const halo = outerHalo(alpha, rw, rh, effects.dropShadow.distance, effects.dropShadow.angle, effects.dropShadow.spread, effects.dropShadow.size);
        paintHalo(ctx, halo, rw, rh, effects.dropShadow.color, effects.dropShadow.opacity, compositeOperationFor(effects.dropShadow.blendMode), rx, ry);
      }
      if (effects.outerGlow.enabled) {
        const halo = outerHalo(alpha, rw, rh, 0, 0, effects.outerGlow.spread, effects.outerGlow.size);
        paintHalo(ctx, halo, rw, rh, effects.outerGlow.color, effects.outerGlow.opacity, compositeOperationFor(effects.outerGlow.blendMode), rx, ry);
      }
    }
  }

  if (needsOverlayBase) {
    const ctx = targets.overlayBase.getContext('2d');
    if (ctx) {
      if (effects.innerShadow.enabled) {
        const halo = innerShadowHalo(alpha, rw, rh, effects.innerShadow.distance, effects.innerShadow.angle, effects.innerShadow.size);
        paintHalo(ctx, halo, rw, rh, effects.innerShadow.color, effects.innerShadow.opacity, compositeOperationFor(effects.innerShadow.blendMode), rx, ry);
      }
      if (effects.innerGlow.enabled) {
        const halo = innerGlowHalo(alpha, rw, rh, effects.innerGlow.size, effects.innerGlow.source ?? 'edge');
        paintHalo(ctx, halo, rw, rh, effects.innerGlow.color, effects.innerGlow.opacity, compositeOperationFor(effects.innerGlow.blendMode), rx, ry);
      }
      if (effects.bevelEmboss.enabled) {
        const { highlight, shadow } = bevelMasks(alpha, rw, rh, effects.bevelEmboss);
        paintHalo(ctx, highlight, rw, rh, effects.bevelEmboss.highlightColor, effects.bevelEmboss.highlightOpacity, compositeOperationFor(effects.bevelEmboss.highlightMode), rx, ry);
        paintHalo(ctx, shadow, rw, rh, effects.bevelEmboss.shadowColor, effects.bevelEmboss.shadowOpacity, compositeOperationFor(effects.bevelEmboss.shadowMode), rx, ry);
      }
      if (effects.satin.enabled) {
        const halo = satinMask(alpha, rw, rh, effects.satin);
        paintHalo(ctx, halo, rw, rh, effects.satin.color, effects.satin.opacity, compositeOperationFor(effects.satin.blendMode), rx, ry);
      }
    }
  }

  if (needsStroke) {
    const ctx = targets.stroke.getContext('2d');
    if (ctx) {
      const ring = strokeRing(alpha, rw, rh, effects.stroke.size, effects.stroke.position);
      const color = effects.stroke.fillType === 'gradient' ? effects.stroke.gradient.from : effects.stroke.color;
      paintHalo(ctx, ring, rw, rh, color, effects.stroke.opacity, compositeOperationFor(effects.stroke.blendMode), rx, ry);
    }
  }
}

/** Whether `layer` has any effect enabled that `paintLiveEffectCanvases` actually draws — used to
 *  skip the (comparatively expensive, blur-heavy) recompute entirely for the common case of a
 *  layer with no Layer Style, or one using only Color/Gradient Overlay (already handled elsewhere). */
export function hasLiveHaloEffects(layer: StudioLayer): boolean {
  const e = layer.effects;
  if (!e) return false;
  return e.dropShadow.enabled || e.outerGlow.enabled || e.innerShadow.enabled || e.innerGlow.enabled
    || e.bevelEmboss.enabled || e.satin.enabled || e.stroke.enabled;
}
