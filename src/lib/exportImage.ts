import { BLEND_TO_COMPOSITE, type TextLayerData } from '../components/studio/studioTypes';
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

/** Greedy word-wrap so canvas text export roughly matches Konva's auto-wrapping within `width`. */
function wrapLine(ctx: CanvasRenderingContext2D, line: string, maxWidth: number): string[] {
  const words = line.split(' ');
  const wrapped: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && ctx.measureText(candidate).width > maxWidth) {
      wrapped.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) wrapped.push(current);
  return wrapped.length > 0 ? wrapped : [''];
}

function drawTextLayer(ctx: CanvasRenderingContext2D, text: TextLayerData) {
  ctx.save();
  const cx = text.x + text.width / 2;
  const lineCount = text.content.split('\n').length || 1;
  const cy = text.y + (lineCount * text.fontSize * text.lineHeight) / 2;
  ctx.translate(cx, cy);
  ctx.rotate((text.rotation * Math.PI) / 180);
  ctx.translate(-cx, -cy);

  const style = `${text.italic ? 'italic ' : ''}${text.bold ? 'bold ' : ''}${text.fontSize}px ${text.fontFamily}`;
  ctx.font = style;
  ctx.textBaseline = 'top';
  ctx.textAlign = text.align;
  const anchorX = text.align === 'left' ? text.x : text.align === 'right' ? text.x + text.width : text.x + text.width / 2;

  const lines = text.content.split('\n').flatMap(line => wrapLine(ctx, line, text.width));
  const lineHeightPx = text.fontSize * text.lineHeight;
  lines.forEach((line, i) => {
    const ly = text.y + i * lineHeightPx;
    if (text.strokeWidth > 0) {
      ctx.strokeStyle = text.strokeColor;
      ctx.lineWidth = text.strokeWidth;
      ctx.strokeText(line, anchorX, ly);
    }
    ctx.fillStyle = text.color;
    ctx.fillText(line, anchorX, ly);
  });
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
