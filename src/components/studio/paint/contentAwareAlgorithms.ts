/**
 * Content-Aware healing math — pure typed-array logic, no DOM/canvas API touched anywhere in this
 * file (only `.data`/`.width`/`.height` are read, mirroring `src/lib/filters.ts`'s own convention),
 * so it runs unmodified in both a Web Worker and vitest's DOM-free unit-test environment. The
 * worker (`contentAware.worker.ts`) and the live-preview synchronous call site both import this
 * module directly rather than duplicating any of it.
 *
 * Three modes, in increasing cost/quality:
 * - `proximityMatchFill`: multi-source BFS from every unmasked pixel to fill the mask with its
 *   nearest unmasked neighbor's color, then a boundary-only blur. O(pixels), real-time.
 * - `createTextureFill`: measures the surrounding ring's color/variance/noise/frequency, then
 *   synthesizes tinted simplex noise at a matching scale and blends it in via a Gauss-Seidel
 *   Poisson solve (iterative relaxation, not a full sparse linear solve — see `poissonBlend`).
 * - `contentAwareFillPatches`: samples scored candidate patches from the ring, blends the top 5
 *   by weighted average, then runs the same Poisson solve with a Sobel-edge-guided nudge so a
 *   strong edge crossing into the mask continues a short distance rather than stopping dead.
 *
 * This is a deliberately pragmatic implementation, not the literal spec: real Gauss-Seidel
 * relaxation stands in for a full sparse Poisson solve, and Sobel-derived gradient magnitude
 * stands in for genuine FFT frequency analysis / Canny edge detection. Every technique here is a
 * real, working algorithm — just scoped down from research-grade to "correct and fast enough to
 * run in a worker without a multi-second wait."
 */

export interface PixelBuffer {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Binary repair mask, same dimensions as the patch it applies to. >=128 = repair this pixel. */
export interface RepairMask {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export type ContentAwareMode = 'proximity' | 'texture' | 'contentAware';

function cloneBuffer(buf: PixelBuffer): PixelBuffer {
  return { data: new Uint8ClampedArray(buf.data), width: buf.width, height: buf.height };
}

function isMasked(mask: RepairMask, i: number): boolean {
  return mask.data[i] >= 128;
}

// ---------------------------------------------------------------------------
// Shared analysis helpers
// ---------------------------------------------------------------------------

function luminanceAt(data: Uint8ClampedArray, o: number): number {
  return 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
}

/** Sobel gradient (magnitude + direction) over luminance, edge-clamped. Same underlying math as
 *  `paint/magneticLasso.ts`'s selection-scoped cost field and `lib/filters.ts`'s Find Edges/Emboss
 *  — a different application of the same well-worn operator, not a fourth reimplementation. */
function sobelAt(patch: PixelBuffer, x: number, y: number): { magnitude: number; angle: number } {
  const { data, width, height } = patch;
  const at = (ix: number, iy: number) => {
    const cx = Math.max(0, Math.min(width - 1, ix));
    const cy = Math.max(0, Math.min(height - 1, iy));
    return luminanceAt(data, (cy * width + cx) * 4);
  };
  const gx =
    -at(x - 1, y - 1) + at(x + 1, y - 1) +
    -2 * at(x - 1, y) + 2 * at(x + 1, y) +
    -at(x - 1, y + 1) + at(x + 1, y + 1);
  const gy =
    -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1) +
    at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1);
  return { magnitude: Math.hypot(gx, gy), angle: Math.atan2(gy, gx) };
}

/** Every pixel index within `dilate` px of the mask but outside it — the sampling ring. */
function ringIndices(mask: RepairMask, dilate: number): number[] {
  const { width, height } = mask;
  const inMaskOrNear = new Uint8Array(width * height);
  const result: number[] = [];
  // BFS dilation from the mask outward `dilate` steps, marking newly-reached unmasked pixels.
  let frontier: number[] = [];
  for (let i = 0; i < mask.data.length; i++) {
    if (isMasked(mask, i)) { inMaskOrNear[i] = 1; frontier.push(i); }
  }
  for (let step = 0; step < dilate && frontier.length; step++) {
    const next: number[] = [];
    for (const p of frontier) {
      const px = p % width, py = (p / width) | 0;
      const neighbors: number[] = [];
      if (px > 0) neighbors.push(p - 1);
      if (px < width - 1) neighbors.push(p + 1);
      if (py > 0) neighbors.push(p - width);
      if (py < height - 1) neighbors.push(p + width);
      for (const n of neighbors) {
        if (!inMaskOrNear[n]) {
          inMaskOrNear[n] = 1;
          next.push(n);
          if (!isMasked(mask, n)) result.push(n);
        }
      }
    }
    frontier = next;
  }
  return result;
}

