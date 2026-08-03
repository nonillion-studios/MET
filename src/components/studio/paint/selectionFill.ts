import { compositeOperationFor, type BlendMode } from '../studioTypes';
import { strokeRing, paintHalo } from '../../../lib/layerEffects';
import { clipToSelection, rasterizeSelectionMask, type Selection } from './selection';

export interface SelectionFill {
  color: string;
  blendMode: BlendMode;
  opacity: number; // 0-1
  preserveTransparency: boolean;
}

/** Marquee context menu > Fill… — same shape as `fillPathOntoCanvas` (clip, set alpha/blend/color,
 *  fill), just clipping to a `Selection` instead of tracing a path's own anchors. */
export function fillSelectionOntoCanvas(ctx: CanvasRenderingContext2D, selection: Selection, fill: SelectionFill): void {
  clipToSelection(ctx, selection);
  ctx.globalAlpha = fill.opacity;
  // Preserve Transparency locks the fill to pixels the canvas already has color on — same
  // 'source-atop' substitution fillPathOntoCanvas's own doc comment explains.
  ctx.globalCompositeOperation = fill.preserveTransparency ? 'source-atop' : compositeOperationFor(fill.blendMode);
  ctx.fillStyle = fill.color;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}

export interface SelectionStroke {
  size: number; // px
  position: 'outside' | 'inside' | 'center';
  color: string;
  blendMode: BlendMode;
  opacity: number; // 0-1 (0-100 UI, converted by the caller)
}

/** Marquee context menu > Stroke… — reuses the exact same dilate/erode ring math the Stroke Layer
 *  Style effect already uses (`strokeRing` in layerEffects.ts), just fed the selection's own
 *  rasterized mask as its source alpha instead of a layer's content silhouette. */
export function strokeSelectionOntoCanvas(ctx: CanvasRenderingContext2D, selection: Selection, width: number, height: number, stroke: SelectionStroke): void {
  const rasterized = rasterizeSelectionMask(selection, width, height);
  // `rasterized.data` is already one alpha byte per pixel (rasterizeSelectionMask's own output
  // shape) — exactly what strokeRing wants, just needs widening to Float32 to match its signature.
  const alpha = Float32Array.from(rasterized.data);
  const ring = strokeRing(alpha, width, height, stroke.size, stroke.position);
  paintHalo(ctx, ring, width, height, stroke.color, stroke.opacity * 100, compositeOperationFor(stroke.blendMode));
}
