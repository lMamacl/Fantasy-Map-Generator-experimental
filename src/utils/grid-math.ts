/**
 * Moduł operacji matematycznych, różniczkowych i geometrycznych na siatkach Voronoi w FMG.
 * @module utils/grid-math
 */

/**
 * Konwertuje fizyczne kilometry do odległości wyrażonej w komórkach siatki.
 * Uwzględnia szerokość wycinka mapy na globie (`mapCoordinates.lonT`) oraz rozdzielczość siatki (`cellsX`).
 *
 * @param km Odległość fizyczna w kilometrach (musi być nieujemna)
 * @returns Równoważna liczba komórek siatki
 *
 * @example
 * ```ts
 * const cells = kmToGridCells(1500); // np. 45 komórek dla mapy kontynentu
 * ```
 */
export function kmToGridCells(km: number): number {
  if (km < 0) return 0;
  const mapCoordinates = (globalThis as any).mapCoordinates;
  const grid = (globalThis as any).grid;
  if (!mapCoordinates || !grid) return km / 10;

  // Obwód Ziemi ~40075 km
  const mapWidthKm = (Math.max(mapCoordinates.lonT, 1) / 360) * 40075;
  const kmPerCell = mapWidthKm / Math.max(grid.cellsX || 100, 1);
  return km / Math.max(kmPerCell, 0.001);
}

