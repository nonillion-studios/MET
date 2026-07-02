export function floodFillBubble(
  imageData: ImageData,
  startX: number,
  startY: number,
  regionWidth?: number,
  regionHeight?: number
): { x: number; y: number; width: number; height: number } | null {
  const result = floodFillBubbleDetailed(imageData, startX, startY, regionWidth, regionHeight);
  if (!result) return null;
  return {
    x: result.x,
    y: result.y,
    width: result.width,
    height: result.height,
  };
}

export interface DetailedBubbleResult {
  x: number;
  y: number;
  width: number;
  height: number;
  contour: number[]; // flat array of coordinates [x1, y1, x2, y2, ...]
  safeTextBounds: { x: number; y: number; width: number; height: number };
}

// Perceptual-ish weighted RGB distance ("redmean" approximation of CIE76).
// Far cheaper than converting to Lab, but tracks human color perception
// much better than plain Euclidean distance - important once we compare
// arbitrary bubble colors instead of just "is it light".
function redmeanDistance(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  const rmean = (r1 + r2) / 2;
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt((2 + rmean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rmean) / 256) * db * db);
}

// Moore-Neighbor tracing function to extract pixel-perfect boundary of a visited mask
function traceContour(visited: Uint8Array, width: number, height: number, startX: number, startY: number): number[] {
  // Find leftmost visited pixel in the connected component to start boundary search safely
  let bx = startX;
  let by = startY;
  while (bx > 0 && visited[by * width + (bx - 1)] === 1) {
    bx--;
  }

  const contourPoints: number[] = [];
  let cx = bx;
  let cy = by;
  let dir = 6; // Start searching with direction pointing left (6)

  // 8 directions clockwise (0=up, 1=up-right, 2=right, 3=down-right, 4=down, 5=down-left, 6=left, 7=up-left)
  const dx = [0, 1, 1, 1, 0, -1, -1, -1];
  const dy = [-1, -1, 0, 1, 1, 1, 0, -1];

  let startCx = cx;
  let startCy = cy;
  let firstStep = true;
  let maxSteps = Math.max(1000, width * height * 0.1); // Guard limit
  let steps = 0;

  while (steps < maxSteps) {
    if (!firstStep && cx === startCx && cy === startCy) {
      break;
    }
    firstStep = false;
    contourPoints.push(cx, cy);

    let foundNext = false;
    // Walk counter-clockwise/clockwise around Moore neighborhood
    let searchDir = (dir + 5) % 8; // backtrack direction
    for (let k = 0; k < 8; k++) {
      const d = (searchDir + k) % 8;
      const nx = cx + dx[d];
      const ny = cy + dy[d];
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        if (visited[ny * width + nx] === 1) {
          cx = nx;
          cy = ny;
          dir = d;
          foundNext = true;
          break;
        }
      }
    }
    if (!foundNext) {
      break;
    }
    steps++;
  }

  return contourPoints;
}

// Ramer-Douglas-Peucker polyline simplification (iterative, to avoid recursion
// depth issues on large contours). Shape-preserving, unlike naive stride
// downsampling - critical for jagged "explosion" bubbles and cloud-shaped
// thought bubbles where a fixed stride can erase the defining features.
function douglasPeucker(points: number[], epsilon: number): number[] {
  const n = points.length / 2;
  if (n < 3) return points.slice();

  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;

  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length > 0) {
    const [startIdx, endIdx] = stack.pop()!;
    if (endIdx <= startIdx + 1) continue;

    const x1 = points[startIdx * 2];
    const y1 = points[startIdx * 2 + 1];
    const x2 = points[endIdx * 2];
    const y2 = points[endIdx * 2 + 1];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;

    let maxDist = -1;
    let maxIdx = -1;
    for (let i = startIdx + 1; i < endIdx; i++) {
      const px = points[i * 2];
      const py = points[i * 2 + 1];
      let dist: number;
      if (lenSq === 0) {
        dist = Math.hypot(px - x1, py - y1);
      } else {
        const t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
        const projX = x1 + t * dx;
        const projY = y1 + t * dy;
        dist = Math.hypot(px - projX, py - projY);
      }
      if (dist > maxDist) {
        maxDist = dist;
        maxIdx = i;
      }
    }

    if (maxDist > epsilon && maxIdx !== -1) {
      keep[maxIdx] = 1;
      stack.push([startIdx, maxIdx]);
      stack.push([maxIdx, endIdx]);
    }
  }

  const result: number[] = [];
  for (let i = 0; i < n; i++) {
    if (keep[i]) result.push(points[i * 2], points[i * 2 + 1]);
  }
  return result;
}

