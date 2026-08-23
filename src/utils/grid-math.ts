/**
 * Moduł operacji matematycznych, różniczkowych i geometrycznych na siatkach Voronoi w FMG.
 * @module utils/grid-math
 */

/**
 * Konwertuje fizyczne kilometry do odległości wyrażonej w komórkach siatki.
 */
export function kmToGridCells(km: number): number {
  if (km < 0) return 0;
  const mapCoordinates = (globalThis as any).mapCoordinates;
  const grid = (globalThis as any).grid;
  if (!mapCoordinates || !grid) return km / 10;

  const mapWidthKm = (Math.max(mapCoordinates.lonT, 1) / 360) * 40075;
  const kmPerCell = mapWidthKm / Math.max(grid.cellsX || 100, 1);
  return km / Math.max(kmPerCell, 0.001);
}

/**
 * Konwertuje liczbę komórek siatki do odległości fizycznej w kilometrach.
 */
export function gridCellsToKm(cells: number): number {
  if (cells < 0) return 0;
  const mapCoordinates = (globalThis as any).mapCoordinates;
  const grid = (globalThis as any).grid;
  if (!mapCoordinates || !grid) return cells * 10;

  const mapWidthKm = (Math.max(mapCoordinates.lonT, 1) / 360) * 40075;
  const kmPerCell = mapWidthKm / Math.max(grid.cellsX || 100, 1);
  return cells * kmPerCell;
}

/**
 * Wyznacza fizyczną powierzchnię pojedynczej komórki siatki w km².
 */
export function cellAreaKm2(): number {
  const mapCoordinates = (globalThis as any).mapCoordinates;
  const grid = (globalThis as any).grid;
  if (!mapCoordinates || !grid) return 100;

  const mapWidthKm = (Math.max(mapCoordinates.lonT, 1) / 360) * 40075;
  const mapHeightKm = (Math.max(mapCoordinates.latT, 1) / 180) * 20004;
  const totalCells = Math.max((grid.cellsX || 100) * (grid.cellsY || 100), 1);
  return (mapWidthKm * mapHeightKm) / totalCells;
}

/**
 * Oblicza gradient pola skalarnego [dF/dx, dF/dy] w podanej komórce `cellIndex`
 * metodą ważoną odwrotnością odległości (IDW - Inverse Distance Weighting).
 */
export function scalarGradient(
  field: Float32Array,
  cellIndex: number,
  points: [number, number][],
  neighbors: number[][]
): [number, number] {
  const nb = neighbors[cellIndex];
  if (!nb || nb.length === 0) return [0, 0];

  const [x0, y0] = points[cellIndex];
  const f0 = field[cellIndex];

  let sumDx = 0;
  let sumDy = 0;
  let sumWeightX = 0;
  let sumWeightY = 0;

  for (let i = 0; i < nb.length; i++) {
    const n = nb[i];
    const [xn, yn] = points[n];
    const fn = field[n];

    const dx = xn - x0;
    const dy = yn - y0;
    const distSq = dx * dx + dy * dy;
    if (distSq < 1e-6) continue;

    const df = fn - f0;
    const weight = 1 / distSq;

    sumDx += df * (dx / Math.sqrt(distSq)) * weight;
    sumWeightX += weight;

    sumDy += df * (dy / Math.sqrt(distSq)) * weight;
    sumWeightY += weight;
  }

  const gradX = sumWeightX > 0 ? sumDx / sumWeightX : 0;
  const gradY = sumWeightY > 0 ? sumDy / sumWeightY : 0;

  return [gradX, gradY];
}

/**
 * Wygładza pole skalarne za pomocą dyskretnego operatora Laplasjanu na grafie komórek Voronoi.
 */
