import { flattenPathToPolygon } from '../pathGeometry';
import type { PathLayerData } from '../studioTypes';

/** A point in page-image pixel space. */
export interface Point {
  x: number;
  y: number;
}

/**
 * Every paint tool clips against whichever of these is active. Vector shapes
 * (rect/ellipse/polygon) clip live via Path2D; a bitmap mask (magic wand) is
 * approximated live by its bounding box and corrected pixel-perfectly once
 * the stroke commits (see `refineMaskedRegion`) — precise per-stamp masking
 * would mean re-rastering the whole mask on every pointermove, which isn't
 * worth the cost for a marquee-ants selection that rarely moves mid-stroke.
 */
export type Selection =
  | { kind: 'none' }
  | { kind: 'rect'; x: number; y: number; width: number; height: number }
  | { kind: 'ellipse'; x: number; y: number; width: number; height: number }
  | { kind: 'polygon'; points: Point[] }
  | { kind: 'mask'; data: Uint8ClampedArray; width: number; height: number; bounds: { x: number; y: number; width: number; height: number } };

export const NO_SELECTION: Selection = { kind: 'none' };

export function hasSelection(sel: Selection): boolean {
  return sel.kind !== 'none';
}

/**
 * The selection's own bounding box, without rasterizing it — a rect/ellipse/polygon computes this
 * directly; a mask already carries its own bounds from whatever built it. Type Region uses this to
 * size a new text container to whatever shape the selection was, regardless of which tool made it.
 */