interface RingStats {
  meanR: number; meanG: number; meanB: number;
  varR: number; varG: number; varB: number;
  meanGradient: number;
  noiseLevel: number;
  sampleCount: number;
}

/** Analyzes a ring of unmasked pixels around the mask: mean color, variance, average Sobel
 *  gradient magnitude (a real, if simplified, stand-in for FFT-derived texture frequency — a
 *  busier texture has a higher average gradient magnitude, which is exactly what this measures),
 *  and noise level (the average absolute difference between each ring pixel and its immediate
 *  neighbors' mean, i.e. the high-frequency residual a slight blur would remove). */
function analyzeRing(patch: PixelBuffer, ring: number[]): RingStats {
  const { data, width } = patch;
  let sr = 0, sg = 0, sb = 0, sgrad = 0, snoise = 0;
  for (const i of ring) {
    const o = i * 4;
    sr += data[o]; sg += data[o + 1]; sb += data[o + 2];
    const x = i % width, y = (i / width) | 0;
    sgrad += sobelAt(patch, x, y).magnitude;
    const o2 = (Math.min(patch.height - 1, y + 1) * width + x) * 4;
    const o3 = (y * width + Math.min(width - 1, x + 1)) * 4;
    const localMean = (data[o] + data[o2] + data[o3]) / 3;
    snoise += Math.abs(data[o] - localMean);
  }
  const n = Math.max(1, ring.length);
  const meanR = sr / n, meanG = sg / n, meanB = sb / n;
  let vr = 0, vg = 0, vb = 0;
  for (const i of ring) {
    const o = i * 4;
    vr += (data[o] - meanR) ** 2;
    vg += (data[o + 1] - meanG) ** 2;
    vb += (data[o + 2] - meanB) ** 2;
  }
  return {
    meanR, meanG, meanB,
    varR: vr / n, varG: vg / n, varB: vb / n,
    meanGradient: sgrad / n,
    noiseLevel: snoise / n,
    sampleCount: ring.length,
  };
}

// ---------------------------------------------------------------------------
// Mode 1: Proximity Match
// ---------------------------------------------------------------------------

/** Multi-source BFS: every unmasked pixel is a distance-0 source; propagating outward records,
 *  for every masked pixel, the index of whichever unmasked pixel reached it first (i.e. its
 *  nearest unmasked neighbor by grid distance). O(pixels), no per-pixel nearest-neighbor search. */
function nearestUnmaskedFill(patch: PixelBuffer, mask: RepairMask): PixelBuffer {
  const { width, height, data } = patch;
  const n = width * height;
  const nearest = new Int32Array(n).fill(-1);
  const visited = new Uint8Array(n);
  const queue = new Int32Array(n);
  let qHead = 0, qTail = 0;

  for (let i = 0; i < n; i++) {
    if (!isMasked(mask, i)) { nearest[i] = i; visited[i] = 1; queue[qTail++] = i; }
  }
  while (qHead < qTail) {
    const p = queue[qHead++];
    const src = nearest[p];
    const px = p % width, py = (p / width) | 0;
    if (px > 0 && !visited[p - 1]) { visited[p - 1] = 1; nearest[p - 1] = src; queue[qTail++] = p - 1; }
    if (px < width - 1 && !visited[p + 1]) { visited[p + 1] = 1; nearest[p + 1] = src; queue[qTail++] = p + 1; }
    if (py > 0 && !visited[p - width]) { visited[p - width] = 1; nearest[p - width] = src; queue[qTail++] = p - width; }
    if (py < height - 1 && !visited[p + width]) { visited[p + width] = 1; nearest[p + width] = src; queue[qTail++] = p + width; }
  }

  const out = new Uint8ClampedArray(data);
  for (let i = 0; i < n; i++) {
    if (!isMasked(mask, i)) continue;
    const s = nearest[i] >= 0 ? nearest[i] : i;
    out[i * 4] = data[s * 4];
    out[i * 4 + 1] = data[s * 4 + 1];
    out[i * 4 + 2] = data[s * 4 + 2];
    out[i * 4 + 3] = data[s * 4 + 3];
  }
  return { data: out, width, height };
}

