import { BLEND_TO_COMPOSITE, type TextLayerData } from '../components/studio/studioTypes';
import { gradientVector } from '../components/studio/textGradient';
import { layoutText, applyLetterSpacing } from '../components/studio/textLayout';
import { runFontString } from '../components/studio/textRuns';
import type { ExportSnapshot } from '../components/studio/StudioCanvas';

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

  const background = await loadImage(snapshot.backgroundDataUrl);
  ctx.drawImage(background, 0, 0, canvas.width, canvas.height);

  for (const layer of snapshot.layers) {
    if (layer.isBackground || !layer.visible) continue;
    ctx.save();
    ctx.globalAlpha = layer.opacity;
    ctx.globalCompositeOperation = BLEND_TO_COMPOSITE[layer.blendMode];
    if (layer.raster) {
      const img = await loadImage(layer.raster);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    } else if (layer.type === 'text' && layer.text && layer.text.content) {
      drawTextLayer(ctx, layer.text);
    }
    ctx.restore();
  }

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
