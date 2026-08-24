/**
 * Renderer wstęg i strzałek przepływu (Aero-Hydro 2.0).
 *
 * Zasady:
 *   1. Maksymalnie 1 linia wiatru na komórkę.
 *   2. Ścisła separacja topologiczna 2–3 komórek Voronoi między wstęgami (strefa wykluczenia).
 *   3. Gładki skręt (kąt skrętu < 35° między segmentami, brak ostrych załamań).
 *   4. Dla oceanu: wielonitkowe wstęgi z zatrzymaniem przed brzegiem lądu.
 *
 * @module renderers/aero-hydro/streamline-renderer
 */

import { findClosestCellFast } from "@/utils/grid-math";

export interface StreamlineFeature {
  id: number;
  type: "wind" | "ocean";
  points: [number, number][];
  avgSpeed: number;
  svgPath: string;
  arrowHead?: [number, number];
}

export class StreamlineRendererModule {
  /**
   * Oznacza komórkę oraz jej sąsiadów w promieniu topologicznym (hops) jako zajęte.
   */
  private markExclusionZone(cellIdx: number, neighbors: number[][], usedCells: Uint8Array, depth = 2): void {
    usedCells[cellIdx] = 1;
    if (depth <= 0) return;

    const queue: [number, number][] = [[cellIdx, 0]];
    while (queue.length > 0) {
      const [cur, d] = queue.shift()!;
      if (d >= depth) continue;

      const nb = neighbors[cur];
      if (!nb) continue;

      for (let i = 0; i < nb.length; i++) {
        const next = nb[i];
        if (!usedCells[next]) {
          usedCells[next] = 1;
          queue.push([next, d + 1]);
        }
      }
    }
  }

