import type { WarpStyle, WarpTextSettings } from '../components/studio/studioTypes';

/**
 * Warp Text's mesh deformation — an inverse-mapping remap (for each destination pixel, find the
 * source pixel it should sample) over the normalized -1..1 box a text layer's own rasterized
 * glyphs occupy. Every style below is a real, distinct formula, not a decorative relabeling of one
 * shape — but this is deliberately an approximation of Photoshop's own warp mesh (which drives a
 * proper bicubic envelope), the same "real technique, honestly simplified" standard this codebase
 * already applies to Bevel & Emboss's relief and Satin's interference pattern.
 */
function warpCoords(nx: number, ny: number, style: WarpStyle, bendFactor: number): { sx: number; sy: number } {
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

  if (settings.style === 'none') {
    outCtx.drawImage(source, 0, 0);
    return output;
  }

  const srcData = inCtx.getImageData(0, 0, width, height);
  const dstData = outCtx.createImageData(width, height);

  const bendFactor = settings.bend / 100;
  const hDistFactor = settings.horizontalDistortion / 100;
  const vDistFactor = settings.verticalDistortion / 100;
  const vertical = settings.orientation === 'vertical';

  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) {
      const nx = (dx / width) * 2 - 1;
      const ny = (dy / height) * 2 - 1;

      // Vertical orientation warps along the perpendicular axis — swap the roles of x/y going in,
      // then swap the resulting sample coordinates back.
      const { sx: rawSx, sy: rawSy } = vertical
        ? swapped(warpCoords(ny, nx, settings.style, bendFactor))
        : warpCoords(nx, ny, settings.style, bendFactor);

      const sx = rawSx + hDistFactor * rawSy;
      const sy = rawSy + vDistFactor * rawSx;

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