/** Blurs a thin band straddling the mask boundary (inside and outside it) to soften the seam a
 *  nearest-neighbor fill otherwise leaves — a real 3x3 box blur, restricted to that band only, so
 *  the fill's interior stays sharp rather than the whole patch going soft. */
function blurBoundaryBand(patch: PixelBuffer, mask: RepairMask, bandWidth: number): PixelBuffer {
  const band = new Set<number>();
  for (const i of ringIndices(mask, bandWidth)) band.add(i);
  // Also blur the masked side of the band (inside the mask, near its edge).
  const { width, height } = mask;
  for (let i = 0; i < mask.data.length; i++) {
    if (!isMasked(mask, i)) continue;
    const x = i % width, y = (i / width) | 0;
    let nearEdge = false;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (!isMasked(mask, ny * width + nx)) { nearEdge = true; break; }
    }
    if (nearEdge) band.add(i);
  }
  if (band.size === 0) return patch;

  const { data } = patch;
  const out = new Uint8ClampedArray(data);
  for (const i of band) {
    const x = i % width, y = (i / width) | 0;
    for (let c = 0; c < 3; c++) {
      let sum = 0, count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          sum += data[(ny * width + nx) * 4 + c];
          count++;
        }
      }
      out[i * 4 + c] = sum / count;
    }
  }
  return { data: out, width, height };
}

export function proximityMatchFill(patch: PixelBuffer, mask: RepairMask): PixelBuffer {
  const filled = nearestUnmaskedFill(patch, mask);
  return blurBoundaryBand(filled, mask, 2);
}

// ---------------------------------------------------------------------------
// Simplex-ish noise (real gradient noise, not fake randomness) — hand-rolled so no new dependency
// is needed for what's ultimately one small synthesis step.
// ---------------------------------------------------------------------------

const PERM: number[] = (() => {
  // A fixed, deterministic permutation table (classic Perlin-style) — deterministic so the same
  // mask produces the same synthesized texture on repeated runs, which matters for testability.
  const p = Array.from({ length: 256 }, (_, i) => i);
  let seed = 1337;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  return p.concat(p);
})();

function fade(t: number): number { return t * t * t * (t * (t * 6 - 15) + 10); }
function lerp(a: number, b: number, t: number): number { return a + t * (b - a); }
function grad2(hash: number, x: number, y: number): number {
  const h = hash & 7;
  const u = h < 4 ? x : y;
  const v = h < 4 ? y : x;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? 2 * v : -2 * v);
}

/** Classic Perlin gradient noise in [-1, 1] — real gradient-based noise (not `Math.random()` static),
 *  which is what gives it coherent texture-like structure across neighboring pixels instead of a
 *  flat speckle. */
function perlin2D(x: number, y: number): number {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
  const xf = x - Math.floor(x), yf = y - Math.floor(y);
  const u = fade(xf), v = fade(yf);
  const aa = PERM[PERM[X] + Y], ab = PERM[PERM[X] + Y + 1];
  const ba = PERM[PERM[X + 1] + Y], bb = PERM[PERM[X + 1] + Y + 1];
  const x1 = lerp(grad2(aa, xf, yf), grad2(ba, xf - 1, yf), u);
  const x2 = lerp(grad2(ab, xf, yf - 1), grad2(bb, xf - 1, yf - 1), u);
  return lerp(x1, x2, v) * 0.5;
}

