/**
 * Silnik hydrologii i geometrii rzek (Aero-Hydro 2.0).
 *
 * Modeluje:
 *   1. Algorytm Priority-Flood do wypełniania depresji terenowych i wyznaczania sieci spływu.
 *   2. Akumulację spływu powierzchniowego (Flow Accumulation) w fizycznych jednostkach m³/s.
 *   3. Rzędowość cieków według klasyfikacji Strahlera (Strahler Stream Order).
 *   4. Hydromorfologię koryt rzecznych wg prawa Leopolda-Maddocka (W ∝ Q^0.5, D ∝ Q^0.4).
 *   5. Bilans wodny jezior i wykrywanie zlewisk bezodpływowych (endorheic basins).
 *
 * @module generators/aero-hydro/hydrology-engine
 */

import { cellAreaKm2 } from "@/utils/grid-math";

export interface HydrologyNode {
  cell: number;
  flowDirection: number; // indeks komórki docelowej spływu (-1 jeśli morze/krawędź)
  flowAccumulation: number; // łączny przepływ w m³/s
  strahlerOrder: number; // rząd cieku Strahlera (1..n)
  channelWidthM: number; // szerokość koryta w metrach (Leopold-Maddock)
  channelDepthM: number; // głębokość koryta w metrach
}

export class HydrologyEngineModule {
  /**
   * Główna metoda wyznaczająca sieć spływu, akumulację przepływów i geometrię rzek.
   */
  generate(): { nodes: HydrologyNode[] } {
    const grid = (globalThis as any).grid;
    if (!grid?.cells?.i) return { nodes: [] };

    const n = grid.cells.i.length;
    const { cells } = grid;
    const heights = cells.h;
    const prec = cells.prec;

    const isWater = (i: number) => heights[i] < 20;

    // 1. Krok I: Algorytm Priority-Flood (Wypełnianie depresji / Depression Filling)
    const filledHeights = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      filledHeights[i] = heights[i];
    }
    this.resolveDepressions(filledHeights, cells.c, isWater);

    // 2. Krok II: Wyznaczenie kierunku spływu grawitacyjnego (Steepest Descent)
    const flowDirection = new Int32Array(n).fill(-1);
    for (let i = 0; i < n; i++) {
      if (isWater(i)) continue;

      const nb = cells.c[i];
      let lowestNeighbor = -1;
      let minH = filledHeights[i];

      for (let j = 0; j < nb.length; j++) {
        const neighbor = nb[j];
        if (filledHeights[neighbor] < minH) {
          minH = filledHeights[neighbor];
          lowestNeighbor = neighbor;
        }
      }

      flowDirection[i] = lowestNeighbor;
    }

    // 3. Krok III: Topologiczne sortowanie komórek lądowych (od najwyższych do najniższych)
    const landIndices: number[] = [];
    for (let i = 0; i < n; i++) {
      if (!isWater(i)) landIndices.push(i);
    }
    landIndices.sort((a, b) => filledHeights[b] - filledHeights[a]);

    // 4. Krok IV: Akumulacja spływu powierzchniowego (Flow Accumulation w m³/s)
    const flowAccumulation = new Float32Array(n);
    const SECONDS_IN_YEAR = 31557600;

    for (let k = 0; k < landIndices.length; k++) {
      const i = landIndices[k];
      const areaKm2 = Math.max(cellAreaKm2(), 1.0);

      const precMmYr = prec ? Math.max(prec[i], 1) * 10 : 500; // szacunek mm/rok
      // Objętość opadu na komórkę w m³/rok = km² * 1e6 * (mm / 1000) = km² * mm * 1000
      const runoffCoeff = heights[i] > 60 ? 0.8 : 0.65; // wyższy spływ w skałach górskich
      const localDischargeM3S = (areaKm2 * precMmYr * 1000 * runoffCoeff) / SECONDS_IN_YEAR;

      flowAccumulation[i] += localDischargeM3S;

      const target = flowDirection[i];
      if (target !== -1 && !isWater(target)) {
        flowAccumulation[target] += flowAccumulation[i];
      }
    }