  /**
   * Generuje zoptymalizowane wstęgi wiatru lub prądów oceanicznych z zachowaniem
   * reguły 1 wiatr na komórkę i separacji 2–3 komórek.
   */
  generateStreamlines(type: "wind" | "ocean"): StreamlineFeature[] {
    const grid = (globalThis as any).grid;
    if (!grid?.cells?.i) return [];

    const { cells, points } = grid;
    const n = cells.i.length;
    const graphWidth = (globalThis as any).graphWidth || 1000;
    const graphHeight = (globalThis as any).graphHeight || 1000;

    const uField: Float32Array = type === "wind" ? cells.windU : cells.oceanU;
    const vField: Float32Array = type === "wind" ? cells.windV : cells.oceanV;

    if (!uField || !vField) return [];

    const features: StreamlineFeature[] = [];
    const usedCells = new Uint8Array(n);
    const neighbors: number[][] = cells.c || [];

    if (type === "wind") {
      // 1. Zbieramy kandydatów posortowanych malejąco wg prędkości
      const candidates: { index: number; speed: number }[] = [];
      for (let i = 0; i < n; i++) {
        const u = uField[i] || 0;
        const v = vField[i] || 0;
        const speed = Math.hypot(u, v);
        if (speed >= 1.2) {
          candidates.push({ index: i, speed });
        }
      }
      candidates.sort((a, b) => b.speed - a.speed);

      let featureId = 1;

      for (let c = 0; c < candidates.length; c++) {
        const startCell = candidates[c].index;
        if (usedCells[startCell]) continue;

        let [x, y] = points[startCell];
        const pathPoints: [number, number][] = [[x, y]];
        let d = `M ${x.toFixed(1)} ${y.toFixed(1)}`;
        let totalSpeed = 0;
        let validSteps = 0;
        let prevDx = 0;
        let prevDy = 0;

        // Oznacz komórkę startową i jej sąsiedztwo 3 komórek
        this.markExclusionZone(startCell, neighbors, usedCells, 3);

        // Śledź wstęgę wiatru przez 6–10 kroków (elegancka, wyrazista długość)
        for (let step = 0; step < 10; step++) {
          const cellIdx = findClosestCellFast(x, y, points);
          const u = uField[cellIdx] || 0;
          const v = vField[cellIdx] || 0;
          const speed = Math.hypot(u, v);

          if (speed < 0.8) break;

          totalSpeed += speed;
          validSteps++;

          // Oznacz bieżącą komórkę i sąsiedztwo (separacja 3 komórek)
          this.markExclusionZone(cellIdx, neighbors, usedCells, 3);

          let dx = (u / (speed + 0.6)) * 22;
          let dy = (v / (speed + 0.6)) * 22;

          // Gładki skręt (ograniczenie zmiany kąta do 35°)
          if (step > 0) {
            const curAngle = Math.atan2(dy, dx);
            const prevAngle = Math.atan2(prevDy, prevDx);
            let diff = curAngle - prevAngle;
            while (diff > Math.PI) diff -= 2 * Math.PI;
            while (diff < -Math.PI) diff += 2 * Math.PI;
            const maxTurn = (35 * Math.PI) / 180;
            if (Math.abs(diff) > maxTurn) {
              const clampedAngle = prevAngle + Math.sign(diff) * maxTurn;
              const len = Math.hypot(dx, dy);
              dx = Math.cos(clampedAngle) * len;
              dy = Math.sin(clampedAngle) * len;
            }
          }
          prevDx = dx;
          prevDy = dy;

          x += dx;
          y += dy;

          if (x < 10 || x > graphWidth - 10 || y < 10 || y > graphHeight - 10) break;

          pathPoints.push([x, y]);
          d += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
        }

        if (pathPoints.length >= 4) {
          features.push({
            id: featureId++,
            type: "wind",
            points: pathPoints,
            avgSpeed: validSteps > 0 ? totalSpeed / validSteps : 5.0,
            svgPath: d,
            arrowHead: pathPoints[pathPoints.length - 1]
          });
        }
      }
    } else {
      // 2. Prądy morskie (ściśle na oceanie: cells.h[i] < 20, z zatrzymaniem na lądzie)
      const oceanCandidates: { index: number; speed: number }[] = [];
      for (let i = 0; i < n; i++) {
        if (cells.h[i] < 20) {
          const spd = Math.hypot(uField[i] || 0, vField[i] || 0);
          if (spd > 1.2) {
            oceanCandidates.push({ index: i, speed: spd });
          }
        }
      }
      oceanCandidates.sort((a, b) => b.speed - a.speed);

      let featureId = 1;

      for (let c = 0; c < oceanCandidates.length; c++) {
        const startCell = oceanCandidates[c].index;
        if (usedCells[startCell]) continue;

        let [x, y] = points[startCell];
        const pathPoints: [number, number][] = [[x, y]];
        let d = `M ${x.toFixed(1)} ${y.toFixed(1)}`;
        let totalSpeed = 0;
        let validSteps = 0;
        let prevDx = 0;
        let prevDy = 0;

        this.markExclusionZone(startCell, neighbors, usedCells, 2);

        for (let step = 0; step < 12; step++) {
          const cellIdx = findClosestCellFast(x, y, points);
          const isLand = cells.h[cellIdx] >= 20;
          const u = uField[cellIdx] || 0;
          const v = vField[cellIdx] || 0;
          const speed = Math.hypot(u, v);

          if (isLand || speed < 0.4) break; // Twarde zatrzymanie przed lądem

          totalSpeed += speed;
          validSteps++;

          this.markExclusionZone(cellIdx, neighbors, usedCells, 2);

          let dx = (u / (speed + 0.5)) * 24;
          let dy = (v / (speed + 0.5)) * 24;

          if (step > 0) {
            const curAngle = Math.atan2(dy, dx);
            const prevAngle = Math.atan2(prevDy, prevDx);
            let diff = curAngle - prevAngle;
            while (diff > Math.PI) diff -= 2 * Math.PI;
            while (diff < -Math.PI) diff += 2 * Math.PI;
            const maxTurn = (35 * Math.PI) / 180;
            if (Math.abs(diff) > maxTurn) {
              const clampedAngle = prevAngle + Math.sign(diff) * maxTurn;
              const len = Math.hypot(dx, dy);
              dx = Math.cos(clampedAngle) * len;
              dy = Math.sin(clampedAngle) * len;
            }
          }
          prevDx = dx;
          prevDy = dy;

          x += dx;
          y += dy;

          if (x < 10 || x > graphWidth - 10 || y < 10 || y > graphHeight - 10) break;

          pathPoints.push([x, y]);
          d += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
        }

        if (pathPoints.length >= 4) {
          features.push({
            id: featureId++,
            type: "ocean",
            points: pathPoints,
            avgSpeed: validSteps > 0 ? totalSpeed / validSteps : 3.0,
            svgPath: d,
            arrowHead: pathPoints[pathPoints.length - 1]
          });
        }
      }
    }

    return features;
  }
}

export const StreamlineRenderer = new StreamlineRendererModule();
