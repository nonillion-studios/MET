import { compositeOperationFor, type StudioLayer } from '../components/studio/studioTypes';
import { extractAlpha, outerHalo, innerShadowHalo, innerGlowHalo, bevelMasks, satinMask, strokeRing, paintHalo } from './layerEffects';
import { renderLeafContentOnly, type SampleLayerSource } from './sampleComposite';

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
 */
export function paintLiveEffectCanvases(
  layer: StudioLayer,
  src: SampleLayerSource,
  targets: { behind: HTMLCanvasElement; overlayBase: HTMLCanvasElement; stroke: HTMLCanvasElement },
): void {
  const width = src.width, height = src.height;
  const clear = (c: HTMLCanvasElement) => c.getContext('2d')?.clearRect(0, 0, width, height);
  clear(targets.behind);
  clear(targets.overlayBase);
  clear(targets.stroke);

  const effects = layer.effects;
  if (!effects) return;

  const needsBehind = effects.dropShadow.enabled || effects.outerGlow.enabled;
  const needsOverlayBase = effects.innerShadow.enabled || effects.innerGlow.enabled || effects.bevelEmboss.enabled || effects.satin.enabled;
  const needsStroke = effects.stroke.enabled;
  if (!needsBehind && !needsOverlayBase && !needsStroke) return;

  const content = renderLeafContentOnly(layer, src);
  const contentCtx = content.getContext('2d');
  if (!contentCtx) return;
  const alpha = extractAlpha(contentCtx.getImageData(0, 0, width, height));

  if (needsBehind) {
    const ctx = targets.behind.getContext('2d');
    if (ctx) {
      if (effects.dropShadow.enabled) {
        const halo = outerHalo(alpha, width, height, effects.dropShadow.distance, effects.dropShadow.angle, effects.dropShadow.spread, effects.dropShadow.size);
        paintHalo(ctx, halo, width, height, effects.dropShadow.color, effects.dropShadow.opacity, compositeOperationFor(effects.dropShadow.blendMode));
      }
      if (effects.outerGlow.enabled) {
        const halo = outerHalo(alpha, width, height, 0, 0, effects.outerGlow.spread, effects.outerGlow.size);
        paintHalo(ctx, halo, width, height, effects.outerGlow.color, effects.outerGlow.opacity, compositeOperationFor(effects.outerGlow.blendMode));
      }
    }
  }

  if (needsOverlayBase) {
    const ctx = targets.overlayBase.getContext('2d');
    if (ctx) {
      if (effects.innerShadow.enabled) {
        const halo = innerShadowHalo(alpha, width, height, effects.innerShadow.distance, effects.innerShadow.angle, effects.innerShadow.size);
        paintHalo(ctx, halo, width, height, effects.innerShadow.color, effects.innerShadow.opacity, compositeOperationFor(effects.innerShadow.blendMode));
      }
      if (effects.innerGlow.enabled) {
        const halo = innerGlowHalo(alpha, width, height, effects.innerGlow.size, effects.innerGlow.source ?? 'edge');
        paintHalo(ctx, halo, width, height, effects.innerGlow.color, effects.innerGlow.opacity, compositeOperationFor(effects.innerGlow.blendMode));
      }
      if (effects.bevelEmboss.enabled) {
        const { highlight, shadow } = bevelMasks(alpha, width, height, effects.bevelEmboss);
        paintHalo(ctx, highlight, width, height, effects.bevelEmboss.highlightColor, effects.bevelEmboss.highlightOpacity, compositeOperationFor(effects.bevelEmboss.highlightMode));
        paintHalo(ctx, shadow, width, height, effects.bevelEmboss.shadowColor, effects.bevelEmboss.shadowOpacity, compositeOperationFor(effects.bevelEmboss.shadowMode));
      }
      if (effects.satin.enabled) {
        const halo = satinMask(alpha, width, height, effects.satin);
        paintHalo(ctx, halo, width, height, effects.satin.color, effects.satin.opacity, compositeOperationFor(effects.satin.blendMode));
      }
    }
  }

  if (needsStroke) {
    const ctx = targets.stroke.getContext('2d');
    if (ctx) {
      const ring = strokeRing(alpha, width, height, effects.stroke.size, effects.stroke.position);
      const color = effects.stroke.fillType === 'gradient' ? effects.stroke.gradient.from : effects.stroke.color;
      paintHalo(ctx, ring, width, height, color, effects.stroke.opacity, compositeOperationFor(effects.stroke.blendMode));
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
