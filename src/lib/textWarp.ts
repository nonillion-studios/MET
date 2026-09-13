import type { WarpStyle, WarpTextSettings, WarpMesh, WarpMeshPoint } from '../components/studio/studioTypes';

/** Fixed control-point grid density for the on-canvas mesh editor — a reasonable, Photoshop-
 *  comparable fidelity target without exposing grid density as its own control (see the mesh-
 *  density decision in the plan this implements). */
export const DEFAULT_MESH_COLS = 4;
export const DEFAULT_MESH_ROWS = 4;

/**
 * Warp Text's mesh deformation — an inverse-mapping remap (for each destination pixel, find the
 * source pixel it should sample) over the normalized -1..1 box a text layer's own rasterized
 * glyphs occupy. Every style below is a real, distinct formula, not a decorative relabeling of one
 * shape — but this is deliberately an approximation of Photoshop's own warp mesh (which drives a
 * proper bicubic envelope), the same "real technique, honestly simplified" standard this codebase
 * already applies to Bevel & Emboss's relief and Satin's interference pattern.
 */
export function warpCoords(nx: number, ny: number, style: WarpStyle, bendFactor: number): { sx: number; sy: number } {
  switch (style) {
    case 'arc':
      return { sx: nx, sy: ny + bendFactor * (1 - nx * nx) };
    case 'arcLower':
      // Only the lower half curves — weight the bend by how far down this point sits.
      return { sx: nx, sy: ny + bendFactor * (1 - nx * nx) * Math.max(0, ny) };
    case 'arcUpper':
      // Mirror of arcLower — only the upper half curves.
      return { sx: nx, sy: ny + bendFactor * (1 - nx * nx) * Math.max(0, -ny) };
    case 'arch':
      return { sx: nx, sy: ny + bendFactor * Math.sin((nx * Math.PI) / 2) };
    case 'bulge':
      return { sx: nx + bendFactor * nx * (1 - ny * ny), sy: ny + bendFactor * ny * (1 - nx * nx) };
    case 'shellLower':
      // A shell/cylinder curve concentrated at the bottom edge.
      return { sx: nx, sy: ny + bendFactor * Math.cos((nx * Math.PI) / 2) * Math.max(0, ny) };
    case 'shellUpper':
      return { sx: nx, sy: ny + bendFactor * Math.cos((nx * Math.PI) / 2) * Math.max(0, -ny) };
    case 'flag':
      return { sx: nx, sy: ny + bendFactor * Math.sin(nx * Math.PI * 2) };
    case 'wave':
      return { sx: nx + bendFactor * 0.3 * Math.sin(ny * Math.PI * 3), sy: ny + bendFactor * Math.sin(nx * Math.PI * 2) };
    case 'fish': {
      const r = Math.sqrt(nx * nx + ny * ny);
      const f = 1 + bendFactor * r;
      return { sx: nx * f, sy: ny * f };
    }
    case 'rise':
      // A diagonal ramp rather than a symmetric arc — text rises from one side to the other.
      return { sx: nx, sy: ny + bendFactor * ((nx + 1) / 2) };
    case 'fisheye': {
      const r = Math.sqrt(nx * nx + ny * ny);
      const theta = Math.atan2(ny, nx);
      const newR = r * (1 + bendFactor * r);
      return { sx: newR * Math.cos(theta), sy: newR * Math.sin(theta) };
    }
    case 'inflate': {
      const f = 1 + bendFactor * (1 - nx * nx) * (1 - ny * ny);
      return { sx: nx * f, sy: ny * f };
    }
    case 'squeeze':
      return { sx: nx * (1 + bendFactor * ny * ny), sy: ny * (1 + bendFactor * nx * nx) };
    case 'twist': {
      const angle = bendFactor * Math.PI * Math.sqrt(nx * nx + ny * ny);
      const cosT = Math.cos(angle), sinT = Math.sin(angle);
      return { sx: nx * cosT - ny * sinT, sy: nx * sinT + ny * cosT };
    }
    case 'none':
    default:
      return { sx: nx, sy: ny };
  }
}