export function selectionBounds(sel: Selection): { x: number; y: number; width: number; height: number } | null {
  if (sel.kind === 'none') return null;
  if (sel.kind === 'rect' || sel.kind === 'ellipse') return { x: sel.x, y: sel.y, width: sel.width, height: sel.height };
  if (sel.kind === 'mask') return sel.bounds;
  const xs = sel.points.map(p => p.x);
  const ys = sel.points.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Builds the Path2D a selection clips paint against. Exported (only) for Type Region's Konva
 * `clipFunc`, which needs the exact same shape — translated into the text layer's local coordinate
 * space — so a live-editing bubble visually clips to the region it was created from.
 */
export function pathForSelection(sel: Selection): Path2D | null {
  if (sel.kind === 'rect') {
    const p = new Path2D();
    p.rect(sel.x, sel.y, sel.width, sel.height);
    return p;
  }
  if (sel.kind === 'ellipse') {
    const p = new Path2D();
    p.ellipse(sel.x + sel.width / 2, sel.y + sel.height / 2, Math.abs(sel.width) / 2, Math.abs(sel.height) / 2, 0, 0, Math.PI * 2);
    return p;
  }
  if (sel.kind === 'polygon' && sel.points.length > 1) {
    const p = new Path2D();
    p.moveTo(sel.points[0].x, sel.points[0].y);
    for (const pt of sel.points.slice(1)) p.lineTo(pt.x, pt.y);
    p.closePath();
    return p;
  }
  if (sel.kind === 'mask') {
    const p = new Path2D();
    p.rect(sel.bounds.x, sel.bounds.y, sel.bounds.width, sel.bounds.height);
    return p;
  }
  return null;
}

/** Clips `ctx` to the selection for the duration of a paint op. Always pair with `ctx.restore()`. */
export function clipToSelection(ctx: CanvasRenderingContext2D, sel: Selection): void {
  ctx.save();
  const path = pathForSelection(sel);
  if (path) ctx.clip(path);
}

// Scratch context reused for point-in-path hit tests — never drawn to, just borrowed for its
// `isPointInPath`, so one shared instance avoids allocating a canvas per hit test.
const hitTestCanvas = document.createElement('canvas');
const hitTestCtx = hitTestCanvas.getContext('2d')!;

/** Whether image-space point (x, y) falls inside the selection's own shape (not just its bounding box). */
export function selectionContainsPoint(sel: Selection, x: number, y: number): boolean {
  if (sel.kind === 'none') return false;
  if (sel.kind === 'mask') {
    const px = Math.floor(x), py = Math.floor(y);
    if (px < 0 || py < 0 || px >= sel.width || py >= sel.height) return false;
    return sel.data[py * sel.width + px] > 0;
  }
  const path = pathForSelection(sel);
  return !!path && hitTestCtx.isPointInPath(path, x, y);
}

/** Shifts a selection by (dx, dy), used to keep a selection tracking pixel content dragged within it. */
export function translateSelection(sel: Selection, dx: number, dy: number, width: number, height: number): Selection {
  if (dx === 0 && dy === 0) return sel;
  if (sel.kind === 'none') return sel;
  if (sel.kind === 'rect' || sel.kind === 'ellipse') return { ...sel, x: sel.x + dx, y: sel.y + dy };
  if (sel.kind === 'polygon') return { ...sel, points: sel.points.map(p => ({ x: p.x + dx, y: p.y + dy })) };
  // mask: only the old bounds region can possibly be non-zero, so only copy that rect across.
  const data = new Uint8ClampedArray(width * height);
  const b = sel.bounds;
  let minX = width, maxX = 0, minY = height, maxY = 0, any = false;
  for (let row = 0; row < b.height; row++) {
    const srcY = b.y + row;
    const destY = srcY + dy;
    if (destY < 0 || destY >= height) continue;
    for (let col = 0; col < b.width; col++) {
      const srcX = b.x + col;
      const destX = srcX + dx;
      if (destX < 0 || destX >= width) continue;
      const v = sel.data[srcY * sel.width + srcX];
      if (v > 0) {
        data[destY * width + destX] = v;
        any = true;
        if (destX < minX) minX = destX;
        if (destX > maxX) maxX = destX;
        if (destY < minY) minY = destY;
        if (destY > maxY) maxY = destY;
      }
    }
  }
  const bounds = any
    ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
    : { x: 0, y: 0, width: 0, height: 0 };
  return { kind: 'mask', data, width, height, bounds };
}

/**
 * After a masked stroke commits, re-applies the bitmap mask's exact alpha to
 * the bounding-box region that was just painted (undoes the bbox-only
 * approximation used for live feedback during the stroke). Blends
 * proportionally to each mask pixel's alpha rather than a hard threshold, so
 * feathered selections (see `featherSelection`) actually produce a soft edge
 * instead of a stair-stepped one.
 */
export function refineMaskedRegion(ctx: CanvasRenderingContext2D, sel: Selection, before: ImageData): void {
  if (sel.kind !== 'mask') return;
  const { x, y, width, height } = sel.bounds;
  if (width <= 0 || height <= 0) return;
  const after = ctx.getImageData(x, y, width, height);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const maskIdx = (y + row) * sel.width + (x + col);
      const alpha = sel.data[maskIdx] / 255;
      if (alpha < 1) {
        const i = (row * width + col) * 4;
        after.data[i] = before.data[i] * (1 - alpha) + after.data[i] * alpha;
        after.data[i + 1] = before.data[i + 1] * (1 - alpha) + after.data[i + 1] * alpha;
        after.data[i + 2] = before.data[i + 2] * (1 - alpha) + after.data[i + 2] * alpha;
        after.data[i + 3] = before.data[i + 3] * (1 - alpha) + after.data[i + 3] * alpha;
      }
    }
  }
  ctx.putImageData(after, x, y);
}

/** Shift/Alt-driven combine mode when starting a new marquee/lasso/wand selection over an existing one. */
export type SelectionCombineMode = 'replace' | 'add' | 'subtract' | 'intersect';

export function combineModeFromModifiers(shiftKey: boolean, altKey: boolean): SelectionCombineMode {
  if (shiftKey && altKey) return 'intersect';
  if (shiftKey) return 'add';
  if (altKey) return 'subtract';
  return 'replace';
}