// Progressively simplify until the point count is render-friendly, instead of
// blindly picking every Nth point regardless of local curvature.
function simplifyContour(points: number[], targetMax = 180): number[] {
  if (points.length / 2 <= targetMax) return points;
  let simplified = points;
  let epsilon = 1.0;
  for (let i = 0; i < 10 && simplified.length / 2 > targetMax; i++) {
    simplified = douglasPeucker(points, epsilon);
    epsilon *= 1.6;
  }
  return simplified;
}

// Largest axis-aligned rectangle fully inscribed in a binary mask (classic
// "maximal rectangle in histogram" sweep, O(w*h)). This replaces the old
// ray-cast-from-centroid heuristic: instead of assuming the bubble is
// roughly elliptical, it finds a rectangle that is *guaranteed* to sit
// inside the detected interior, so it holds up for round, oval, rectangular
// caption boxes, jagged shout bubbles, and lumpy cloud-shaped thought
// bubbles alike - and it naturally excludes thin tails/spikes since those
// can never contribute to the largest rectangle.
function maximalInscribedRect(mask: Uint8Array, w: number, h: number): { x: number; y: number; w: number; h: number } | null {
  if (w <= 0 || h <= 0) return null;

  const heights = new Int32Array(w);
  const stack: number[] = [];
  let best = { area: 0, x: 0, y: 0, w: 0, h: 0 };

  for (let row = 0; row < h; row++) {
    const rowBase = row * w;
    for (let col = 0; col < w; col++) {
      heights[col] = mask[rowBase + col] ? heights[col] + 1 : 0;
    }

    stack.length = 0;
    for (let col = 0; col <= w; col++) {
      const curHeight = col < w ? heights[col] : 0;
      while (stack.length > 0 && heights[stack[stack.length - 1]] >= curHeight) {
        const topIdx = stack.pop()!;
        const height = heights[topIdx];
        const left = stack.length > 0 ? stack[stack.length - 1] + 1 : 0;
        const width = col - left;
        const area = height * width;
        if (area > best.area) {
          best = { area, x: left, y: row - height + 1, w: width, h: height };
        }
      }
      stack.push(col);
    }
  }

  return best.area > 0 ? best : null;
}

// Morphological closing (dilate then erode) with a small square kernel.
// Halftone screentone dots and JPEG speckle punch tiny 1-2px holes in the
// interior mask that would otherwise fragment the maximal-rectangle search
// into a sliver; closing bridges those small holes back up while leaving the
// mask's true outer shape essentially untouched.
function closeMask(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  const dilated = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) { dilated[y * w + x] = 1; continue; }
      let found = false;
      for (let dy = -radius; dy <= radius && !found; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        const rowBase = ny * w;
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          if (mask[rowBase + nx]) { found = true; break; }
        }
      }
      dilated[y * w + x] = found ? 1 : 0;
    }
  }

  const closed = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!dilated[y * w + x]) { closed[y * w + x] = 0; continue; }
      let allSet = true;
      for (let dy = -radius; dy <= radius && allSet; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) { allSet = false; break; }
        const rowBase = ny * w;
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w || !dilated[rowBase + nx]) { allSet = false; break; }
        }
      }
      closed[y * w + x] = allSet ? 1 : 0;
    }
  }
  return closed;
}

