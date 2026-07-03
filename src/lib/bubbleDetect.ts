export function floodFillBubble(
  imageData: ImageData,
  startX: number,
  startY: number,
  regionWidth?: number,
  regionHeight?: number,
  avoidPoints?: { x: number; y: number }[]
): { x: number; y: number; width: number; height: number } | null {
  const result = floodFillBubbleDetailed(imageData, startX, startY, regionWidth, regionHeight, avoidPoints);
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

interface TextCluster {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  pixelCount: number;
}

// Redmean approximation for CIE76 to match human vision perfectly
function redmeanDistance(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  const rmean = (r1 + r2) / 2;
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt((2 + rmean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rmean) / 256) * db * db);
}

// Convert RGB to relative luminance to analyze text-to-background contrast
function getLuminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

// Moore-Neighbor tracing function to extract boundary coordinate points
function traceContour(visited: Uint8Array, width: number, height: number, startX: number, startY: number): number[] {
  let bx = startX;
  let by = startY;
  while (bx > 0 && visited[by * width + (bx - 1)] === 1) {
    bx--;
  }

  const contourPoints: number[] = [];
  let cx = bx;
  let cy = by;
  let dir = 6; 

  const dx = [0, 1, 1, 1, 0, -1, -1, -1];
  const dy = [-1, -1, 0, 1, 1, 1, 0, -1];

  let startCx = cx;
  let startCy = cy;
  let firstStep = true;
  let maxSteps = Math.max(1000, width * height * 0.1); 
  let steps = 0;

  while (steps < maxSteps) {
    if (!firstStep && cx === startCx && cy === startCy) {
      break;
    }
    firstStep = false;
    contourPoints.push(cx, cy);

    let foundNext = false;
    let searchDir = (dir + 5) % 8; 
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

// Ramer-Douglas-Peucker polyline simplification to optimize coordinate sizes
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

// Sweep-line histogram solver to find the largest inscribed rectangle in binary masks
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

// Close mask to eliminate halftone patterns and JPEG noise gaps
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

/**
 * Scans the interior of the filled mask to locate distinct, cohesive text clusters.
 * Crucial for separating overlapping bubbles and determining auto-recovery strategies.
 */
function discoverTextClustersInMask(
  data: UintClampedArray,
  width: number,
  height: number,
  mask: Uint8Array,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): TextCluster[] {
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const isEdge = new Uint8Array(w * h);

  const getL = (x: number, y: number) => {
    const idx = (y * width + x) * 4;
    return getLuminance(data[idx], data[idx + 1], data[idx + 2]);
  };

  // Find high-frequency edge strokes inside the filled mask
  for (let y = 0; y < h; y++) {
    const imgY = minY + y;
    for (let x = 0; x < w; x++) {
      const imgX = minX + x;
      if (mask[imgY * width + imgX] === 0) continue;

      const currentL = getL(imgX, imgY);
      let maxGrad = 0;
      if (x < w - 1 && mask[imgY * width + (imgX + 1)] === 1) {
        maxGrad = Math.max(maxGrad, Math.abs(currentL - getL(imgX + 1, imgY)));
      }
      if (y < h - 1 && mask[(imgY + 1) * width + imgX] === 1) {
        maxGrad = Math.max(maxGrad, Math.abs(currentL - getL(imgX, imgY + 1)));
      }

      if (maxGrad > 38) {
        isEdge[y * w + x] = 1;
      }
    }
  }

  // BFS grouping of stroke pixels with an adaptive jumping bridge to reconstruct blocks
  const visited = new Uint8Array(w * h);
  const clusters: TextCluster[] = [];
  const jumpX = 24; 
  const jumpY = 16; 

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (isEdge[y * w + x] === 1 && visited[y * w + x] === 0) {
        const queueX: number[] = [x];
        const queueY: number[] = [y];
        let qHead = 0;
        visited[y * w + x] = 1;

        let cMinX = x, cMaxX = x, cMinY = y, cMaxY = y;
        let sumX = 0, sumY = 0;

        while (qHead < queueX.length) {
          const cx = queueX[qHead];
          const cy = queueY[qHead];
          qHead++;

          sumX += cx;
          sumY += cy;

          if (cx < cMinX) cMinX = cx;
          if (cx > cMaxX) cMaxX = cx;
          if (cy < cMinY) cMinY = cy;
          if (cy > cMaxY) cMaxY = cy;

          const x0 = Math.max(0, cx - jumpX);
          const x1 = Math.min(w - 1, cx + jumpX);
          const y0 = Math.max(0, cy - jumpY);
          const y1 = Math.min(h - 1, cy + jumpY);

          for (let ny = y0; ny <= y1; ny++) {
            const rowBase = ny * w;
            for (let nx = x0; nx <= x1; nx++) {
              if (isEdge[rowBase + nx] === 1 && visited[rowBase + nx] === 0) {
                visited[rowBase + nx] = 1;
                queueX.push(nx);
                queueY.push(ny);
              }
            }
          }
        }

        const clusterW = cMaxX - cMinX + 1;
        const clusterH = cMaxY - cMinY + 1;

        // Skip small noise structures
        if (queueX.length >= 6 && clusterW >= 4 && clusterH >= 4) {
          clusters.push({
            x: minX + cMinX,
            y: minY + cMinY,
            width: clusterW,
            height: clusterH,
            centerX: minX + Math.round(sumX / queueX.length),
            centerY: minY + Math.round(sumY / queueX.length),
            pixelCount: queueX.length
          });
        }
      }
    }
  }

  return clusters;
}

