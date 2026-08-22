/**
 * Renderer wstęg i strzałek przepływu (Aero-Hydro 2.0).
 *
 * Odpowiada za:
 *   1. Agregację wektorów prędkości w gładkie wstęgi (4–8 komórek, zakrzywienie Δθ < 45°).
 *   2. Dynamiczny LOD z zachowaniem separacji (odstęp 2–3 kratek między sąsiednimi wstęgami).
 *   3. Generowanie ścieżek SVG z grotami strzałek i gradientem prędkości.
 *
 * @module renderers/aero-hydro/streamline-renderer
 */

import { findClosestCellFast, getOrCreateSpatialGrid, traceStreamline } from "@/utils/grid-math";

export interface StreamlineFeature {
  id: number;
  type: "wind" | "ocean";
  points: [number, number][]; // seria punktów [x, y] wzdłuż wstęgi
  avgSpeed: number; // średnia prędkość wzdłuż wstęgi [m/s]
  svgPath: string; // ścieżka d="M ... C ..." do renderowania SVG
  arrowHead?: { x: number; y: number; angleRad: number };
}

export interface StreamlineConfig {
  minSegmentLength: number; // min liczba komórek w wstędze (domyślnie 4)
  maxSegmentLength: number; // max liczba komórek w wstędze (domyślnie 8)
  separationDistancePx: number; // odstęp w px między wstęgami (~2-3 komórki)
  minSpeedThreshold: number; // min prędkość, by utworzyć wstęgę [m/s]
  maxAngleTurnDeg: number; // max dopuszczalny skręt między krokami (domyślnie 45°)
  stepSizePx: number; // krok całkowania RK2 w px
}

export const DEFAULT_STREAMLINE_CONFIG: StreamlineConfig = {
  minSegmentLength: 4,
  maxSegmentLength: 8,
  separationDistancePx: 75, // ~2.5 komórki przy typowym spacingu 30px
  minSpeedThreshold: 0.1,
  maxAngleTurnDeg: 45,
  stepSizePx: 25
};

export class StreamlineRendererModule {
  /**
   * Generuje zbiór agregowanych wstęg wiatru lub prądów morskich.
   *
   * @param type Typ przepływu: "wind" lub "ocean"
   * @param customConfig Niestandardowa konfiguracja wstęg
   * @returns Lista wygenerowanych wstęg
   */
  generateStreamlines(type: "wind" | "ocean" = "wind", customConfig?: Partial<StreamlineConfig>): StreamlineFeature[] {
    const grid = (globalThis as any).grid;
    if (!grid?.cells?.i) return [];

    const config: StreamlineConfig = {
      ...DEFAULT_STREAMLINE_CONFIG,
      ...(customConfig || {})
    };

    const n = grid.cells.i.length;
    const { cells, points } = grid;
    const graphWidth = (globalThis as any).graphWidth ?? 1000;
    const graphHeight = (globalThis as any).graphHeight ?? 1000;

    const uField: Float32Array = type === "wind" ? cells.windU : cells.oceanU;
    const vField: Float32Array = type === "wind" ? cells.windV : cells.oceanV;

    if (!uField || !vField) return [];

    const features: StreamlineFeature[] = [];
    const usedCells = new Uint8Array(n); // flaga oznaczająca komórki pokryte lub w strefie buforowej

    // Wyznacz komórki kandydujące posortowane wg prędkości przepływu
    const candidates: { index: number; speed: number }[] = [];
    for (let i = 0; i < n; i++) {
      if (type === "ocean" && cells.h[i] >= 20) continue; // tylko woda dla oceanu

      const u = uField[i];
      const v = vField[i];
      const speed = Math.hypot(u, v);
      if (speed >= config.minSpeedThreshold) {
        candidates.push({ index: i, speed });
      }
    }

    // Sortuj malejąco wg prędkości, by główne strugi miały pierwszeństwo
    candidates.sort((a, b) => b.speed - a.speed);

    let featureId = 1;
    const sepSq = config.separationDistancePx * config.separationDistancePx;

    for (let c = 0; c < candidates.length; c++) {
      const startCell = candidates[c].index;
      if (usedCells[startCell]) continue;

      const [startX, startY] = points[startCell];

      // Wyznacz linię prądu za pomocą metody Runge-Kutty 2. rzędu
      // Sygnatura: traceStreamline(x0, y0, fieldU, fieldV, points, steps, stepSize, maxAngleDeg, mapBounds)
      const rawPoints = traceStreamline(
        startX,
        startY,
        uField,
        vField,
        points,
        config.maxSegmentLength,
        config.stepSizePx,
        config.maxAngleTurnDeg,
        [graphWidth, graphHeight]
      );

      if (rawPoints.length < config.minSegmentLength) continue;

      // Sprawdź separację od istniejących wstęg
      let tooClose = false;
      for (let f = 0; f < features.length; f++) {
        const existing = features[f].points;
        for (let p = 0; p < rawPoints.length; p++) {
          const [rx, ry] = rawPoints[p];
          for (let ep = 0; ep < existing.length; ep++) {
            const [ex, ey] = existing[ep];
            const distSq = (rx - ex) * (rx - ex) + (ry - ey) * (ry - ey);
            if (distSq < sepSq) {
              tooClose = true;
              break;
            }
          }
          if (tooClose) break;
        }
        if (tooClose) break;
      }

      if (tooClose) {
        usedCells[startCell] = 1;
        continue;
      }

      // Oznacz komórki w pobliżu jako zużyte (strefa buforowa 2-3 kratek)
      this.markBufferZone(rawPoints, points, usedCells, config.separationDistancePx);

      // Oblicz średnią prędkość wzdłuż wstęgi
      let totalSpeed = 0;
      for (let p = 0; p < rawPoints.length; p++) {
        const [px, py] = rawPoints[p];
        const closest = this.findClosestCell(px, py, points, startCell, cells.c);
        totalSpeed += Math.hypot(uField[closest] || 0, vField[closest] || 0);
      }
      const avgSpeed = totalSpeed / rawPoints.length;

      // Zbuduj gładką ścieżkę SVG (Catmull-Rom / Bezier)
      const svgPath = this.buildSmoothSvgPath(rawPoints);

      // Oblicz kąt i pozycję grota strzałki na końcu wstęgi
      const last = rawPoints[rawPoints.length - 1];
      const prev = rawPoints[rawPoints.length - 2];
      const arrowAngle = Math.atan2(last[1] - prev[1], last[0] - prev[0]);

      features.push({
        id: featureId++,
        type,
        points: rawPoints,
        avgSpeed,
        svgPath,
        arrowHead: {
          x: last[0],
          y: last[1],
          angleRad: arrowAngle
        }
      });
    }

    return features;
  }