/** Rasterizes any selection kind to a full-canvas-sized mask (empty mask for 'none'). */
export function rasterizeSelectionMask(sel: Selection, width: number, height: number): Selection & { kind: 'mask' } {
  if (sel.kind === 'mask' && sel.width === width && sel.height === height) return sel;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  if (sel.kind === 'mask') {
    // Different-sized mask (shouldn't normally happen) — draw its bounds region as an opaque box.
    ctx.fillStyle = '#fff';
    ctx.fillRect(sel.bounds.x, sel.bounds.y, sel.bounds.width, sel.bounds.height);
  } else {
    const path = pathForSelection(sel);
    if (path) { ctx.fillStyle = '#fff'; ctx.fill(path); }
  }
  const data = ctx.getImageData(0, 0, width, height);
  const mask = new Uint8ClampedArray(width * height);
  let minX = width, maxX = 0, minY = height, maxY = 0;
  let any = false;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = data.data[(y * width + x) * 4 + 3];
      mask[y * width + x] = a;
      if (a > 0) {
        any = true;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const bounds = any
    ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
    : { x: 0, y: 0, width: 0, height: 0 };
  return { kind: 'mask', data: mask, width, height, bounds };
}

/** Combines an existing selection with a newly-drawn one (Photoshop Shift=add / Alt=subtract convention). */
export function combineSelections(base: Selection, incoming: Selection, mode: SelectionCombineMode, width: number, height: number): Selection {
  if (mode === 'replace' || base.kind === 'none') return incoming;
  const baseMask = rasterizeSelectionMask(base, width, height);
  const incomingMask = rasterizeSelectionMask(incoming, width, height);
  const result = new Uint8ClampedArray(width * height);
  let minX = width, maxX = 0, minY = height, maxY = 0;
  let any = false;
  for (let i = 0; i < result.length; i++) {
    const b = baseMask.data[i], n = incomingMask.data[i];
    const v = mode === 'add' ? Math.max(b, n) : mode === 'subtract' ? Math.max(0, b - n) : Math.min(b, n);
    result[i] = v;
    if (v > 0) {
      any = true;
      const x = i % width, y = Math.floor(i / width);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const bounds = any
    ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
    : { x: 0, y: 0, width: 0, height: 0 };
  return { kind: 'mask', data: result, width, height, bounds };
}

/** Grows (positive) or shrinks (negative) a selection's edge by `amount` pixels via iterative 1px morphology. */
export function growSelection(sel: Selection, amount: number, width: number, height: number): Selection {
  if (amount === 0 || sel.kind === 'none') return sel;
  const rasterized = rasterizeSelectionMask(sel, width, height);
  let data = rasterized.data;
  const dilate = amount > 0;
  const passes = Math.abs(Math.round(amount));
  for (let pass = 0; pass < passes; pass++) {
    const next = new Uint8ClampedArray(data.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        let v = data[i];
        const neighbors = [
          x > 0 ? data[i - 1] : (dilate ? 0 : 255),
          x < width - 1 ? data[i + 1] : (dilate ? 0 : 255),
          y > 0 ? data[i - width] : (dilate ? 0 : 255),
          y < height - 1 ? data[i + width] : (dilate ? 0 : 255),
        ];
        v = dilate ? Math.max(v, ...neighbors) : Math.min(v, ...neighbors);
        next[i] = v;
      }
    }
    data = next;
  }
  let minX = width, maxX = 0, minY = height, maxY = 0, any = false;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[y * width + x] > 0) {
        any = true;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const bounds = any
    ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
    : { x: 0, y: 0, width: 0, height: 0 };
  return { kind: 'mask', data, width, height, bounds };
}

/** Softens a selection's edge with a 3-pass box blur (approximates a Gaussian) over the given radius. */
export function featherSelection(sel: Selection, radius: number, width: number, height: number): Selection {
  if (radius <= 0 || sel.kind === 'none') return sel;
  const rasterized = rasterizeSelectionMask(sel, width, height);
  let data = rasterized.data;
  const r = Math.max(1, Math.round(radius));
  for (let pass = 0; pass < 3; pass++) {
    data = boxBlurPass(data, width, height, r);
  }
  let minX = width, maxX = 0, minY = height, maxY = 0, any = false;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[y * width + x] > 0) {
        any = true;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const bounds = any
    ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
    : { x: 0, y: 0, width: 0, height: 0 };
  return { kind: 'mask', data, width, height, bounds };
}

function boxBlurPass(src: Uint8ClampedArray, width: number, height: number, r: number): Uint8ClampedArray {
  const horiz = new Uint8ClampedArray(src.length);
  const windowSize = r * 2 + 1;
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += src[y * width + Math.min(width - 1, Math.max(0, x))];
    for (let x = 0; x < width; x++) {
      horiz[y * width + x] = sum / windowSize;
      const addX = Math.min(width - 1, x + r + 1);
      const removeX = Math.max(0, x - r);
      sum += src[y * width + addX] - src[y * width + removeX];
    }
  }
  const out = new Uint8ClampedArray(src.length);
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += horiz[Math.min(height - 1, Math.max(0, y)) * width + x];
    for (let y = 0; y < height; y++) {
      out[y * width + x] = sum / windowSize;
      const addY = Math.min(height - 1, y + r + 1);
      const removeY = Math.max(0, y - r);
      sum += horiz[addY * width + x] - horiz[removeY * width + x];
    }
  }
  return out;
}