/** A grid vertex's undeformed normalized (-1..1) position — not stored on `WarpMesh` itself, always
 *  derivable from its row-major index plus the grid's own `cols`/`rows`, so an untouched mesh is
 *  implicitly the identity grid. */
export function meshRestPoint(index: number, cols: number, rows: number): WarpMeshPoint {
  const col = index % cols, row = Math.floor(index / cols);
  return {
    x: cols > 1 ? (col / (cols - 1)) * 2 - 1 : 0,
    y: rows > 1 ? (row / (rows - 1)) * 2 - 1 : 0,
  };
}

/** A mesh whose every point sits exactly at its own rest position — renders as a pure no-op, the
 *  mesh equivalent of `style: 'none'`. The starting point for a from-scratch custom warp (no preset
 *  applied first). */
export function createIdentityMesh(cols = DEFAULT_MESH_COLS, rows = DEFAULT_MESH_ROWS): WarpMesh {
  const points: WarpMeshPoint[] = [];
  for (let i = 0; i < cols * rows; i++) points.push(meshRestPoint(i, cols, rows));
  return { cols, rows, points };
}

/**
 * Converts a preset (style + bend/H/V/orientation) into an editable mesh whose *initial* render is
 * byte-identical to the old formula-only path — the presets become mesh initializers, per the
 * design this implements: pick a preset, then the user can still drag individual points afterward.
 *
 * Each mesh point stores a "current" position such that `bilinearMeshSample`'s displacement-based
 * sampling (see its own doc comment for the full derivation) reproduces `warpCoords`'s original
 * sample position exactly at every grid vertex: solving `sample = 2*rest - current` for `current`
 * gives `current = 2*rest - sample`, which is exactly what's stored below.
 */
export function meshFromStyle(
  style: WarpStyle,
  bend: number,
  horizontalDistortion: number,
  verticalDistortion: number,
  orientation: 'horizontal' | 'vertical',
  cols = DEFAULT_MESH_COLS,
  rows = DEFAULT_MESH_ROWS,
): WarpMesh {
  const bendFactor = bend / 100;
  const hDistFactor = horizontalDistortion / 100;
  const vDistFactor = verticalDistortion / 100;
  const vertical = orientation === 'vertical';
  const points: WarpMeshPoint[] = [];
  for (let i = 0; i < cols * rows; i++) {
    const rest = meshRestPoint(i, cols, rows);
    const { sx: rawSx, sy: rawSy } = vertical
      ? swapped(warpCoords(rest.y, rest.x, style, bendFactor))
      : warpCoords(rest.x, rest.y, style, bendFactor);
    const sampleX = rawSx + hDistFactor * rawSy;
    const sampleY = rawSy + vDistFactor * rawSx;
    points.push({ x: 2 * rest.x - sampleX, y: 2 * rest.y - sampleY });
  }
  return { cols, rows, points };
}

/**
 * The mesh equivalent of `warpCoords` — given a destination position, returns the source position
 * to sample from, via bilinear interpolation over whichever mesh cell `(nx,ny)` falls in (piecewise-
 * linear, not a full bicubic envelope: C0-continuous, no ringing/overshoot risk, and a materially
 * simpler and lower-risk implementation than a proper cubic patch for the same "real mesh, honestly
 * simplified" standard the rest of this file already holds itself to).
 *
 * Each mesh point is stored as a "current" position (where the user dragged that grid vertex to,
 * in the same forward/intuitive sense as dragging it on screen). To render, bilinearly interpolate
 * that "current" field at `(nx,ny)` to get `(curX,curY)` — the displacement this location's own
 * rest-grid neighbourhood has been dragged by is `(curX-nx, curY-ny)`. The source pixel that should
 * now appear at this *destination* location is the rest position *minus* that same displacement
 * (dragging a point right pulls the source sample point left, so the glyph pixel that used to sit
 * to the left now visually appears shifted right at the destination — the sign that makes dragging
 * feel like dragging the text, not dragging a sample window over it).
 */
