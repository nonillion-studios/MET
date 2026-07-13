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

function pathForSelection(sel: Selection): Path2D | null {
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

/**
 * After a masked stroke commits, re-applies the bitmap mask's exact alpha to
 * the bounding-box region that was just painted (undoes the bbox-only
 * approximation used for live feedback during the stroke).
 */
export function refineMaskedRegion(ctx: CanvasRenderingContext2D, sel: Selection, before: ImageData): void {
  if (sel.kind !== 'mask') return;
  const { x, y, width, height } = sel.bounds;
  if (width <= 0 || height <= 0) return;
  const after = ctx.getImageData(x, y, width, height);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const maskIdx = (y + row) * sel.width + (x + col);
      const inSelection = sel.data[maskIdx] > 127;
      if (!inSelection) {
        const i = (row * width + col) * 4;
        after.data[i] = before.data[i];
        after.data[i + 1] = before.data[i + 1];
        after.data[i + 2] = before.data[i + 2];
        after.data[i + 3] = before.data[i + 3];
      }
    }
  }
  ctx.putImageData(after, x, y);
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