function extractTextCluster(
  data: UintClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
  searchRadius = 220
): { x: number; y: number; width: number; height: number } | null {
  const minX = Math.max(0, startX - searchRadius);
  const maxX = Math.min(width - 1, startX + searchRadius);
  const minY = Math.max(0, startY - searchRadius);
  const maxY = Math.min(height - 1, startY + searchRadius);

  const w = maxX - minX + 1;
  const h = maxY - minY + 1;

  const isEdge = new Uint8Array(w * h);
  const getL = (x: number, y: number) => {
    const idx = (y * width + x) * 4;
    return getLuminance(data[idx], data[idx + 1], data[idx + 2]);
  };

  for (let y = 0; y < h; y++) {
    const imgY = minY + y;
    for (let x = 0; x < w; x++) {
      const imgX = minX + x;
      const currentL = getL(imgX, imgY);

      let maxGrad = 0;
      if (x < w - 1) maxGrad = Math.max(maxGrad, Math.abs(currentL - getL(imgX + 1, imgY)));
      if (y < h - 1) maxGrad = Math.max(maxGrad, Math.abs(currentL - getL(imgX, imgY + 1)));

      if (maxGrad > 36) { 
        isEdge[y * w + x] = 1;
      }
    }
  }

  const localStartX = startX - minX;
  const localStartY = startY - minY;
  let seedX = -1, seedY = -1;
  let minDistSq = Infinity;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (isEdge[y * w + x]) {
        const dx = x - localStartX;
        const dy = y - localStartY;
        const distSq = dx * dx + dy * dy;
        if (distSq < minDistSq) {
          minDistSq = distSq;
          seedX = x;
          seedY = y;
        }
      }
    }
  }

  if (seedX === -1 || minDistSq > 60 * 60) return null;

  const visited = new Uint8Array(w * h);
  const queueX: number[] = [seedX];
  const queueY: number[] = [seedY];
  let qHead = 0;
  visited[seedY * w + seedX] = 1;

  let cMinX = seedX, cMaxX = seedX, cMinY = seedY, cMaxY = seedY;
  const jumpX = 20; 
  const jumpY = 14; 

  while (qHead < queueX.length) {
    const cx = queueX[qHead];
    const cy = queueY[qHead];
    qHead++;

    if (cx < cMinX) cMinX = cx;
    if (cx > cMaxX) cMaxX = cx;
    if (cy < cMinY) cMinY = cy;
    if (cy > cMaxY) cMaxY = cy;

    const x0 = Math.max(0, cx - jumpX);
    const x1 = Math.min(w - 1, cx + jumpX);
    const y0 = Math.max(0, cy - jumpY);
    const y1 = Math.min(h - 1, cy + jumpY);

    for (let ny = y0; ny <= y1; ny++) {
      const rowBase = ny * w;
      for (let nx = x0; nx <= x1; nx++) {
        if (isEdge[rowBase + nx] && !visited[rowBase + nx]) {
          visited[rowBase + nx] = 1;
          queueX.push(nx);
          queueY.push(ny);
        }
      }
    }
  }

  const clusterW = cMaxX - cMinX + 1;
  const clusterH = cMaxY - cMinY + 1;

  if (queueX.length < 8 || clusterW < 5 || clusterH < 5) return null;

  return {
    x: minX + cMinX,
    y: minY + cMinY,
    width: clusterW,
    height: clusterH
  };
}

