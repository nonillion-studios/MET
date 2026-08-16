import type { TextLayerData } from './studioTypes';
import type { TextLayout } from './textLayout';
import { applyLetterSpacing } from './textLayout';
import { runFontString } from './textRuns';
import { gradientVector } from './textGradient';
import { applyTextWarp } from '../../lib/textWarp';

/**
 * Rasterizes a text layer's glyphs in LOCAL coordinates (the box's own top-left as origin, exactly
 * the space `layout.runs[].x/y` already use for the live per-run `Konva.Text` rendering) — not
 * page space like `exportImage.ts`'s `drawTextLayer`, and deliberately ignoring rotation and Type
 * Region/fixed-height clipping: those are already applied at the Konva Group level (the outer
 * Group's own `rotation` prop and `clipFunc`, the inner Group's own `clipX/Y/Width/Height`), so a
 * plain `Konva.Image` swapped in for the per-run nodes inherits them for free without this needing
 * to duplicate that logic.
 */
export function rasterizeTextLocal(text: TextLayerData, layout: TextLayout): HTMLCanvasElement {
  const width = Math.max(1, Math.ceil(layout.width));
  const height = Math.max(1, Math.ceil(layout.height));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

  if (text.shadow?.enabled) {
    ctx.shadowColor = text.shadow.color;
    ctx.shadowBlur = text.shadow.blur;
    ctx.shadowOffsetX = text.shadow.offsetX;
    ctx.shadowOffsetY = text.shadow.offsetY;
  }

  let gradientFill: CanvasGradient | null = null;
  if (text.gradient?.enabled) {
    const { start, end } = gradientVector(layout.width, layout.height, text.gradient.angle);
    gradientFill = ctx.createLinearGradient(start.x, start.y, end.x, end.y);
    gradientFill.addColorStop(0, text.gradient.from);
    gradientFill.addColorStop(1, text.gradient.to);
  }

  for (const run of layout.runs) {
    const drawText = run.drawText ?? run.text;
    ctx.font = runFontString(run.style);
    applyLetterSpacing(ctx, run.style.letterSpacing);
    if (text.strokeWidth > 0) {
      ctx.strokeStyle = text.strokeColor;
      ctx.lineWidth = text.strokeWidth;
      ctx.strokeText(drawText, run.x, run.y);
    }
    ctx.fillStyle = gradientFill ?? run.style.color;
    ctx.fillText(drawText, run.x, run.y);
  }

  return canvas;
}

/** Rasterizes and (if `text.warp` is set to a real style) warps a text layer's glyphs, all in the
 *  same local coordinate space `rasterizeTextLocal` uses — the single entry point both
 *  `TextLayerNode.tsx`'s live render and `exportImage.ts`'s flatten path call, so the two can never
 *  disagree about what a warped text layer looks like. */
export function rasterizeWarpedTextLocal(text: TextLayerData, layout: TextLayout): HTMLCanvasElement {
  const base = rasterizeTextLocal(text, layout);
  if (!text.warp || text.warp.style === 'none') return base;
  return applyTextWarp(base, text.warp);
}