export function laplacianSmooth(field: Float32Array, neighbors: number[][], lambda = 0.25, iterations = 1): void {
  if (lambda <= 0 || iterations <= 0) return;
  const n = field.length;
  const temp = new Float32Array(n);

  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < n; i++) {
      const nb = neighbors[i];
      if (!nb || nb.length === 0) {
        temp[i] = field[i];
        continue;
      }

      let sum = 0;
      for (let k = 0; k < nb.length; k++) {
        sum += field[nb[k]];
      }
      const avg = sum / nb.length;
      temp[i] = field[i] + lambda * (avg - field[i]);
    }

    for (let i = 0; i < n; i++) {
      field[i] = temp[i];
    }
  }
}

/**
 * Rzutuje wektor prędkości (u, v) na kierunek styczny do linii brzegowej.
 */
export function projectTangentToCoast(
  u: number,
  v: number,
  cellIndex: number,
  cellsT: number[],
  points: [number, number][],
  neighbors: number[][]
): [number, number] {
  const nb = neighbors[cellIndex];
  if (!nb || nb.length === 0) return [u, v];

  const [x0, y0] = points[cellIndex];
  let normX = 0;
  let normY = 0;
  let landNeighbors = 0;

  for (let i = 0; i < nb.length; i++) {
    const n = nb[i];
    if (cellsT[n] > 0) {
      const [xn, yn] = points[n];
      const dx = xn - x0;
      const dy = yn - y0;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 1e-4) {
        normX += dx / len;
        normY += dy / len;
        landNeighbors++;
      }
    }
  }

  if (landNeighbors === 0) return [u, v];

  const normLen = Math.sqrt(normX * normX + normY * normY);
  if (normLen < 1e-4) return [u, v];

  const nx = normX / normLen;
  const ny = normY / normLen;
  const dot = u * nx + v * ny;

  if (dot > 0) {
    const tangU = u - dot * nx;
    const tangV = v - dot * ny;
    return [tangU, tangV];
  }

  return [u, v];
}

export interface SpatialGrid {
  cellSize: number;
  cols: number;
  rows: number;
  cellLookup: Int32Array;
  buckets: number[][];
}

let cachedSpatialGrid: SpatialGrid | null = null;
let cachedPointsRef: [number, number][] | null = null;

export function getOrCreateSpatialGrid(points: [number, number][], cellSize = 22): SpatialGrid {
  if (cachedSpatialGrid && cachedPointsRef === points && cachedSpatialGrid.cellSize === cellSize) {
    return cachedSpatialGrid;
  }

  let maxX = 1000;
  let maxY = 1000;
  for (let i = 0; i < points.length; i++) {
    if (points[i][0] > maxX) maxX = points[i][0];
    if (points[i][1] > maxY) maxY = points[i][1];
  }

  const cols = Math.max(1, Math.ceil((maxX + 100) / cellSize));
  const rows = Math.max(1, Math.ceil((maxY + 100) / cellSize));
  const total = cols * rows;
  const cellLookup = new Int32Array(total).fill(0);
  const buckets: number[][] = Array.from({ length: total }, () => []);

  for (let i = 0; i < points.length; i++) {
    const [px, py] = points[i];
    const col = Math.max(0, Math.min(cols - 1, Math.floor(px / cellSize)));
    const row = Math.max(0, Math.min(rows - 1, Math.floor(py / cellSize)));
    const bucketIdx = row * cols + col;
    cellLookup[bucketIdx] = i;
    buckets[bucketIdx].push(i);
  }

  cachedSpatialGrid = { cellSize, cols, rows, cellLookup, buckets };
  cachedPointsRef = points;
  return cachedSpatialGrid;
}

export function findClosestCellFast(
  x: number,
  y: number,
  points: [number, number][],
  spatialGrid?: SpatialGrid
): number {
  if (!points || points.length === 0) return 0;
  const grid = spatialGrid || getOrCreateSpatialGrid(points, 22);
  const gx = Math.min(grid.cols - 1, Math.max(0, Math.floor(x / grid.cellSize)));
  const gy = Math.min(grid.rows - 1, Math.max(0, Math.floor(y / grid.cellSize)));
  return grid.cellLookup[gy * grid.cols + gx];
}