/** Flood-fills a selection mask by color similarity, starting at (x, y). Shared core with Paint Bucket's fill. */
export function magicWandMask(source: CanvasRenderingContext2D, width: number, height: number, x: number, y: number, tolerance: number): Selection {
  const img = source.getImageData(0, 0, width, height);
  const d = img.data;
  const startIdx = (Math.floor(y) * width + Math.floor(x)) * 4;
  if (startIdx < 0 || startIdx >= d.length) return NO_SELECTION;
  const sr = d[startIdx], sg = d[startIdx + 1], sb = d[startIdx + 2];
  const mask = new Uint8ClampedArray(width * height);
  const seen = new Uint8Array(width * height);
  const stack: number[] = [Math.floor(y) * width + Math.floor(x)];
  seen[stack[0]] = 1;
  let minX = width, maxX = 0, minY = height, maxY = 0;
  const tol = tolerance * tolerance * 3;

  const close = (p: number) => {
    const i = p * 4;
    const dr = d[i] - sr, dg = d[i + 1] - sg, db = d[i + 2] - sb;
    return dr * dr + dg * dg + db * db <= tol;
  };

  while (stack.length) {
    const p = stack.pop()!;
    mask[p] = 255;
    const px = p % width, py = Math.floor(p / width);
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
    if (px > 0 && !seen[p - 1] && close(p - 1)) { seen[p - 1] = 1; stack.push(p - 1); }
    if (px < width - 1 && !seen[p + 1] && close(p + 1)) { seen[p + 1] = 1; stack.push(p + 1); }
    if (py > 0 && !seen[p - width] && close(p - width)) { seen[p - width] = 1; stack.push(p - width); }
    if (py < height - 1 && !seen[p + width] && close(p + width)) { seen[p + width] = 1; stack.push(p + width); }
  }

  return {
    kind: 'mask',
    data: mask,
    width,
    height,
    bounds: { x: minX, y: minY, width: Math.max(1, maxX - minX + 1), height: Math.max(1, maxY - minY + 1) },
  };
}

function boundsOfMask(data: Uint8ClampedArray, width: number, height: number): { x: number; y: number; width: number; height: number } {
  let minX = width, maxX = 0, minY = height, maxY = 0, any = false;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[y * width + x] > 0) {
        any = true;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return any ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : { x: 0, y: 0, width: 0, height: 0 };
}

/** Affine transform for Transform Selection: rotate/scale around (pivotX, pivotY), then translate by (dx, dy). */
export interface SelectionTransform {
  dx: number;
  dy: number;
  scaleX: number;
  scaleY: number;
  rotationRad: number;
  pivotX: number;
  pivotY: number;
}

