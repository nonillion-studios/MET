import { clipToSelection, magicWandMask, type Selection } from './selection';

export type PaintTool =
  | 'brush' | 'pencil' | 'eraser' | 'bucket' | 'gradient' | 'clone'
  | 'blur' | 'sharpen' | 'smudge' | 'dodge' | 'burn' | 'sponge' | 'contentAware'
  | 'shape-rect' | 'shape-ellipse' | 'shape-line' | 'spot-heal';

export interface PaintSettings {
  size: number;
  hardness: number; // 0-1
  opacity: number; // 0-1
  flow: number; // 0-1
  color: string; // hex
  tolerance: number; // 0-255, used by bucket/wand
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** One soft (or hard, at hardness=1) circular stamp — the shared primitive behind every brush-family tool. */
function stamp(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, rgb: [number, number, number], hardness: number, alpha: number) {
  ctx.globalAlpha = alpha;
  const [r, g, b] = rgb;
  const grad = ctx.createRadialGradient(x, y, 0, x, y, size / 2);
  grad.addColorStop(0, `rgba(${r},${g},${b},1)`);
  grad.addColorStop(Math.max(0.01, Math.min(0.99, hardness)), `rgba(${r},${g},${b},1)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, size / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

/** Brush / Pencil / Eraser: interpolated stamps along a segment so fast strokes stay continuous. */
export function strokeSegment(
  ctx: CanvasRenderingContext2D,
  x0: number, y0: number, x1: number, y1: number,
  settings: PaintSettings,
  tool: 'brush' | 'pencil' | 'eraser',
  selection: Selection,
) {
  clipToSelection(ctx, selection);
  ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
  const [r, g, b] = tool === 'eraser' ? [0, 0, 0] : hexToRgb(settings.color);
  const hardness = tool === 'pencil' ? 1 : settings.hardness;
  const size = tool === 'pencil' ? Math.max(1, Math.round(settings.size / 4)) : settings.size;
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const step = Math.max(1, size * 0.15);
  for (let d = 0; d <= dist; d += step) {
    const t = dist ? d / dist : 0;
    stamp(ctx, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, size, [r, g, b], hardness, settings.opacity * settings.flow);
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();
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

/** Content-Aware Fill (basic, non-AI): averages the colors just outside a rect and fills it with light organic noise. Ported from the legacy prototype. */
export function contentAwareFill(ctx: CanvasRenderingContext2D, rect: { x: number; y: number; width: number; height: number }) {
  const { x, y, width, height } = rect;
  const clampX = (v: number) => Math.max(0, Math.min(ctx.canvas.width - 1, v));
  const clampY = (v: number) => Math.max(0, Math.min(ctx.canvas.height - 1, v));
  const samplePts: [number, number][] = [
    [x - 6, y + height / 2], [x + width + 6, y + height / 2],
    [x + width / 2, y - 6], [x + width / 2, y + height + 6],
  ];
  let r = 0, g = 0, b = 0;
  for (const [sx, sy] of samplePts) {
    const d = ctx.getImageData(clampX(sx), clampY(sy), 1, 1).data;
    r += d[0]; g += d[1]; b += d[2];
  }
  r = Math.round(r / samplePts.length);
  g = Math.round(g / samplePts.length);
  b = Math.round(b / samplePts.length);

  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.fillRect(x, y, width, height);
  for (let i = 0; i < (width * height) / 300; i++) {
    ctx.globalAlpha = 0.05 + Math.random() * 0.06;
    ctx.fillStyle = Math.random() > 0.5 ? '#000' : '#fff';
    ctx.beginPath();
    ctx.arc(x + Math.random() * width, y + Math.random() * height, 1 + Math.random() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
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

/** Basic Pen tool: a straight-edged closed/open path, stroked and/or filled onto the active layer on commit. */
export function strokePenPath(
  ctx: CanvasRenderingContext2D,
  points: { x: number; y: number }[],
  closed: boolean,
  style: ShapeStyle,
  selection: Selection,
) {
  if (points.length < 2) return;
  clipToSelection(ctx, selection);
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (const p of points.slice(1)) ctx.lineTo(p.x, p.y);
  if (closed) ctx.closePath();
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