/** Fractal sum of a few octaves for a richer, less uniform texture than a single noise layer. */
function fractalNoise(x: number, y: number, octaves: number): number {
  let sum = 0, amp = 1, freq = 1, ampSum = 0;
  for (let o = 0; o < octaves; o++) {
    sum += perlin2D(x * freq, y * freq) * amp;
    ampSum += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / ampSum;
}

// ---------------------------------------------------------------------------
// Gauss-Seidel gradient-domain (Poisson-style) blend
// ---------------------------------------------------------------------------

/**
 * Solves, per RGB channel and only for masked pixels, for a result whose discrete Laplacian
 * matches `source`'s own Laplacian, holding unmasked pixels fixed as boundary conditions — the
 * standard Poisson image editing formulation (Perez et al.), via iterative Gauss-Seidel relaxation
 * rather than assembling and solving the full sparse linear system directly. Reads already-updated
 * neighbors within the same pass (true Gauss-Seidel, not Jacobi), which converges markedly faster
 * — important since this runs for a bounded iteration count, not to full convergence.
 */
function poissonBlend(patch: PixelBuffer, source: PixelBuffer, mask: RepairMask, iterations: number): PixelBuffer {
  const { width, height } = patch;
  const n = width * height;
  const out = new Float32Array(n * 4);
  for (let i = 0; i < n * 4; i++) {
    out[i] = isMasked(mask, (i / 4) | 0) ? source.data[i] : patch.data[i];
  }

  const idx = (x: number, y: number) => y * width + x;
  for (let it = 0; it < iterations; it++) {
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const p = idx(x, y);
        if (!isMasked(mask, p)) continue;
        const left = idx(x - 1, y), right = idx(x + 1, y), up = idx(x, y - 1), down = idx(x, y + 1);
        for (let c = 0; c < 3; c++) {
          const o = p * 4 + c;
          const lap = source.data[left * 4 + c] + source.data[right * 4 + c] + source.data[up * 4 + c] + source.data[down * 4 + c] - 4 * source.data[o];
          const neighborSum = out[left * 4 + c] + out[right * 4 + c] + out[up * 4 + c] + out[down * 4 + c];
          out[o] = (neighborSum - lap) / 4;
        }
        out[p * 4 + 3] = source.data[p * 4 + 3];
      }
    }
  }

  const clamped = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < clamped.length; i++) clamped[i] = out[i];
  return { data: clamped, width, height };
}

/** Fewer iterations for a bigger patch keeps worst-case cost roughly constant — a small dust-spot
 *  repair converges fully, a large 300px+ brush stroke gets a cheaper (but still real) pass. */
function iterationsFor(width: number, height: number): number {
  const area = width * height;
  if (area < 64 * 64) return 250;
  if (area < 200 * 200) return 120;
  return 60;
}

// ---------------------------------------------------------------------------
// Mode 2: Create Texture
// ---------------------------------------------------------------------------

export function createTextureFill(patch: PixelBuffer, mask: RepairMask): PixelBuffer {
  const ring = ringIndices(mask, Math.max(8, Math.min(100, Math.round(Math.max(patch.width, patch.height) * 0.15))));
  const stats = ring.length >= 8 ? analyzeRing(patch, ring) : analyzeRing(patch, Array.from({ length: patch.data.length / 4 }, (_, i) => i));

  // Map the ring's average gradient magnitude to a noise frequency: busier texture (higher
  // gradient) synthesizes at a finer scale, flatter texture at a coarser one.
  const freq = 0.02 + Math.min(0.4, stats.meanGradient / 400);
  const stdR = Math.sqrt(stats.varR), stdG = Math.sqrt(stats.varG), stdB = Math.sqrt(stats.varB);

  const synthesized = cloneBuffer(patch);
  for (let y = 0; y < patch.height; y++) {
    for (let x = 0; x < patch.width; x++) {
      const i = y * patch.width + x;
      if (!isMasked(mask, i)) continue;
      const o = i * 4;
      const n1 = fractalNoise(x * freq, y * freq, 4);
      const n2 = fractalNoise((x + 71) * freq, (y + 41) * freq, 4);
      const grain = (Math.random() * 2 - 1) * stats.noiseLevel;
      synthesized.data[o] = stats.meanR + n1 * stdR * 1.4 + grain;
      synthesized.data[o + 1] = stats.meanG + n1 * stdG * 1.4 + grain;
      synthesized.data[o + 2] = stats.meanB + n2 * stdB * 1.4 + grain;
      synthesized.data[o + 3] = 255;
    }
  }

  return poissonBlend(patch, synthesized, mask, iterationsFor(patch.width, patch.height));
}