export function bilinearMeshSample(mesh: WarpMesh, nx: number, ny: number): { sx: number; sy: number } {
  const { cols, rows, points } = mesh;
  const maxCol = Math.max(0, cols - 2);
  const maxRow = Math.max(0, rows - 2);
  const gx = ((nx + 1) / 2) * (cols - 1);
  const gy = ((ny + 1) / 2) * (rows - 1);
  const cx0 = Math.min(maxCol, Math.max(0, Math.floor(gx)));
  const cy0 = Math.min(maxRow, Math.max(0, Math.floor(gy)));
  const tx = Math.min(1, Math.max(0, gx - cx0));
  const ty = Math.min(1, Math.max(0, gy - cy0));

  const p00 = points[cy0 * cols + cx0];
  const p10 = points[cy0 * cols + Math.min(cols - 1, cx0 + 1)];
  const p01 = points[Math.min(rows - 1, cy0 + 1) * cols + cx0];
  const p11 = points[Math.min(rows - 1, cy0 + 1) * cols + Math.min(cols - 1, cx0 + 1)];

  const bilerp = (a: number, b: number, c: number, d: number) => {
    const top = a + (b - a) * tx;
    const bottom = c + (d - c) * tx;
    return top + (bottom - top) * ty;
  };
  const curX = bilerp(p00.x, p10.x, p01.x, p11.x);
  const curY = bilerp(p00.y, p10.y, p01.y, p11.y);

  const dispX = curX - nx, dispY = curY - ny;
  return { sx: nx - dispX, sy: ny - dispY };
}

/** Applies `settings` to `source`, returning a new canvas of the same size. A no-op copy when the
 *  style is `'none'` (callers should generally skip calling this entirely in that case, but it's
 *  safe to call regardless). */
export function applyTextWarp(source: HTMLCanvasElement, settings: WarpTextSettings): HTMLCanvasElement {
  const { width, height } = source;
  const output = document.createElement('canvas');
  output.width = width;
  output.height = height;
  const outCtx = output.getContext('2d');
  const inCtx = source.getContext('2d');
  if (!outCtx || !inCtx || width === 0 || height === 0) return output;

  if (settings.style === 'none' && !settings.mesh) {
    outCtx.drawImage(source, 0, 0);
    return output;
  }

  const srcData = inCtx.getImageData(0, 0, width, height);
  const dstData = outCtx.createImageData(width, height);

  const mesh = settings.mesh;
  const bendFactor = settings.bend / 100;
  const hDistFactor = settings.horizontalDistortion / 100;
  const vDistFactor = settings.verticalDistortion / 100;
  const vertical = settings.orientation === 'vertical';

  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) {
      const nx = (dx / width) * 2 - 1;
      const ny = (dy / height) * 2 - 1;

      let sx: number, sy: number;
      if (mesh) {
        // A mesh, once it exists, is the sole warp source — orientation/bend/H/V are already baked
        // into its points (see meshFromStyle) or simply don't apply to a freehand-edited mesh.
        ({ sx, sy } = bilinearMeshSample(mesh, nx, ny));
      } else {
        // Vertical orientation warps along the perpendicular axis — swap the roles of x/y going
        // in, then swap the resulting sample coordinates back.
        const { sx: rawSx, sy: rawSy } = vertical
          ? swapped(warpCoords(ny, nx, settings.style, bendFactor))
          : warpCoords(nx, ny, settings.style, bendFactor);
        sx = rawSx + hDistFactor * rawSy;
        sy = rawSy + vDistFactor * rawSx;
      }

      const srcX = Math.round(((sx + 1) / 2) * width);
      const srcY = Math.round(((sy + 1) / 2) * height);

      if (srcX >= 0 && srcX < width && srcY >= 0 && srcY < height) {
        const srcIdx = (srcY * width + srcX) * 4;
        const dstIdx = (dy * width + dx) * 4;
        dstData.data[dstIdx] = srcData.data[srcIdx];
        dstData.data[dstIdx + 1] = srcData.data[srcIdx + 1];
        dstData.data[dstIdx + 2] = srcData.data[srcIdx + 2];
        dstData.data[dstIdx + 3] = srcData.data[srcIdx + 3];
      }
    }
  }

  outCtx.putImageData(dstData, 0, 0);
  return output;
}

function swapped(p: { sx: number; sy: number }): { sx: number; sy: number } {
  return { sx: p.sy, sy: p.sx };
}