function evaluateBoundaryStrength(
  data: UintClampedArray,
  width: number,
  height: number,
  visited: Uint8Array,
  contourPoints: number[]
): number {
  if (contourPoints.length < 4) return 0;

  let totalDiff = 0;
  let samples = 0;

  for (let i = 0; i < contourPoints.length; i += 6) {
    const cx = contourPoints[i];
    const cy = contourPoints[i + 1];

    const baseIdx = (cy * width + cx) * 4;
    const insideL = getLuminance(data[baseIdx], data[baseIdx + 1], data[baseIdx + 2]);

    const dx = [0, 1, 0, -1];
    const dy = [-1, 0, 1, 0];
    for (let j = 0; j < 4; j++) {
      const nx = cx + dx[j];
      const ny = cy + dy[j];
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        if (visited[ny * width + nx] === 0) {
          const outIdx = (ny * width + nx) * 4;
          const outsideL = getLuminance(data[outIdx], data[outIdx + 1], data[outIdx + 2]);
          totalDiff += Math.abs(insideL - outsideL);
          samples++;
          break;
        }
      }
    }
  }

  return samples > 0 ? totalDiff / samples : 0;
}

/**
 * Self-Audit Engine: Verifies the integrity of the generated mask.
 * Automatically checks for leakages, abnormal ratios, or extremely sparse shapes.
 */
function auditResult(
  x: number,
  y: number,
  w: number,
  h: number,
  interior: Uint8Array,
  imageWidth: number,
  imageHeight: number,
  borderStrength: number,
  hasTextCluster: boolean
): boolean {
  const area = w * h;

  // 1. Check for extreme size anomalies
  if (area > imageWidth * imageHeight * 0.45) {
    return false; 
  }

  // 2. Check for extreme aspect ratio (likely a leak into long panels)
  const ratio = Math.max(w, 1) / Math.max(h, 1);
  if (ratio > 6.5 || ratio < 1 / 6.5) {
    return false;
  }

  // 3. Density Audit: Check if the shape is solid or a thin, leaked thread
  let filled = 0;
  for (let cy = y; cy < y + h; cy++) {
    const rowBase = cy * imageWidth;
    for (let cx = x; cx < x + w; cx++) {
      if (interior[rowBase + cx] === 1) filled++;
    }
  }
  const density = filled / Math.max(1, area);
  if (density < 0.22) {
    return false; 
  }

  // 4. Boundary strength Audit
  if (hasTextCluster && borderStrength < 18) {
    return false; 
  }

  return true;
}

