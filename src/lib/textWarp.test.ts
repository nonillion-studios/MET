import { describe, it, expect } from 'vitest';
import {
  meshRestPoint, createIdentityMesh, meshFromStyle, bilinearMeshSample, warpCoords,
  DEFAULT_MESH_COLS, DEFAULT_MESH_ROWS,
} from './textWarp';

describe('meshRestPoint', () => {
  it('spaces a 4x4 grid evenly across -1..1', () => {
    expect(meshRestPoint(0, 4, 4)).toEqual({ x: -1, y: -1 }); // col 0, row 0
    expect(meshRestPoint(3, 4, 4)).toEqual({ x: 1, y: -1 }); // col 3, row 0
    expect(meshRestPoint(12, 4, 4)).toEqual({ x: -1, y: 1 }); // col 0, row 3
    expect(meshRestPoint(15, 4, 4)).toEqual({ x: 1, y: 1 }); // col 3, row 3
    const center = meshRestPoint(5, 4, 4); // col 1, row 1
    expect(center.x).toBeCloseTo(-1 / 3, 6);
    expect(center.y).toBeCloseTo(-1 / 3, 6);
  });
});

describe('createIdentityMesh', () => {
  it('every point sits at its own rest position', () => {
    const mesh = createIdentityMesh(4, 4);
    for (let i = 0; i < mesh.points.length; i++) {
      expect(mesh.points[i]).toEqual(meshRestPoint(i, 4, 4));
    }
  });

  it('renders as a true no-op everywhere, not just at grid vertices', () => {
    const mesh = createIdentityMesh();
    for (const [nx, ny] of [[0, 0], [0.37, -0.62], [-0.9, 0.15], [1, -1]] as const) {
      const { sx, sy } = bilinearMeshSample(mesh, nx, ny);
      expect(sx).toBeCloseTo(nx, 10);
      expect(sy).toBeCloseTo(ny, 10);
    }
  });
});

describe('meshFromStyle', () => {
  it('reproduces the formula-based warp exactly at every grid vertex', () => {
    for (const style of ['arc', 'bulge', 'twist', 'fisheye', 'wave'] as const) {
      const mesh = meshFromStyle(style, 60, 10, -15, 'horizontal', DEFAULT_MESH_COLS, DEFAULT_MESH_ROWS);
      for (let i = 0; i < mesh.points.length; i++) {
        const rest = meshRestPoint(i, DEFAULT_MESH_COLS, DEFAULT_MESH_ROWS);
        const viaMesh = bilinearMeshSample(mesh, rest.x, rest.y);
        const expected = expectedFormulaSample(style, 60, 10, -15, rest);
        expect(viaMesh.sx).toBeCloseTo(expected.sx, 6);
        expect(viaMesh.sy).toBeCloseTo(expected.sy, 6);
      }
    }
  });
});

describe('bilinearMeshSample drag direction', () => {
  it('dragging a vertex right samples from further left (content visually shifts right)', () => {
    const mesh = createIdentityMesh(4, 4);
    const idx = 5; // an interior vertex (col 1, row 1)
    const rest = meshRestPoint(idx, 4, 4);
    mesh.points[idx] = { x: rest.x + 0.4, y: rest.y }; // dragged right
    const { sx } = bilinearMeshSample(mesh, rest.x, rest.y);
    expect(sx).toBeLessThan(rest.x);
    expect(sx).toBeCloseTo(rest.x - 0.4, 6);
  });
});

/** Mirrors applyTextWarp's own non-mesh, horizontal-orientation sample-position computation
 *  (`sx = rawSx + hDistFactor*rawSy`, `sy = rawSy + vDistFactor*rawSx`), standalone, so the
 *  mesh-vs-formula equivalence test above can check meshFromStyle's initialization directly. */
function expectedFormulaSample(
  style: Parameters<typeof meshFromStyle>[0], bend: number, hDist: number, vDist: number,
  point: { x: number; y: number },
): { sx: number; sy: number } {
  const { sx: rawSx, sy: rawSy } = warpCoords(point.x, point.y, style, bend / 100);
  return { sx: rawSx + (hDist / 100) * rawSy, sy: rawSy + (vDist / 100) * rawSx };
}
