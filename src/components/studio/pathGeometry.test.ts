import { describe, it, expect } from 'vitest';
import { traceAnchors, flattenPathToPolygon, applyCurvatureSmoothing, toggleAnchorType } from './pathGeometry';
import type { PathAnchor } from './studioTypes';

const anchor = (id: string, x: number, y: number, extra: Partial<PathAnchor> = {}): PathAnchor =>
  ({ id, point: { x, y }, type: 'corner', ...extra });

/** Records every ctx call so tests can assert the exact trace without a real canvas. */
function recordingCtx() {
  const calls: string[] = [];
  return {
    calls,
    moveTo: (x: number, y: number) => calls.push(`M ${x},${y}`),
    bezierCurveTo: (c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) =>
      calls.push(`C ${c1x},${c1y} ${c2x},${c2y} ${x},${y}`),
    closePath: () => calls.push('Z'),
  };
}

describe('traceAnchors', () => {
  it('does nothing for an empty anchor list', () => {
    const ctx = recordingCtx();
    traceAnchors(ctx, [], false);
    expect(ctx.calls).toEqual([]);
  });

  it('moves to a single anchor and draws nothing else', () => {
    const ctx = recordingCtx();
    traceAnchors(ctx, [anchor('a', 10, 20)], false);
    expect(ctx.calls).toEqual(['M 10,20']);
  });

  it('draws straight-looking bezier segments through corner anchors with no handles', () => {
    const ctx = recordingCtx();
    traceAnchors(ctx, [anchor('a', 0, 0), anchor('b', 10, 0)], false);
    // No handles -> both control points collapse onto the anchors themselves, a degenerate
    // (straight) cubic bezier — still real bezierCurveTo calls, just with zero curvature.
    expect(ctx.calls).toEqual(['M 0,0', 'C 0,0 10,0 10,0']);
  });

  it('uses handleOut/handleIn as offsets from their own anchor for the control points', () => {
    const ctx = recordingCtx();
    const a = anchor('a', 0, 0, { type: 'smooth', handleOut: { x: 5, y: 5 } });
    const b = anchor('b', 10, 0, { type: 'smooth', handleIn: { x: -5, y: 5 } });
    traceAnchors(ctx, [a, b], false);
    expect(ctx.calls).toEqual(['M 0,0', 'C 5,5 5,5 10,0']);
  });

  it('closes back to the first anchor and calls closePath when closed with 3+ anchors', () => {
    const ctx = recordingCtx();
    traceAnchors(ctx, [anchor('a', 0, 0), anchor('b', 10, 0), anchor('c', 10, 10)], true);
    expect(ctx.calls).toEqual([
      'M 0,0',
      'C 0,0 10,0 10,0',
      'C 10,0 10,10 10,10',
      'C 10,10 0,0 0,0',
      'Z',
    ]);
  });

  it('does not close a 2-anchor "path" even if closed is requested (degenerate)', () => {
    const ctx = recordingCtx();
    traceAnchors(ctx, [anchor('a', 0, 0), anchor('b', 10, 0)], true);
    expect(ctx.calls).toEqual(['M 0,0', 'C 0,0 10,0 10,0']);
  });
});

describe('flattenPathToPolygon', () => {
  it('subdivides a straight open path into points landing on the line', () => {
    const pts = flattenPathToPolygon({ anchors: [anchor('a', 0, 0), anchor('b', 100, 0)], closed: false }, 4);
    // 4 segments across the one bezier span, plus the trailing exact endpoint for an open path.
    expect(pts.length).toBe(5);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 100, y: 0 });
    for (const p of pts) expect(p.y).toBeCloseTo(0);
  });

  it('wraps around for a closed path without an explicit trailing point', () => {
    const pts = flattenPathToPolygon({
      anchors: [anchor('a', 0, 0), anchor('b', 10, 0), anchor('c', 10, 10)],
      closed: true,
    }, 2);
    // 3 segments (a->b, b->c, c->a) * 2 subdivisions each = 6 points, no extra trailing point.
    expect(pts.length).toBe(6);
  });

  it('returns the raw anchor points for a degenerate path with fewer than 2 anchors', () => {
    expect(flattenPathToPolygon({ anchors: [], closed: false })).toEqual([]);
    expect(flattenPathToPolygon({ anchors: [anchor('a', 1, 2)], closed: false })).toEqual([{ x: 1, y: 2 }]);
  });
});

describe('applyCurvatureSmoothing', () => {
  it('marks the newest anchor smooth but leaves it handle-less (no next neighbor yet)', () => {
    const result = applyCurvatureSmoothing([anchor('a', 0, 0), anchor('b', 10, 0)]);
    expect(result[1].type).toBe('smooth');
    expect(result[1].handleIn).toBeUndefined();
    expect(result[1].handleOut).toBeUndefined();
  });

  it('retroactively gives the second-to-last anchor symmetric handles once a 3rd anchor is placed', () => {
    const result = applyCurvatureSmoothing([anchor('a', 0, 0), anchor('b', 10, 0), anchor('c', 10, 10)]);
    const mid = result[1];
    expect(mid.type).toBe('smooth');
    // tangent = (c - a) / 6 = (10,10)/6
    expect(mid.handleOut?.x).toBeCloseTo(10 / 6);
    expect(mid.handleOut?.y).toBeCloseTo(10 / 6);
    expect(mid.handleIn?.x).toBeCloseTo(-10 / 6);
    expect(mid.handleIn?.y).toBeCloseTo(-10 / 6);
  });

  it('does not touch anchors before the retroactively-updated one', () => {
    const result = applyCurvatureSmoothing([anchor('a', 0, 0), anchor('b', 10, 0), anchor('c', 10, 10)]);
    expect(result[0]).toEqual(anchor('a', 0, 0));
  });
});

describe('toggleAnchorType', () => {
  it('retracts a smooth anchor to a handle-less corner', () => {
    const anchors = [
      anchor('a', 0, 0),
      anchor('b', 10, 0, { type: 'smooth', handleIn: { x: -2, y: 0 }, handleOut: { x: 2, y: 0 } }),
      anchor('c', 20, 0),
    ];
    const result = toggleAnchorType(anchors, 1);
    expect(result[1]).toEqual({ id: 'b', point: { x: 10, y: 0 }, type: 'corner', handleIn: undefined, handleOut: undefined });
  });

  it('converts a corner anchor to smooth with symmetric handles derived from its neighbors', () => {
    const anchors = [anchor('a', 0, 0), anchor('b', 10, 0), anchor('c', 10, 10)];
    const result = toggleAnchorType(anchors, 1);
    expect(result[1].type).toBe('smooth');
    // Same tangent formula as applyCurvatureSmoothing: (c - a) / 6.
    expect(result[1].handleOut?.x).toBeCloseTo(10 / 6);
    expect(result[1].handleOut?.y).toBeCloseTo(10 / 6);
    expect(result[1].handleIn?.x).toBeCloseTo(-10 / 6);
    expect(result[1].handleIn?.y).toBeCloseTo(-10 / 6);
  });

  it('converts an edge anchor (no both-side neighbors) to smooth with no handles rather than crashing', () => {
    const anchors = [anchor('a', 0, 0), anchor('b', 10, 0)];
    const result = toggleAnchorType(anchors, 0);
    expect(result[0].type).toBe('smooth');
    expect(result[0].handleOut).toBeUndefined();
  });

  it('is a no-op for an out-of-range index', () => {
    const anchors = [anchor('a', 0, 0)];
    expect(toggleAnchorType(anchors, 5)).toBe(anchors);
  });
});