/**
 * Reshapes a selection by an arbitrary affine transform (Select > Transform Selection) — moves,
 * scales and/or rotates the selection's own geometry, without touching any pixel content. Any
 * selection kind (rect/ellipse/polygon/mask) is rasterized first and transformed as a bitmap via a
 * canvas 2D transform, since rotation and non-uniform scale can't be represented by the vector
 * kinds (an ellipse selection has no rotation field, a rect can't shear into a rotated rect). This
 * costs precision on an unrotated pure move/resize (which the vector kinds would represent
 * exactly) in exchange for one implementation that handles every transform uniformly.
 */
export function transformSelectionMask(sel: Selection, t: SelectionTransform, width: number, height: number): Selection {
  if (sel.kind === 'none') return sel;
  const rasterized = rasterizeSelectionMask(sel, width, height);
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = width;
  srcCanvas.height = height;
  const srcImg = srcCanvas.getContext('2d')!.createImageData(width, height);
  for (let i = 0; i < rasterized.data.length; i++) {
    srcImg.data[i * 4] = 255;
    srcImg.data[i * 4 + 1] = 255;
    srcImg.data[i * 4 + 2] = 255;
    srcImg.data[i * 4 + 3] = rasterized.data[i];
  }
  srcCanvas.getContext('2d')!.putImageData(srcImg, 0, 0);

  const dstCanvas = document.createElement('canvas');
  dstCanvas.width = width;
  dstCanvas.height = height;
  const dstCtx = dstCanvas.getContext('2d')!;
  dstCtx.translate(t.pivotX + t.dx, t.pivotY + t.dy);
  dstCtx.rotate(t.rotationRad);
  dstCtx.scale(t.scaleX, t.scaleY);
  dstCtx.translate(-t.pivotX, -t.pivotY);
  dstCtx.drawImage(srcCanvas, 0, 0);

  const out = dstCtx.getImageData(0, 0, width, height);
  const data = new Uint8ClampedArray(width * height);
  for (let i = 0; i < data.length; i++) data[i] = out.data[i * 4 + 3];
  return { kind: 'mask', data, width, height, bounds: boundsOfMask(data, width, height) };
}

/**
 * Builds a transparent canvas whose alpha channel is the selection's mask strength (RGB is
 * irrelevant, kept white) — used to seed Quick Mask mode's paint buffer from the current selection.
 */
export function selectionToAlphaCanvas(sel: Selection, width: number, height: number): HTMLCanvasElement {
  const rasterized = rasterizeSelectionMask(sel, width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(width, height);
  for (let i = 0; i < rasterized.data.length; i++) {
    img.data[i * 4] = 255;
    img.data[i * 4 + 1] = 255;
    img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = rasterized.data[i];
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * Reads a Quick Mask paint buffer's alpha channel back into a selection. Any normal paint tool
 * (brush, eraser, shapes, gradient…) already accumulates alpha exactly like this when painted onto
 * a transparent canvas, which is what lets Quick Mask reuse the whole existing paint engine
 * unmodified — painting adds to the mask, erasing removes from it, a soft brush edge gives a
 * feathered partial selection, all for free.
 */
export function alphaMaskToSelection(canvas: HTMLCanvasElement): Selection {
  const { width, height } = canvas;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.getImageData(0, 0, width, height);
  const data = new Uint8ClampedArray(width * height);
  for (let i = 0; i < data.length; i++) data[i] = img.data[i * 4 + 3];
  const bounds = boundsOfMask(data, width, height);
  if (bounds.width === 0) return NO_SELECTION;
  return { kind: 'mask', data, width, height, bounds };
}

/**
 * Select > Make Selection from Path — flattens the path's bezier curves into a dense point list
 * (polygon selections have no bezier concept of their own) and wraps it as an ordinary polygon
 * selection, which already does everything downstream (marching ants, clipToSelection, combine
 * modes) with zero further changes.
 */
export function pathToSelection(path: Pick<PathLayerData, 'anchors' | 'closed'>): Selection {
  const points = flattenPathToPolygon(path);
  if (points.length < 3) return NO_SELECTION;
  return { kind: 'polygon', points };
}