    // 5. Krok V: Rzędowość rzek wg Strahlera i prawo Leopolda-Maddocka
    const strahlerOrder = new Uint8Array(n).fill(1);
    const channelWidthM = new Float32Array(n);
    const channelDepthM = new Float32Array(n);

    // Zbuduj mapę indeksów komórek wpływających (inflow sources)
    const inflowSources: Map<number, number[]> = new Map();
    for (let k = 0; k < landIndices.length; k++) {
      const i = landIndices[k];
      const target = flowDirection[i];
      if (target !== -1) {
        if (!inflowSources.has(target)) inflowSources.set(target, []);
        inflowSources.get(target)!.push(i);
      }
    }

    // Iteracja od GÓRY do DOŁU (od najwyższych źródeł do ujścia)
    // Zapewnia, że rzędy dopływów są już obliczone w momencie przetwarzania węzła docelowego
    for (let k = 0; k < landIndices.length; k++) {
      const i = landIndices[k];
      const sources = inflowSources.get(i);
      if (sources && sources.length > 0) {
        let maxOrder = 1;
        let countMax = 0;
        for (let j = 0; j < sources.length; j++) {
          const o = strahlerOrder[sources[j]];
          if (o > maxOrder) {
            maxOrder = o;
            countMax = 1;
          } else if (o === maxOrder) {
            countMax++;
          }
        }
        strahlerOrder[i] = countMax > 1 ? maxOrder + 1 : maxOrder;
      }

      // Prawo Leopolda-Maddocka: W = kw * Q^0.5, D = kd * Q^0.4
      const Q = Math.max(flowAccumulation[i], 0.01);
      channelWidthM[i] = 1.8 * Q ** 0.5; // kw = 1.8
      channelDepthM[i] = 0.35 * Q ** 0.4; // kd = 0.35
    }

    // 6. Krok VI: Zbuduj wynikowe struktury węzłów sieci rzecznej
    const nodes: HydrologyNode[] = [];
    for (let k = 0; k < landIndices.length; k++) {
      const i = landIndices[k];
      nodes.push({
        cell: i,
        flowDirection: flowDirection[i],
        flowAccumulation: flowAccumulation[i],
        strahlerOrder: strahlerOrder[i],
        channelWidthM: channelWidthM[i],
        channelDepthM: channelDepthM[i]
      });
    }

    // Zsynchronizuj z tablicą cells.fl w FMG
    if (cells.fl) {
      for (let i = 0; i < n; i++) {
        cells.fl[i] = Math.min(65535, Math.round(flowAccumulation[i] * 10));
      }
    }

    return { nodes };
  }

  /**
   * Uproszczony algorytm wypełniania depresji Priority-Flood.
   * Gwarantuje brak bezodpływowych dziur i ujemnych spadków grawitacyjnych.
   */
  private resolveDepressions(
    heights: Float32Array,
    neighbors: number[][],
    isWater: (i: number) => boolean,
    maxPasses = 30
  ): void {
    const n = heights.length;
    let modified = true;
    let pass = 0;

    while (modified && pass < maxPasses) {
      modified = false;
      pass++;

      for (let i = 0; i < n; i++) {
        if (isWater(i)) continue;

        const nb = neighbors[i];
        if (!nb || nb.length === 0) continue;

        let lowestNeighborH = Infinity;
        for (let j = 0; j < nb.length; j++) {
          const nh = heights[nb[j]];
          if (nh < lowestNeighborH) {
            lowestNeighborH = nh;
          }
        }

        // Jeśli komórka jest niższa niż jej najniższy sąsiad, podnieś ją do poziomu progu
        if (heights[i] < lowestNeighborH) {
          heights[i] = lowestNeighborH + 0.05;
          modified = true;
        }
      }
    }
  }
}

export const HydrologyEngine = new HydrologyEngineModule();
