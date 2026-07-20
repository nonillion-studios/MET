import type { Point } from './paint/selection';
import type { PathAnchor, PathLayerData } from './studioTypes';

function addOffset(p: Point, offset: Point): Point {
  return { x: p.x + offset.x, y: p.y + offset.y };
}

const ZERO: Point = { x: 0, y: 0 };

/**
 * Traces a real vector path (per-anchor cubic bezier, not the polyline-smoothing approximation
 * `paintEngine.ts`'s `tracePenPath` uses) into any context that implements `moveTo`/`bezierCurveTo`
 * — both `CanvasRenderingContext2D` and Konva's `Context` do, so this one function serves the live
 * pen preview, `PathLayerNode`'s committed render, and export/bake without a second implementation
 * that could drift from the first. Caller owns `beginPath`/fill/stroke/`closePath` around this.
 */
export function traceAnchors(
  ctx: Pick<CanvasRenderingContext2D, 'moveTo' | 'bezierCurveTo' | 'closePath'>,
  anchors: PathAnchor[],
  closed: boolean,
): void {
  if (anchors.length === 0) return;
  ctx.moveTo(anchors[0].point.x, anchors[0].point.y);
  if (anchors.length === 1) return;

  for (let i = 1; i < anchors.length; i++) {
    const prev = anchors[i - 1];
    const cur = anchors[i];
    const c1 = addOffset(prev.point, prev.handleOut ?? ZERO);
    const c2 = addOffset(cur.point, cur.handleIn ?? ZERO);
    ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, cur.point.x, cur.point.y);
  }

  if (closed && anchors.length > 2) {
    const prev = anchors[anchors.length - 1];
    const first = anchors[0];
    const c1 = addOffset(prev.point, prev.handleOut ?? ZERO);
    const c2 = addOffset(first.point, first.handleIn ?? ZERO);
    ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, first.point.x, first.point.y);
    ctx.closePath();
  }
}

/**
 * Curvature Pen: unlike plain Pen, a click alone (no drag) still produces a smooth curve — the
 * whole path adjusts to stay smooth as each new anchor is placed. Since a smooth anchor's handles
 * depend on both neighbors, the anchor just placed can't get its final handles yet (no next
 * neighbor exists), so this retroactively recomputes the *previous* anchor's handles from its own
 * two now-known neighbors — a standard Catmull-Rom-to-bezier tangent (1/6 of the vector between
 * the neighbors either side, a common smoothing coefficient for this conversion) — each time a new
 * anchor is appended. Call with the full draft array right after pushing the new anchor.
 */
export function applyCurvatureSmoothing(anchors: PathAnchor[]): PathAnchor[] {
  const n = anchors.length;
  if (n === 0) return anchors;
  const next = anchors.slice();
  next[n - 1] = { ...next[n - 1], type: 'smooth' };
  if (n >= 3) {
    const i = n - 2;
    const prev = next[i - 1];
    const cur = next[i];
    const last = next[n - 1];
    const factor = 1 / 6;
    const tangent = { x: (last.point.x - prev.point.x) * factor, y: (last.point.y - prev.point.y) * factor };
    next[i] = { ...cur, type: 'smooth', handleOut: tangent, handleIn: { x: -tangent.x, y: -tangent.y } };
  }
  return next;
}

/**
 * Direct Selection's Alt-click-an-anchor gesture: toggles between corner and smooth. Matches
 * Photoshop's actual behavior, not the more elaborate "Alt-drag a handle" gesture — smooth->corner
 * retracts both handles to zero (a clean, unambiguous sharp corner), corner->smooth synthesizes
 * symmetric handles from the anchor's neighbors using the same tangent `applyCurvatureSmoothing`
 * computes, so a freshly-converted anchor immediately reads as smooth rather than needing a
 * follow-up drag to look right.
 */
export function toggleAnchorType(anchors: PathAnchor[], index: number): PathAnchor[] {
  const a = anchors[index];
  if (!a) return anchors;
  const next = anchors.slice();
  if (a.type === 'smooth') {
    next[index] = { ...a, type: 'corner', handleIn: undefined, handleOut: undefined };
    return next;
  }
  const prev = anchors[index - 1];
  const after = anchors[index + 1];
  if (prev && after) {
    const factor = 1 / 6;
    const tangent = { x: (after.point.x - prev.point.x) * factor, y: (after.point.y - prev.point.y) * factor };
    next[index] = { ...a, type: 'smooth', handleOut: tangent, handleIn: { x: -tangent.x, y: -tangent.y } };
  } else {
    next[index] = { ...a, type: 'smooth' };
  }
  return next;
}

function cubicPoint(p0: Point, c1: Point, c2: Point, p1: Point, t: number): Point {
  const mt = 1 - t;
  return {
    x: mt * mt * mt * p0.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * p1.x,
    y: mt * mt * mt * p0.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * p1.y,
  };
}

/**
 * Subdivides every cubic bezier segment of a path into straight-line pieces, for consumers that
 * need a plain point list (selection's `polygon` kind, which has no bezier concept of its own).
 * 16 segments per curve is fine enough that flattening error is sub-pixel at typical zoom levels,
 * coarse enough to keep the resulting polygon small.
 */
export function flattenPathToPolygon(path: Pick<PathLayerData, 'anchors' | 'closed'>, segments = 16): Point[] {
  const { anchors, closed } = path;
  if (anchors.length < 2) return anchors.map(a => a.point);

  const pts: Point[] = [];
  const segmentCount = closed ? anchors.length : anchors.length - 1;
  for (let i = 0; i < segmentCount; i++) {
    const a = anchors[i];
    const b = anchors[(i + 1) % anchors.length];
    const c1 = addOffset(a.point, a.handleOut ?? ZERO);
    const c2 = addOffset(b.point, b.handleIn ?? ZERO);
    for (let s = 0; s < segments; s++) pts.push(cubicPoint(a.point, c1, c2, b.point, s / segments));
  }
  if (!closed) pts.push(anchors[anchors.length - 1].point);
  return pts;
}