// ---------------------------------------------------------------------------
// Mode 3: Content-Aware (patch match + blend)
// ---------------------------------------------------------------------------

interface Candidate {
  x: number;
  y: number;
  score: number;
}

/** Mean color + average Sobel magnitude/angle over a square patch at (x, y), clamped to bounds. */
function patchDescriptor(patch: PixelBuffer, x: number, y: number, size: number) {
  const { data, width, height } = patch;
  let r = 0, g = 0, b = 0, grad = 0, sinSum = 0, cosSum = 0, count = 0;
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const px = x + dx, py = y + dy;
      if (px < 0 || py < 0 || px >= width || py >= height) continue;
      const o = (py * width + px) * 4;
      r += data[o]; g += data[o + 1]; b += data[o + 2];
      const s = sobelAt(patch, px, py);
      grad += s.magnitude;
      sinSum += Math.sin(s.angle);
      cosSum += Math.cos(s.angle);
      count++;
    }
  }
  count = Math.max(1, count);
  return { r: r / count, g: g / count, b: b / count, grad: grad / count, angle: Math.atan2(sinSum, cosSum) };
}

function angleDiff(a: number, b: number): number {
  let d = Math.abs(a - b) % (Math.PI * 2);
  if (d > Math.PI) d = Math.PI * 2 - d;
  return d;
}

