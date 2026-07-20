export interface Pt { x: number; y: number }

/** Bounding-box cap for the Dijkstra search below (~77x77 px). Beyond this the search is
 *  abandoned in favor of a plain straight segment — an honest degrade rather than a main-thread
 *  stall on a far-apart click pair. */
const MAX_NODES = 6000;

/**
 * Snaps a straight segment (`from` -> `to`) onto nearby strong edges in `canvas`, via Dijkstra over
 * a Sobel gradient-magnitude cost field bounded to a padded box around the two points. Cost is
 * inverse edge strength, so the cheapest path hugs strong edges — this is the Magnetic Lasso's
 * "magnetism." Only committed clicks are snapped (no live pointermove preview/tracking, unlike
 * Photoshop's real-time magnetic lasso) — a simpler, still genuinely edge-detection-based MVP.
 */
export function snapSegmentToEdges(canvas: HTMLCanvasElement, from: Pt, to: Pt, padding = 20): Pt[] {
  const minX = Math.max(0, Math.floor(Math.min(from.x, to.x) - padding));
  const minY = Math.max(0, Math.floor(Math.min(from.y, to.y) - padding));
  const maxX = Math.min(canvas.width, Math.ceil(Math.max(from.x, to.x) + padding));
  const maxY = Math.min(canvas.height, Math.ceil(Math.max(from.y, to.y) + padding));
  const w = maxX - minX, h = maxY - minY;
  if (w <= 1 || h <= 1 || w * h > MAX_NODES) return [to];

  const ctx = canvas.getContext('2d');
  if (!ctx) return [to];
  const img = ctx.getImageData(minX, minY, w, h);
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    gray[i] = 0.299 * img.data[o] + 0.587 * img.data[o + 1] + 0.114 * img.data[o + 2];
  }

  // Sobel gradient magnitude -> cost (inverse, so strong edges are cheap to traverse). Border
  // pixels keep a magnitude of 0 (no 3x3 neighborhood), which is fine — they cost the max either way.
  const mag = new Float32Array(w * h);
  let maxMag = 1;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = gray[i - w - 1] + 2 * gray[i - 1] + gray[i + w - 1]
        - gray[i - w + 1] - 2 * gray[i + 1] - gray[i + w + 1];
      const gy = gray[i - w - 1] + 2 * gray[i - w] + gray[i - w + 1]
        - gray[i + w - 1] - 2 * gray[i + w] - gray[i + w + 1];
      const m = Math.hypot(gx, gy);
      mag[i] = m;
      if (m > maxMag) maxMag = m;
    }
  }
  const cost = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) cost[i] = 1 - mag[i] / maxMag + 0.02; // +epsilon: never zero-cost

  const startX = Math.round(from.x) - minX, startY = Math.round(from.y) - minY;
  const endX = Math.round(to.x) - minX, endY = Math.round(to.y) - minY;
  if (startX < 0 || startY < 0 || startX >= w || startY >= h || endX < 0 || endY < 0 || endX >= w || endY >= h) return [to];

  const path = dijkstraPath(cost, w, h, startY * w + startX, endY * w + endX);
  if (!path) return [to];

  // Downsample: keep every ~3rd node so the committed polygon isn't one point per pixel.
  const out: Pt[] = [];
  for (let i = 0; i < path.length; i += 3) {
    const p = path[i];
    out.push({ x: (p % w) + minX, y: Math.floor(p / w) + minY });
  }
  out.push(to);
  return out;
}

/** Binary-heap Dijkstra over a 4-connected grid — O(V log V), not O(V^2). This runs once per click
 *  in a rapid multi-click lasso session, so per-click latency compounds; a linear-scan "find the
 *  min" per iteration would read as visible lag well before the MAX_NODES cap is even reached. */
function dijkstraPath(cost: Float32Array, w: number, h: number, start: number, end: number): number[] | null {
  const n = w * h;
  const dist = new Float32Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const visited = new Uint8Array(n);
  dist[start] = 0;
  const heap = new MinHeap();
  heap.push(start, 0);

  while (heap.size > 0) {
    const u = heap.pop();
    if (visited[u]) continue;
    visited[u] = 1;
    if (u === end) break;
    const ux = u % w, uy = (u / w) | 0;
    const neighbors = [
      ux > 0 ? u - 1 : -1, ux < w - 1 ? u + 1 : -1,
      uy > 0 ? u - w : -1, uy < h - 1 ? u + w : -1,
    ];
    for (const v of neighbors) {
      if (v < 0 || visited[v]) continue;
      const nd = dist[u] + cost[v];
      if (nd < dist[v]) {
        dist[v] = nd;
        prev[v] = u;
        heap.push(v, nd);
      }
    }
  }
  if (dist[end] === Infinity) return null;
  const path: number[] = [];
  for (let at = end; at !== -1; at = prev[at]) path.push(at);
  path.reverse();
  return path;
}

/** Minimal binary min-heap keyed by a separate priority array. Supports duplicate-key pushes —
 *  stale entries are skipped via the `visited` check in `dijkstraPath` rather than a decrease-key. */
class MinHeap {
  private nodes: number[] = [];
  private prios: number[] = [];
  get size() { return this.nodes.length; }
  push(node: number, prio: number) {
    this.nodes.push(node);
    this.prios.push(prio);
    let i = this.nodes.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.prios[parent] <= this.prios[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }
  pop(): number {
    const top = this.nodes[0];
    const last = this.nodes.length - 1;
    this.nodes[0] = this.nodes[last];
    this.prios[0] = this.prios[last];
    this.nodes.pop();
    this.prios.pop();
    let i = 0;
    const n = this.nodes.length;
    for (;;) {
      const l = i * 2 + 1, r = i * 2 + 2;
      let smallest = i;
      if (l < n && this.prios[l] < this.prios[smallest]) smallest = l;
      if (r < n && this.prios[r] < this.prios[smallest]) smallest = r;
      if (smallest === i) break;
      this.swap(i, smallest);
      i = smallest;
    }
    return top;
  }
  private swap(a: number, b: number) {
    [this.nodes[a], this.nodes[b]] = [this.nodes[b], this.nodes[a]];
    [this.prios[a], this.prios[b]] = [this.prios[b], this.prios[a]];
  }
}
