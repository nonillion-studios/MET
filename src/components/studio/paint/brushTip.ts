/**
 * Brush tip rasterization + cache.
 *
 * Every brush-family stamp is a `drawImage` of a pre-rendered tip canvas rather
 * than a fresh `createRadialGradient` + `arc` per stamp (which is what the old
 * inline `stamp()` did). A dense stroke lays down hundreds of stamps, so
 * rendering the tip once per (size, hardness, shape, angle, roundness) combo and
 * blitting it is both much faster and the only sane way to support non-round
 * shapes, angle/roundness, and — in Part C — imported image tips, which are all
 * just "some pixels" once they're in a tip canvas.
 *
 * Tips are rendered in their final colour. Tinting a shared white tip at stamp
 * time was the obvious alternative, but a `source-in` tint can only be applied
 * to a whole canvas — applied to the dirty sub-rect it would wipe the rest of
 * the accumulated stroke buffer — and tinting the full page-sized buffer on
 * every pointermove is far too slow. Colour is just part of the cache key.
 */

export type BrushShape = 'round' | 'square';

export interface BrushTipSpec {
  size: number;
  /** 0-1. 1 = hard edge, 0 = fully feathered. */
  hardness: number;
  shape: BrushShape;
  /** Degrees; rotates the tip. Only meaningful when roundness < 1 or shape is square. */
  angle: number;
  /** 0.05-1. 1 = circular; lower squashes the tip along its minor axis (calligraphic). */
  roundness: number;
  /** CSS colour for the tip. Eraser tips can pass anything — only their alpha is used. */
  color: string;
}

const MAX_CACHE = 24;
const cache = new Map<string, HTMLCanvasElement>();

/** Accepts the `#rrggbb` the colour picker produces; falls back to black. */
function parseColor(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function keyOf(spec: BrushTipSpec): string {
  // Quantize size so a pressure-driven stroke doesn't mint a tip per sub-pixel step.
  const size = Math.max(1, Math.round(spec.size));
  const hardness = Math.round(spec.hardness * 20) / 20;
  const angle = Math.round(spec.angle);
  const roundness = Math.round(spec.roundness * 20) / 20;
  return `${size}|${hardness}|${spec.shape}|${angle}|${roundness}|${spec.color}`;
}

/**
 * Returns a tip canvas for `spec`, sized to fit the rotated tip.
 * Cached; callers must not mutate the returned canvas.
 */
export function getBrushTip(spec: BrushTipSpec): HTMLCanvasElement {
  const key = keyOf(spec);
  const hit = cache.get(key);
  if (hit) return hit;

  const size = Math.max(1, Math.round(spec.size));
  const roundness = Math.max(0.05, Math.min(1, spec.roundness));
  // Rotating a squashed tip needs a canvas big enough for the rotated bounds.
  const dim = Math.max(2, Math.ceil(size * 1.45) + 2);
  const canvas = document.createElement('canvas');
  canvas.width = dim;
  canvas.height = dim;
  const ctx = canvas.getContext('2d')!;

  const cx = dim / 2;
  const cy = dim / 2;
  const r = size / 2;

  ctx.translate(cx, cy);
  ctx.rotate((spec.angle * Math.PI) / 180);
  ctx.scale(1, roundness);

  const hardness = Math.max(0, Math.min(1, spec.hardness));

  const [cr, cg, cb] = parseColor(spec.color);
  const rgb = `${cr},${cg},${cb}`;

  if (spec.shape === 'square') {
    if (hardness >= 0.99) {
      ctx.fillStyle = `rgb(${rgb})`;
      ctx.fillRect(-r, -r, size, size);
    } else {
      // Feathered square: concentric rects from the inside out, alpha ramping to 0
      // at the edge. `ctx.filter = blur()` would be cleaner but is far too slow to
      // run per tip on low-end devices, and the tip is cached anyway.
      const steps = Math.max(2, Math.round(r * (1 - hardness)));
      const inner = r * hardness;
      ctx.fillStyle = `rgb(${rgb})`;
      ctx.fillRect(-inner, -inner, inner * 2, inner * 2);
      for (let i = 0; i < steps; i++) {
        const t = i / steps;
        const edge = inner + (r - inner) * t;
        ctx.globalAlpha = 1 - t;
        ctx.strokeStyle = `rgb(${rgb})`;
        ctx.lineWidth = Math.max(1, (r - inner) / steps + 0.5);
        ctx.strokeRect(-edge, -edge, edge * 2, edge * 2);
      }
      ctx.globalAlpha = 1;
    }
  } else {
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    grad.addColorStop(0, `rgba(${rgb},1)`);
    // Hardness is where the falloff starts; clamped off 0/1 so the gradient stays valid.
    grad.addColorStop(Math.max(0.01, Math.min(0.99, hardness)), `rgba(${rgb},1)`);
    grad.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
  }

  if (cache.size >= MAX_CACHE) {
    // Cheap FIFO eviction — tips are small and specs churn slowly in practice.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, canvas);
  return canvas;
}

/** Drops every cached tip. Only needed if tips ever become content-dependent (imported image brushes). */
export function clearBrushTipCache(): void {
  cache.clear();
}