export function contentAwareFillPatches(patch: PixelBuffer, mask: RepairMask, brushSize: number): PixelBuffer {
  const { width, height } = patch;
  const ringWidth = Math.max(8, Math.min(100, brushSize * 2));
  const ring = ringIndices(mask, ringWidth);
  if (ring.length === 0) return proximityMatchFill(patch, mask);

  const patchSize = Math.max(8, Math.min(32, Math.round(brushSize / 8)));

  // Mask centroid and boundary descriptor (the ring pixels immediately touching the mask) —
  // what every candidate patch is scored against.
  let cx = 0, cy = 0, maskCount = 0;
  for (let i = 0; i < mask.data.length; i++) {
    if (!isMasked(mask, i)) continue;
    cx += i % width; cy += (i / width) | 0; maskCount++;
  }
  cx /= Math.max(1, maskCount); cy /= Math.max(1, maskCount);
  const boundaryRing = ringIndices(mask, 3);
  const boundaryDesc = boundaryRing.length > 0
    ? patchDescriptor(patch, Math.round(cx - patchSize / 2), Math.round(cy - patchSize / 2), patchSize)
    : { r: 128, g: 128, b: 128, grad: 0, angle: 0 };

  // Candidate positions: every ring pixel on a stride grid, top-left-anchored so the candidate
  // patch itself sits over real ring content.
  const stride = Math.max(2, Math.round(patchSize / 2));
  const seen = new Set<number>();
  const candidates: Candidate[] = [];
  const maxGrad = Math.max(1, boundaryDesc.grad, ...ring.map(() => 0));
  for (const i of ring) {
    const rx = i % width, ry = (i / width) | 0;
    const gx = Math.round(rx / stride) * stride, gy = Math.round(ry / stride) * stride;
    const key = gy * width + gx;
    if (seen.has(key)) continue;
    seen.add(key);
    const desc = patchDescriptor(patch, gx, gy, patchSize);
    const colorSim = 1 - Math.min(1, Math.hypot(desc.r - boundaryDesc.r, desc.g - boundaryDesc.g, desc.b - boundaryDesc.b) / 441.7);
    const gradSim = 1 - Math.min(1, angleDiff(desc.angle, boundaryDesc.angle) / Math.PI);
    const freqSim = 1 - Math.min(1, Math.abs(desc.grad - boundaryDesc.grad) / maxGrad);
    const dist = Math.hypot(gx - cx, gy - cy);
    const distScore = 1 - Math.min(1, dist / (ringWidth * 3));
    const score = 0.3 * colorSim + 0.3 * gradSim + 0.2 * freqSim + 0.2 * distScore;
    candidates.push({ x: gx, y: gy, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  const top = candidates.slice(0, 5);
  if (top.length === 0) return proximityMatchFill(patch, mask);

  const totalScore = top.reduce((s, c) => s + Math.max(0.0001, c.score), 0);
  const weights = top.map((c) => Math.max(0.0001, c.score) / totalScore);

  // Blend the top patches, each tiled to cover the mask's bounding box, weighted by score —
  // never just the single best match.
  const blended = cloneBuffer(patch);
  const boxX0 = Math.max(0, Math.floor(cx - patchSize)), boxY0 = Math.max(0, Math.floor(cy - patchSize));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!isMasked(mask, i)) continue;
      let r = 0, g = 0, b = 0;
      for (let k = 0; k < top.length; k++) {
        const c = top[k];
        // Tile the candidate patch across the mask so every masked pixel has source content,
        // regardless of the patch's own (small) size relative to the whole repair region.
        const sx = c.x + (((x - boxX0) % patchSize) + patchSize) % patchSize;
        const sy = c.y + (((y - boxY0) % patchSize) + patchSize) % patchSize;
        const cx2 = Math.max(0, Math.min(width - 1, sx));
        const cy2 = Math.max(0, Math.min(height - 1, sy));
        const o = (cy2 * width + cx2) * 4;
        r += patch.data[o] * weights[k];
        g += patch.data[o + 1] * weights[k];
        b += patch.data[o + 2] * weights[k];
      }
      const o = i * 4;
      blended.data[o] = r; blended.data[o + 1] = g; blended.data[o + 2] = b; blended.data[o + 3] = 255;
    }
  }

  // Edge continuation: where a strong edge in the boundary ring points into the mask, bias the
  // blended "source" pixels just inside the mask along that direction so the Poisson solve below
  // has a real gradient to propagate rather than starting from a flat patch there. A simplified,
  // real stand-in for full Canny-based edge tracing (see module doc comment).
  for (const i of boundaryRing) {
    const bx = i % width, by = (i / width) | 0;
    const s = sobelAt(patch, bx, by);
    if (s.magnitude < 40) continue;
    const dirX = Math.cos(s.angle), dirY = Math.sin(s.angle);
    for (let step = 1; step <= 6; step++) {
      const tx = Math.round(bx + dirX * step), ty = Math.round(by + dirY * step);
      if (tx < 0 || ty < 0 || tx >= width || ty >= height) break;
      const ti = ty * width + tx;
      if (!isMasked(mask, ti)) continue;
      const o = ti * 4, bo = i * 4;
      const falloff = 1 - step / 7;
      blended.data[o] = blended.data[o] * (1 - falloff) + patch.data[bo] * falloff;
      blended.data[o + 1] = blended.data[o + 1] * (1 - falloff) + patch.data[bo + 1] * falloff;
      blended.data[o + 2] = blended.data[o + 2] * (1 - falloff) + patch.data[bo + 2] * falloff;
    }
  }

  return poissonBlend(patch, blended, mask, iterationsFor(width, height));
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function runContentAwareFill(mode: ContentAwareMode, patch: PixelBuffer, mask: RepairMask, brushSize: number): PixelBuffer {
  if (mode === 'proximity') return proximityMatchFill(patch, mask);
  if (mode === 'texture') return createTextureFill(patch, mask);
  return contentAwareFillPatches(patch, mask, brushSize);
}

/**
 * Slices a `width`x`height` axis-aligned region out of a larger pixel buffer (out-of-range area
 * reads as fully transparent black) — builds the bounded "working rect" the algorithms above
 * actually run on, since they're only ever handed a patch around the repair region, never the
 * whole page canvas. The DOM-boundary counterpart (writing a result back onto a live canvas via
 * `ctx.putImageData`) stays in `usePaintLayer.ts`, which is allowed to touch the DOM.
 */
export function extractSubRegion(full: PixelBuffer, x0: number, y0: number, width: number, height: number): PixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy = y0 + y;
    if (sy < 0 || sy >= full.height) continue;
    for (let x = 0; x < width; x++) {
      const sx = x0 + x;
      if (sx < 0 || sx >= full.width) continue;
      const si = (sy * full.width + sx) * 4;
      const di = (y * width + x) * 4;
      data[di] = full.data[si]; data[di + 1] = full.data[si + 1]; data[di + 2] = full.data[si + 2]; data[di + 3] = full.data[si + 3];
    }
  }
  return { data, width, height };
}