/**
 * Interpoluje wektor prędkości (u, v) w dowolnym punkcie (x, y) mapy
 * z wykorzystaniem ważenia odwrotnością kwadratu odległości w otoczeniu O(1).
 */
export function interpolateVector(
  x: number,
  y: number,
  fieldU: Float32Array,
  fieldV: Float32Array,
  points: [number, number][],
  searchRadiusPx = 50
): [number, number] {
  let sumU = 0;
  let sumV = 0;
  let sumWeight = 0;
  const maxDistSq = searchRadiusPx * searchRadiusPx;

  const sGrid = getOrCreateSpatialGrid(points, 40);
  const { cellSize, cols, rows, buckets } = sGrid;

  const centerCol = Math.floor(x / cellSize);
  const centerRow = Math.floor(y / cellSize);

  const minR = Math.max(0, centerRow - 1);
  const maxR = Math.min(rows - 1, centerRow + 1);
  const minC = Math.max(0, centerCol - 1);
  const maxC = Math.min(cols - 1, centerCol + 1);

  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      const bucket = buckets[r * cols + c];
      if (!bucket) continue;
      for (let k = 0; k < bucket.length; k++) {
        const i = bucket[k];
        const [px, py] = points[i];
        const dx = x - px;
        const dy = y - py;
        const distSq = dx * dx + dy * dy;

        if (distSq < 1e-4) {
          return [fieldU[i], fieldV[i]];
        }

        if (distSq < maxDistSq) {
          const weight = 1 / distSq;
          sumU += fieldU[i] * weight;
          sumV += fieldV[i] * weight;
          sumWeight += weight;
        }
      }
    }
  }

  if (sumWeight > 0) {
    return [sumU / sumWeight, sumV / sumWeight];
  }

  return [0, 0];
}

/**
 * Całkuje trajektorię linii prądu metodą Runge-Kutta 2-go rzędu (RK2 Midpoint).
 */
export function traceStreamline(
  x0: number,
  y0: number,
  fieldU: Float32Array,
  fieldV: Float32Array,
  points: [number, number][],
  steps = 6,
  stepSize = 8,
  maxAngleDeg = 45,
  mapBounds?: [number, number]
): [number, number][] {
  const trajectory: [number, number][] = [[x0, y0]];
  let curX = x0;
  let curY = y0;
  let prevAngle: number | null = null;
  const maxAngleRad = (maxAngleDeg * Math.PI) / 180;

  const [maxX, maxY] = mapBounds || [Infinity, Infinity];

  for (let s = 0; s < steps; s++) {
    const [u1, v1] = interpolateVector(curX, curY, fieldU, fieldV, points);
    const speed1 = Math.sqrt(u1 * u1 + v1 * v1);
    if (speed1 < 0.1) break;

    const midX = curX + (u1 / speed1) * (stepSize * 0.5);
    const midY = curY + (v1 / speed1) * (stepSize * 0.5);

    const [u2, v2] = interpolateVector(midX, midY, fieldU, fieldV, points);
    const speed2 = Math.sqrt(u2 * u2 + v2 * v2);
    if (speed2 < 0.1) break;

    const curAngle = Math.atan2(v2, u2);
    if (prevAngle !== null) {
      let angleDiff = Math.abs(curAngle - prevAngle);
      if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
      if (angleDiff > maxAngleRad) break;
    }
    prevAngle = curAngle;

    const nextX = curX + (u2 / speed2) * stepSize;
    const nextY = curY + (v2 / speed2) * stepSize;

    if (nextX < 0 || nextX > maxX || nextY < 0 || nextY > maxY) {
      const clampedX = Math.max(0, Math.min(maxX, nextX));
      const clampedY = Math.max(0, Math.min(maxY, nextY));
      trajectory.push([clampedX, clampedY]);
      break;
    }

    trajectory.push([nextX, nextY]);
    curX = nextX;
    curY = nextY;
  }

  return trajectory;
}