  /**
   * Buduje gładką ścieżkę SVG z serii punktów za pomocą krzywych sześciennych Beziera.
   */
  private buildSmoothSvgPath(pts: [number, number][]): string {
    if (pts.length < 2) return "";
    if (pts.length === 2) {
      return `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)} L ${pts[1][0].toFixed(1)} ${pts[1][1].toFixed(1)}`;
    }

    let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i === 0 ? i : i - 1];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2 < pts.length ? i + 2 : i + 1];

      // Punkty kontrolne Catmull-Rom do Beziera
      const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
      const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
      const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
      const cp2y = p2[1] - (p3[1] - p1[1]) / 6;

      d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
    }

    return d;
  }

  /**
   * Oznacza komórki w promieniu buforowym jako zajęte w czasie O(1).
   */
  private markBufferZone(
    streamlinePts: [number, number][],
    allPoints: [number, number][],
    usedCells: Uint8Array,
    radiusPx: number
  ): void {
    const rSq = radiusPx * radiusPx;
    const sGrid = getOrCreateSpatialGrid(allPoints, Math.max(radiusPx, 40));
    const { cellSize, cols, rows, buckets } = sGrid;

    for (let p = 0; p < streamlinePts.length; p++) {
      const [sx, sy] = streamlinePts[p];
      const centerCol = Math.floor(sx / cellSize);
      const centerRow = Math.floor(sy / cellSize);

      const minR = Math.max(0, centerRow - 1);
      const maxR = Math.min(rows - 1, centerRow + 1);
      const minC = Math.max(0, centerCol - 1);
      const maxC = Math.min(cols - 1, centerCol + 1);

      for (let r = minR; r <= maxR; r++) {
        for (let c = minC; c <= maxC; c++) {
          const bucket = buckets[r * cols + c];
          for (let k = 0; k < bucket.length; k++) {
            const i = bucket[k];
            if (usedCells[i]) continue;
            const [cx, cy] = allPoints[i];
            const distSq = (sx - cx) * (sx - cx) + (sy - cy) * (sy - cy);
            if (distSq <= rSq) {
              usedCells[i] = 1;
            }
          }
        }
      }
    }
  }

  /**
   * Znajduje najbliższą komórkę siatki w czasie O(1).
   */
  private findClosestCell(
    x: number,
    y: number,
    points: [number, number][],
    _hintIdx?: number,
    _neighbors?: number[][]
  ): number {
    return findClosestCellFast(x, y, points);
  }
}

export const StreamlineRenderer = new StreamlineRendererModule();