/**
 * Konwertuje liczbę komórek siatki do odległości fizycznej w kilometrach.
 *
 * @param cells Liczba komórek
 * @returns Odległość w kilometrach
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
 *
 * @returns Powierzchnia komórki w km²
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
 *
 * @param field Tablica wartości skalaru (np. ciśnienia lub wysokości)
 * @param cellIndex Indeks komórki centralnej
 * @param points Tablica współrzędnych [x, y] punktów siatki
 * @param neighbors Tablica indeksów sąsiadów dla każdej komórki
 * @returns [gradX, gradY] gradient skalaru
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

    if (Math.abs(dx) > 1e-4) {
      const weightX = 1 / Math.abs(dx);
      sumDx += (df / dx) * weightX;
      sumWeightX += weightX;
    }

    if (Math.abs(dy) > 1e-4) {
      const weightY = 1 / Math.abs(dy);
      sumDy += (df / dy) * weightY;
      sumWeightY += weightY;
    }
  }

  const gradX = sumWeightX > 0 ? sumDx / sumWeightX : 0;
  const gradY = sumWeightY > 0 ? sumDy / sumWeightY : 0;

  return [gradX, gradY];
}

/**
 * Rzutuje wektor prądu morskiego lub wiatru na kierunek styczny do linii brzegowej,
 * usuwając składową prostopadłą wnikającą w ląd (warunek V · n_coast = 0).
 *
 * @param u Składowa X wektora prędkości
 * @param v Składowa Y wektora prędkości
 * @param cellIndex Indeks komórki
 * @param cellsT Tablica odległości od brzegu (`cells.t`), gdzie wartości > 0 to ląd
 * @param points Współrzędne punktów
 * @param neighbors Sąsiedzi komórek
 * @returns [tangU, tangV] wektor po usunięciu składowej prostopadłej do lądu
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
      // sąsiad jest lądem
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

  // Iloczyn skalarny V · n (dodatni, gdy wektor zmierza ku lądowi)
  const dot = u * nx + v * ny;

  if (dot > 0) {
    const tangU = u - dot * nx;
    const tangV = v - dot * ny;
    return [tangU, tangV];
  }

  return [u, v];
}

/**
 * Interpoluje wektor prędkości (u, v) w dowolnym punkcie (x, y) mapy
 * z wykorzystaniem ważenia odwrotnością kwadratu odległości.
 *
 * @param x Współrzędna X punktu zapytania
 * @param y Współrzędna Y punktu zapytania
 * @param fieldU Tablica składowych U
 * @param fieldV Tablica składowych V
 * @param points Punkty siatki
 * @param searchRadiusPx Maksymalny promień poszukiwania w pikselach (domyślnie 50px)
 * @returns [interpU, interpV] interpolowany wektor prędkości
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

  for (let i = 0; i < points.length; i++) {
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

  if (sumWeight > 0) {
    return [sumU / sumWeight, sumV / sumWeight];
  }

  return [0, 0];
}

/**
 * Całkuje trajektorię linii prądu (wstęgi) metodą Runge-Kutta 2-go rzędu (RK2 Midpoint).
 * Przerywa całkowanie przy napotkaniu zbyt ostrego zakrętu, wyjechaniu poza granice mapy
 * lub gdy prędkość przepływu spadnie poniżej progu ciszy.
 *
 * @param x0 Początkowa współrzędna X
 * @param y0 Początkowa współrzędna Y
 * @param fieldU Składowe U pola wektorowego
 * @param fieldV Składowe V pola wektorowego
 * @param points Punkty siatki
 * @param steps Maksymalna liczba kroków całkowania (domyślnie 6)
 * @param stepSize Długość kroku całkowania w pikselach (domyślnie 8)
 * @param maxAngleDeg Maksymalny dopuszczalny kąt skrętu w stopniach (domyślnie 45°)
 * @param mapBounds Opcjonalne granice [width, height] do zatrzymania na krawędzi mapy
 * @returns Tablica kolejnych punktów [x, y] tworzących gładką wstęgę
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
  const path: [number, number][] = [[x0, y0]];
  let currX = x0;
  let currY = y0;
  let prevAngle: number | null = null;

  const maxAngleRad = (maxAngleDeg * Math.PI) / 180;
  const boundW = mapBounds ? mapBounds[0] : (globalThis as any).graphWidth || 10000;
  const boundH = mapBounds ? mapBounds[1] : (globalThis as any).graphHeight || 10000;

  for (let s = 0; s < steps; s++) {
    // Sprawdź granice mapy
    if (currX < 0 || currX > boundW || currY < 0 || currY > boundH) {
      break;
    }

    // Krok 1 (Euler)
    const [u1, v1] = interpolateVector(currX, currY, fieldU, fieldV, points);
    const speed1 = Math.sqrt(u1 * u1 + v1 * v1);
    if (speed1 < 0.1) break;

    const angle1 = Math.atan2(v1, u1);
    if (prevAngle !== null) {
      let angleDiff = Math.abs(angle1 - prevAngle);
      if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
      if (angleDiff > maxAngleRad) break; // Zbyt gwałtowny zakręt
    }

    // Krok pośredni RK2 (Midpoint)
    const midX = currX + (u1 / speed1) * (stepSize * 0.5);
    const midY = currY + (v1 / speed1) * (stepSize * 0.5);

    if (midX < 0 || midX > boundW || midY < 0 || midY > boundH) {
      break;
    }

    const [u2, v2] = interpolateVector(midX, midY, fieldU, fieldV, points);
    const speed2 = Math.sqrt(u2 * u2 + v2 * v2);
    if (speed2 < 0.1) break;

    // Krok finalny RK2
    currX += (u2 / speed2) * stepSize;
    currY += (v2 / speed2) * stepSize;

    if (currX < 0 || currX > boundW || currY < 0 || currY > boundH) {
      break;
    }

    path.push([currX, currY]);
    prevAngle = Math.atan2(v2, u2);
  }

  return path;
}

/**
 * Wygładza pole skalarne na grafie Voronoi metodą relaksacji Laplacjańskiej.
 *
 * @param field Tablica wartości skalaru (modyfikowana in-place)
 * @param neighbors Tablica sąsiadów dla każdej komórki
 * @param alpha Współczynnik dyfuzji (0.0 = brak zmian, 1.0 = całkowite uśrednienie z sąsiadami)
 * @param passes Liczba kolejnych iteracji wygładzania (domyślnie 1)
 */
export function laplacianSmooth(field: Float32Array, neighbors: number[][], alpha = 0.3, passes = 1): void {
  const n = field.length;
  const temp = new Float32Array(n);

  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < n; i++) {
      const nb = neighbors[i];
      if (!nb || nb.length === 0) {
        temp[i] = field[i];
        continue;
      }

      let sumVal = 0;
      for (let j = 0; j < nb.length; j++) {
        sumVal += field[nb[j]];
      }
      const meanVal = sumVal / nb.length;
      temp[i] = (1 - alpha) * field[i] + alpha * meanVal;
    }
    field.set(temp);
  }
}