function generateRoundedRectContour(x: number, y: number, w: number, h: number, r: number): number[] {
  const points: number[] = [];
  const steps = 4; 
  const corners = [
    { cx: x + w - r, cy: y + r, start: -Math.PI / 2, end: 0 },
    { cx: x + w - r, cy: y + h - r, start: 0, end: Math.PI / 2 },
    { cx: x + r, cy: y + h - r, start: Math.PI / 2, end: Math.PI },
    { cx: x + r, cy: y + r, start: Math.PI, end: (3 * Math.PI) / 2 }
  ];
  for (const c of corners) {
    for (let i = 0; i <= steps; i++) {
      const angle = c.start + (c.end - c.start) * (i / steps);
      points.push(Math.round(c.cx + r * Math.cos(angle)), Math.round(c.cy + r * Math.sin(angle)));
    }
  }
  return points;
}

export function floodFillBubbleDetailed(
  imageData: ImageData,
  startX: number,
  startY: number,
  regionWidth?: number,
  regionHeight?: number,
  avoidPoints?: { x: number; y: number }[]
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

  // 1. Initial text cluster extraction near seed click
  const textCluster = extractTextCluster(data, width, height, startX, startY);

  const patchStats = (cx: number, cy: number, radius: number) => {
    const x0 = clampX(cx - radius), x1 = clampX(cx + radius);
    const y0 = clampY(cy - radius), y1 = clampY(cy + radius);
    let sr = 0, sg = 0, sb = 0, count = 0;
    const samples: number[] = [];
    for (let y = y0; y <= y1; y++) {
      const rowBase = y * width;
      for (let x = x0; x <= x1; x++) {
        const idx = (rowBase + x) * 4;
        if (data[idx + 3] < 64) continue; 
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

  const referenceMatchFraction = (cx: number, cy: number, radius: number, refR: number, refG: number, refB: number) => {
    const x0 = clampX(cx - radius), x1 = clampX(cx + radius);
    const y0 = clampY(cy - radius), y1 = clampY(cy + radius);
    let match = 0, total = 0;
    for (let y = y0; y <= y1; y++) {
      const rowBase = y * width;
      for (let x = x0; x <= x1; x++) {
        const sIdx = (rowBase + x) * 4;
        if (data[sIdx + 3] < 64) continue;
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

  const isStableSeed = (px: number, py: number) => {
    const idx = (py * width + px) * 4;
    if (data[idx + 3] < 64) return true; 
    return majorityMatchFraction(px, py, 3) >= 0.6 && majorityMatchFraction(px, py, 6) >= 0.55;
  };

  // Auto search neighborhood for stable flood seed
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
    if (!found) {
      if (textCluster) return triggerTextOnlyFallback(textCluster, width, height);
      return null;
    }
  }

  const seedIdx = (startY * width + startX) * 4;
  const rawSeedAlpha = data[seedIdx + 3];
  const seedIsTransparent = rawSeedAlpha < 64;
  const seedColor = { r: data[seedIdx], g: data[seedIdx + 1], b: data[seedIdx + 2] };
  const { spread } = patchStats(startX, startY, 4);

  // Self-recovery loop with descending tolerances on failure
  const toleranceTiers = [1.0, 0.70, 0.45];
  let finalDetailedResult: DetailedBubbleResult | null = null;

  for (let tier = 0; tier < toleranceTiers.length; tier++) {
    const toleranceMultiplier = toleranceTiers[tier];
    const tolerance = Math.min(95, Math.max(30, spread * 2.2 + 22)) * toleranceMultiplier;
    const stepTolerance = Math.max(16, tolerance * 0.4);

    const isFillable = (px: number, py: number, parentR: number, parentG: number, parentB: number) => {
      const idx = (py * width + px) * 4;
      const a = data[idx + 3];
      if (a < 64) return true; 
      if (seedIsTransparent) return false; 

      const r = data[idx], g = data[idx + 1], b = data[idx + 2];
      if (redmeanDistance(r, g, b, seedColor.r, seedColor.g, seedColor.b) <= tolerance) return true;
      if (redmeanDistance(r, g, b, parentR, parentG, parentB) <= stepTolerance) return true;

      return referenceMatchFraction(px, py, 2, seedColor.r, seedColor.g, seedColor.b) >= 0.7
          && referenceMatchFraction(px, py, 5, seedColor.r, seedColor.g, seedColor.b) >= 0.62;
    };

    const maxExtentX = Math.min(width, regionWidth ? Math.max(180, Math.round(regionWidth * 2.4)) : Math.round(width * 0.32));
    const maxExtentY = Math.min(height, regionHeight ? Math.max(180, Math.round(regionHeight * 2.4)) : Math.round(height * 0.32));
    const maxIterations = Math.min(260000, Math.max(35000, maxExtentX * maxExtentY * 2));

    // Initialize list of avoid points (starts with user supplied points)
    let dynamicAvoidPoints = [...(avoidPoints ?? [])];

    let floodPass = 0;
    const maxFloodPasses = 2; // Pass 1: Test and discover overlaps, Pass 2: Re-run split
    
    let visited = new Uint8Array(width * height);
    let interior = new Uint8Array(width * height);
    let minX = startX, maxX = startX, minY = startY, maxY = startY;

    while (floodPass < maxFloodPasses) {
      visited = new Uint8Array(width * height);
      interior = new Uint8Array(width * height);
      const queueX: number[] = [startX];
      const queueY: number[] = [startY];
      let qHead = 0;
      visited[startY * width + startX] = 1;
      interior[startY * width + startX] = 1;

      minX = startX; maxX = startX; minY = startY; maxY = startY;
      let interiorCount = 1;
      let iterations = 0;

      // Filter and compute Voronoi bisectors on avoid seeds
      const activeAvoids = dynamicAvoidPoints.filter(p => {
        const adx = p.x - startX, ady = p.y - startY;
        return (adx !== 0 || ady !== 0) && Math.abs(adx) <= maxExtentX * 1.5 && Math.abs(ady) <= maxExtentY * 1.5;
      });

      const isAvoided = (px: number, py: number) => {
        if (activeAvoids.length === 0) return false;
        const mdx = px - startX, mdy = py - startY;
        const ownDistSq = mdx * mdx + mdy * mdy;
        for (let i = 0; i < activeAvoids.length; i++) {
          const p = activeAvoids[i];
          const ddx = px - p.x, ddy = py - p.y;
          if (ddx * ddx + ddy * ddy < ownDistSq) return true; 
        }
        return false;
      };

      while (qHead < queueX.length && iterations < maxIterations) {
        const cx = queueX[qHead];
        const cy = queueY[qHead];
        qHead++;
        iterations++;

        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

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
          if (activeAvoids.length > 0 && isAvoided(nx, ny)) continue; 
          visited[idx1D] = 1;

          if (isFillable(nx, ny, parentR, parentG, parentB)) {
            interior[idx1D] = 1;
            interiorCount++;
            queueX.push(nx);
            queueY.push(ny);
          }
        }
      }

      if (interiorCount < 15) {
        break; 
      }

      // MULTI-BUBBLE OVERLAP DETECTION: Discover all text clusters in the current interior mask
      const foundTextClusters = discoverTextClustersInMask(data, width, height, interior, minX, minY, maxX, maxY);

      // If we find multiple text clusters, it means we have fused overlapping bubbles!
      if (foundTextClusters.length >= 2 && floodPass === 0) {
        // Find our target text cluster closest to the click coordinate (startX, startY)
        let targetClusterIdx = -1;
        let minClusterDistSq = Infinity;
        for (let c = 0; c < foundTextClusters.length; c++) {
          const tc = foundTextClusters[c];
          const ddx = tc.centerX - startX;
          const ddy = tc.centerY - startY;
          const distSq = ddx * ddx + ddy * ddy;
          if (distSq < minClusterDistSq) {
            minClusterDistSq = distSq;
            targetClusterIdx = c;
          }
        }

        if (targetClusterIdx !== -1) {
          // Identify all other clusters as adjacent sibling bubbles, collect centroids as avoid blockers
          let addedAvoids = 0;
          for (let c = 0; c < foundTextClusters.length; c++) {
            if (c === targetClusterIdx) continue;
            dynamicAvoidPoints.push({
              x: foundTextClusters[c].centerX,
              y: foundTextClusters[c].centerY
            });
            addedAvoids++;
          }

          if (addedAvoids > 0) {
            // Re-run the flood fill with the new dynamic constraints to slice the overlapping bubbles perfectly
            floodPass++;
            continue; 
          }
        }
      }

      break; // Proceed with evaluating current pass results
    }

    // Edge leakage pre-audit check
    const touchesLeft = minX <= 1;
    const touchesRight = maxX >= width - 2;
    const touchesTop = minY <= 1;
    const touchesBottom = maxY >= height - 2;
    const edgeTouches = [touchesLeft, touchesRight, touchesTop, touchesBottom].filter(Boolean).length;
    const requiredForReject = regionWidth && regionHeight ? 3 : 4;

    if (edgeTouches >= requiredForReject) {
      continue; // Trigger retry on next tighter tolerance tier
    }

    const rawContour = traceContour(visited, width, height, startX, startY);
    const borderStrength = evaluateBoundaryStrength(data, width, height, visited, rawContour);

    // Self-Audit Check
    const isValid = auditResult(
      minX,
      minY,
      maxX - minX + 1,
      maxY - minY + 1,
      interior,
      width,
      height,
      borderStrength,
      textCluster !== null
    );

    if (!isValid) {
      continue; // Fail audit: attempt next tighter tolerance tier
    }

    const contourPoints = simplifyContour(rawContour);
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

    const closingRadius = Math.max(1, Math.min(4, Math.round(Math.min(bw, bh) * 0.03)));
    const closedMask = closeMask(localMask, bw, bh, closingRadius);
    const rect = maximalInscribedRect(closedMask, bw, bh) || maximalInscribedRect(localMask, bw, bh);

    let safeX: number, safeY: number, safeW: number, safeH: number;
    if (rect) {
      const shrink = 0.93; 
      const cx = minX + rect.x + rect.w / 2;
      const cy = minY + rect.y + rect.h / 2;
      safeW = rect.w * shrink;
      safeH = rect.h * shrink;
      safeX = cx - safeW / 2;
      safeY = cy - safeH / 2;
    } else {
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      safeW = (maxX - minX) * 0.5;
      safeH = (maxY - minY) * 0.5;
      safeX = cx - safeW / 2;
      safeY = cy - safeH / 2;
    }

    finalDetailedResult = {
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
    break; // Break loop as we successfully got a valid audited bubble
  }

  // If all tolerance runs failed the self-audit and we have a valid text cluster, fallback cleanly
  if (!finalDetailedResult && textCluster) {
    return triggerTextOnlyFallback(textCluster, width, height);
  }

  return finalDetailedResult;
}

/**
 * Fallback Mode: Constructs an aesthetic, rounded rectangular boundary fitted 
 * precisely around the text cluster, keeping manga panels safe from leaks.
 */
function triggerTextOnlyFallback(
  cluster: { x: number; y: number; width: number; height: number },
  imageWidth: number,
  imageHeight: number
): DetailedBubbleResult {
  const padX = Math.round(cluster.width * 0.15 + 12);
  const padY = Math.round(cluster.height * 0.12 + 8);

  const safeX = Math.max(0, cluster.x - padX);
  const safeY = Math.max(0, cluster.y - padY);
  const safeW = Math.min(imageWidth - safeX, cluster.width + padX * 2);
  const safeH = Math.min(imageHeight - safeY, cluster.height + padY * 2);

  const r = Math.max(4, Math.min(18, Math.round(Math.min(safeW, safeH) * 0.2)));
  const synthContour = generateRoundedRectContour(safeX, safeY, safeW, safeH, r);

  return {
    x: safeX,
    y: safeY,
    width: safeW,
    height: safeH,
    contour: synthContour,
    safeTextBounds: {
      x: safeX + 3,
      y: safeY + 3,
      width: safeW - 6,
      height: safeH - 6
    }
  };
}