export function floodFillBubbleDetailed(
  imageData: ImageData,
  startX: number,
  startY: number,
  regionWidth?: number,
  regionHeight?: number
): DetailedBubbleResult | null {
  const { width, height, data } = imageData;
  if (width === 0 || height === 0) return null;

  startX = Math.round(startX);
  startY = Math.round(startY);
  if (startX < 0 || startX >= width || startY < 0 || startY >= height) {
    return null;
  }

  const clampX = (x: number) => Math.min(width - 1, Math.max(0, x));
  const clampY = (y: number) => Math.min(height - 1, Math.max(0, y));

  // Local color variance around the seed - used to size an adaptive
  // tolerance. Flat-colored bubbles get a tight tolerance (avoids leaking
  // past thin outlines); noisy/gradient/halftone-shaded bubbles get a wider
  // one so BFS doesn't fragment into hundreds of disconnected islands.
  const patchStats = (cx: number, cy: number, radius: number) => {
    const x0 = clampX(cx - radius), x1 = clampX(cx + radius);
    const y0 = clampY(cy - radius), y1 = clampY(cy + radius);
    let sr = 0, sg = 0, sb = 0, count = 0;
    const samples: number[] = [];
    for (let y = y0; y <= y1; y++) {
      const rowBase = y * width;
      for (let x = x0; x <= x1; x++) {
        const idx = (rowBase + x) * 4;
        if (data[idx + 3] < 64) continue; // ignore transparent samples
        sr += data[idx]; sg += data[idx + 1]; sb += data[idx + 2];
        samples.push(data[idx], data[idx + 1], data[idx + 2]);
        count++;
      }
    }
    if (count === 0) return { spread: 0 };
    const mr = sr / count, mg = sg / count, mb = sb / count;
    let varSum = 0;
    for (let i = 0; i < samples.length; i += 3) {
      const dr = samples[i] - mr, dg = samples[i + 1] - mg, db = samples[i + 2] - mb;
      varSum += dr * dr + dg * dg + db * db;
    }
    return { spread: Math.sqrt(varSum / (count * 3)) };
  };

  // Fraction of opaque samples in a window whose color is close to a given
  // reference color. General form of the "majority vote" test: used both to
  // compare a pixel against its OWN color (isStableSeed, below) and to
  // compare a candidate fill pixel against the bubble's seed color
  // (isFillable's anti-leak guard). A point sitting deep in a noisy/
  // halftone-shaded fill still has the reference color as the dominant
  // (majority) color around it, while a point on a thin stroke or straddling
  // a real edge between two regions does not - the reference is only ever a
  // minority there, however the mean/variance shakes out.
  const referenceMatchFraction = (cx: number, cy: number, radius: number, refR: number, refG: number, refB: number) => {
    const x0 = clampX(cx - radius), x1 = clampX(cx + radius);
    const y0 = clampY(cy - radius), y1 = clampY(cy + radius);
    let match = 0, total = 0;
    for (let y = y0; y <= y1; y++) {
      const rowBase = y * width;
      for (let x = x0; x <= x1; x++) {
        const sIdx = (rowBase + x) * 4;
        if (data[sIdx + 3] < 64) continue; // transparency handled separately by callers
        total++;
        if (redmeanDistance(data[sIdx], data[sIdx + 1], data[sIdx + 2], refR, refG, refB) <= 40) match++;
      }
    }
    return total === 0 ? 1 : match / total;
  };

  const majorityMatchFraction = (cx: number, cy: number, radius: number) => {
    const idx = (cy * width + cx) * 4;
    return referenceMatchFraction(cx, cy, radius, data[idx], data[idx + 1], data[idx + 2]);
  };

  // A click can easily land on a thin black outline stroke, a text glyph, or
  // just past the edge of one, instead of squarely on the bubble's fill.
  // Detect that with a *self-relative* test: compare the exact pixel to the
  // average of its own immediate neighborhood. A pixel sitting well inside
  // any large flat area (fill or background, light or dark or colored) is
  // close to its own neighborhood average at any sampling radius; a pixel
  // on or near a thin stroke/glyph - narrower than the sampling window - is
  // a sharp outlier because that window mostly sees whatever surrounds the
  // stroke instead. Checking at two radii (matching the smaller radius used
  // later to derive the actual fill color) guarantees that whatever seed we
  // settle on is not just "not on the stroke" but solidly representative of
  // the fill, not a blend contaminated by a nearby edge. This works for
  // bubbles of any color and doesn't get skewed by a single distant
  // reference sample the way comparing only against a far-away point would.
  const isStableSeed = (px: number, py: number) => {
    const idx = (py * width + px) * 4;
    if (data[idx + 3] < 64) return true; // transparent regions are trivially stable
    // Require the pixel's own color to be the majority at two window sizes:
    // a small one (catches thin strokes/glyphs) and a wider one (catches
    // sitting just past the edge, where a small window alone could still
    // look locally uniform).
    return majorityMatchFraction(px, py, 3) >= 0.6 && majorityMatchFraction(px, py, 6) >= 0.55;
  };

  if (!isStableSeed(startX, startY)) {
    let found = false;
    for (let r = 1; r < 40 && !found; r++) {
      const step = Math.max(1, Math.floor(r / 2));
      for (let dy = -r; dy <= r && !found; dy += step) {
        for (let dx = -r; dx <= r && !found; dx += step) {
          const nx = startX + dx, ny = startY + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          if (isStableSeed(nx, ny)) {
            startX = nx;
            startY = ny;
            found = true;
          }
        }
      }
    }
    if (!found) return null; // Couldn't find any representative bubble fill nearby
  }

  const seedIdx = (startY * width + startX) * 4;
  const rawSeedAlpha = data[seedIdx + 3];
  const seedIsTransparent = rawSeedAlpha < 64;
  // Use the raw pixel directly rather than averaging a window around it.
  // isStableSeed already confirmed (via majority vote, not a mean) that this
  // exact color is the dominant one nearby, so it's already a trustworthy
  // reference - any further averaging just reintroduces the same failure
  // modes stability-checking was meant to avoid: a small window is noisy in
  // textured fills, a larger one risks bleeding in a neighboring region.
  const seedColor = { r: data[seedIdx], g: data[seedIdx + 1], b: data[seedIdx + 2] };
  const { spread } = patchStats(startX, startY, 4);
  // Adaptive tolerance: tight for flat colors, generous for textured/shaded fills.
  const tolerance = Math.min(95, Math.max(30, spread * 2.2 + 22));
  // Per-step tolerance for gradient/shaded bubbles: tighter than the
  // absolute seed tolerance, but measured against the immediate neighbor a
  // candidate is being expanded from (not the distant seed). This lets a
  // smoothly shaded fill be followed all the way across a bubble even once
  // its color has drifted well past what a single fixed tolerance-to-seed
  // check would ever allow, without loosening the seed check itself (which
  // stays tight and is what keeps a hop straight onto a dark outline out).
  const stepTolerance = Math.max(16, tolerance * 0.4);

  // A candidate pixel is fillable outright if it plainly matches the seed
  // color, or plainly continues the local gradient from whichever
  // already-accepted pixel it's being expanded from. Anything else is
  // ambiguous - it could be an isolated halftone/JPEG speck deep inside the
  // fill, or it could be the first pixel of a real outline/boundary - and is
  // resolved with a majority vote at two window sizes (same technique as
  // isStableSeed): accept only if the seed color is still the dominant color
  // nearby at BOTH a tight and a looser radius. A lone speck still has the
  // fill color all around it and passes; a pixel that has actually crossed
  // onto or through a border does not, because the window is now dominated
  // by the outline or whatever lies beyond it. This is what keeps a thin,
  // anti-aliased border between two similarly-colored adjacent bubbles from
  // being smoothed away by simple averaging and leaking the fill between them.
  const isFillable = (px: number, py: number, parentR: number, parentG: number, parentB: number) => {
    const idx = (py * width + px) * 4;
    const a = data[idx + 3];
    if (a < 64) return true; // Transparent regions always count as bubble interior
    if (seedIsTransparent) return false; // Seed was a transparent hole; don't spill into opaque art

    const r = data[idx], g = data[idx + 1], b = data[idx + 2];
    if (redmeanDistance(r, g, b, seedColor.r, seedColor.g, seedColor.b) <= tolerance) return true;
    if (redmeanDistance(r, g, b, parentR, parentG, parentB) <= stepTolerance) return true;

    return referenceMatchFraction(px, py, 2, seedColor.r, seedColor.g, seedColor.b) >= 0.7
        && referenceMatchFraction(px, py, 5, seedColor.r, seedColor.g, seedColor.b) >= 0.62;
  };

  // Expansion limits: generous enough for full-page-wide bubbles when we
  // have a size hint, and scaled to the image itself when we don't (a fixed
  // 300px default made no sense across a 600px crop vs. a 4000px scan).
  const maxExtentX = Math.min(width, regionWidth ? Math.max(180, Math.round(regionWidth * 2.4)) : Math.round(width * 0.32));
  const maxExtentY = Math.min(height, regionHeight ? Math.max(180, Math.round(regionHeight * 2.4)) : Math.round(height * 0.32));
  const maxIterations = Math.min(260000, Math.max(35000, maxExtentX * maxExtentY * 2));

  const visited = new Uint8Array(width * height); // interior fill + one-pixel boundary ring (for contour)
  const interior = new Uint8Array(width * height); // interior fill only (for safe text-bounds rectangle)
  const queueX: number[] = [startX];
  const queueY: number[] = [startY];
  let qHead = 0;
  visited[startY * width + startX] = 1;
  interior[startY * width + startX] = 1;

  let minX = startX, maxX = startX, minY = startY, maxY = startY;
  let interiorCount = 1;
  let iterations = 0;

  while (qHead < queueX.length && iterations < maxIterations) {
    const cx = queueX[qHead];
    const cy = queueY[qHead];
    qHead++;
    iterations++;

    if (cx < minX) minX = cx;
    if (cx > maxX) maxX = cx;
    if (cy < minY) minY = cy;
    if (cy > maxY) maxY = cy;

    // Color of the cell being expanded from - the "local reference" that
    // lets isFillable follow a gradient step by step (see stepTolerance).
    const parentIdx = (cy * width + cx) * 4;
    const parentR = data[parentIdx], parentG = data[parentIdx + 1], parentB = data[parentIdx + 2];

    const nxs = [cx + 1, cx - 1, cx, cx];
    const nys = [cy, cy, cy + 1, cy - 1];

    for (let i = 0; i < 4; i++) {
      const nx = nxs[i], ny = nys[i];
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      if (Math.abs(nx - startX) > maxExtentX || Math.abs(ny - startY) > maxExtentY) continue;

      const idx1D = ny * width + nx;
      if (visited[idx1D]) continue;
      visited[idx1D] = 1;

      if (isFillable(nx, ny, parentR, parentG, parentB)) {
        interior[idx1D] = 1;
        interiorCount++;
        queueX.push(nx);
        queueY.push(ny);
      }
      // else: leave interior=0; it's just registered in `visited` as the boundary ring
    }
  }

  if (interiorCount < 15) return null;

  // Leak guard: a flood fill that reaches most edges of the actual image is
  // almost certainly bleeding into panel background/art rather than staying
  // inside a bubble - reject instead of returning a nonsense region.
  const touchesLeft = minX <= 1;
  const touchesRight = maxX >= width - 2;
  const touchesTop = minY <= 1;
  const touchesBottom = maxY >= height - 2;
  const edgeTouches = [touchesLeft, touchesRight, touchesTop, touchesBottom].filter(Boolean).length;
  const requiredForReject = regionWidth && regionHeight ? 3 : 4;
  if (edgeTouches >= requiredForReject) return null;

  // Extract precise Moore-Neighbor outer contour, then simplify it while
  // preserving its actual shape (jagged, round, or boxy).
  const rawContour = traceContour(visited, width, height, startX, startY);
  const contourPoints = simplifyContour(rawContour);

  // Safe text bounds = largest rectangle that fits fully inside the detected
  // interior. Computed on the local bounding-box sub-grid for speed.
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const localMask = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) {
    const srcRow = (minY + y) * width + minX;
    const dstRow = y * bw;
    for (let x = 0; x < bw; x++) {
      localMask[dstRow + x] = interior[srcRow + x];
    }
  }
  // Close over small noise-driven holes (halftone dots, JPEG speckle) before
  // hunting for the largest inscribed rectangle, otherwise a single stray
  // dark speck can chop what should be a generous text box into a sliver.
  const closingRadius = Math.max(1, Math.min(4, Math.round(Math.min(bw, bh) * 0.03)));
  const closedMask = closeMask(localMask, bw, bh, closingRadius);
  const rect = maximalInscribedRect(closedMask, bw, bh) || maximalInscribedRect(localMask, bw, bh);

  let safeX: number, safeY: number, safeW: number, safeH: number;
  if (rect) {
    const shrink = 0.93; // small breathing margin from the exact detected edge
    const cx = minX + rect.x + rect.w / 2;
    const cy = minY + rect.y + rect.h / 2;
    safeW = rect.w * shrink;
    safeH = rect.h * shrink;
    safeX = cx - safeW / 2;
    safeY = cy - safeH / 2;
  } else {
    // Should not normally happen given the interiorCount guard above, but
    // fall back to a conservative centered box rather than failing outright.
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    safeW = (maxX - minX) * 0.5;
    safeH = (maxY - minY) * 0.5;
    safeX = cx - safeW / 2;
    safeY = cy - safeH / 2;
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    contour: contourPoints,
    safeTextBounds: {
      x: safeX,
      y: safeY,
      width: safeW,
      height: safeH
    }
  };
}
