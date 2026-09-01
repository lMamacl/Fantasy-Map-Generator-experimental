/**
 * Silnik cyrkulacji oceanicznej i anomalii SST (Aero-Hydro 2.0).
 *
 * Modeluje wieloletnie, średnioroczne prądy morskie napędzane wiatrem (wind-driven
 * gyres, transport Ekmana, wzmocnienie prądów zachodnich krawędzi) oraz oblicza
 * anomalię temperatury powierzchni morza (SST Anomaly) wywołaną transportem ciepła.
 *
 * Nowe w v2: SST wpływa na temperaturę brzegowych komórek lądowych (efekt Golfsztromu).
 *
 * @module generators/aero-hydro/ocean-engine
 */

import { defaultOceanCurrentsConfig, type OceanCurrentsConfig } from "@/types/aero-hydro";
import { gridCellsToKm, projectTangentToCoast } from "@/utils/grid-math";

/** Współczynnik przeliczenia południkowej prędkości prądu na anomalię SST [°C/(m/s)] */
const SST_MERIDIONAL_FACTOR = 12.0;
/** Maksymalna anomalia SST w realistycznym zakresie [°C] */
const SST_MAX_ANOMALY = 8.0;
/** Zasięg wpływu SST na temperaturę lądową [km] */
const SST_LAND_DECAY_KM = 150;
/** Maksymalny wpływ SST na temperaturę lądową [°C] */
const SST_LAND_MAX_INFLUENCE = 5.0;

export class OceanEngineModule {
  /**
   * Główna metoda generująca wektory prądów morskich i pole anomalii SST.
   */
  generate(customConfig?: Partial<OceanCurrentsConfig>): void {
    const grid = (globalThis as any).grid;
    if (!grid?.cells?.i) return;

    const mapCoordinates = (globalThis as any).mapCoordinates || {
      latN: 60,
      latS: -60,
      latT: 120,
      lonW: -90,
      lonE: 90,
      lonT: 180
    };
    const options = (globalThis as any).options || {};
    const config: OceanCurrentsConfig = {
      ...defaultOceanCurrentsConfig(),
      ...(options.oceanCurrents || {}),
      ...(customConfig || {})
    };

    const n = grid.cells.i.length;
    const { cells, points } = grid;
    const graphHeight = (globalThis as any).graphHeight ?? 1000;
    const graphWidth = (globalThis as any).graphWidth ?? 1000;
    const spacing = grid.spacing ?? 10;
    const kmPerCell = Math.max(gridCellsToKm(1), 0.1);

    // 1. Alokacja TypedArrays
    if (!cells.oceanU || cells.oceanU.length !== n) {
      cells.oceanU = new Float32Array(n);
      cells.oceanV = new Float32Array(n);
      cells.sstAnomaly = new Float32Array(n);
    }

    const { oceanU, oceanV, sstAnomaly, windU, windV } = cells;
    const isWater = (i: number) => cells.h[i] < 20;

    const ekmanRad = (config.ekmanAngle * Math.PI) / 180;

    // 2. Naprężenie wiatrowe z odchyleniem Ekmana
    for (let i = 0; i < n; i++) {
      if (!isWater(i)) {
        oceanU[i] = 0;
        oceanV[i] = 0;
        sstAnomaly[i] = 0;
        continue;
      }

      const [, y] = points[i];
      const lat = mapCoordinates.latN - (y / graphHeight) * mapCoordinates.latT;
      const fSign = lat >= 0 ? 1 : -1;

      const wU = windU ? windU[i] : 0;
      const wV = windV ? windV[i] : 0;
      const wSpeed = Math.sqrt(wU * wU + wV * wV);

      if (wSpeed < 0.01) {
        oceanU[i] = 0;
        oceanV[i] = 0;
        continue;
      }

      const rotAngle = -fSign * ekmanRad;
      const cosE = Math.cos(rotAngle);
      const sinE = Math.sin(rotAngle);

      let uRaw = (wU * cosE - wV * sinE) * config.windStressFactor;
      let vRaw = (wU * sinE + wV * cosE) * config.windStressFactor;

      // 3. Western Intensification — analiza pozycji w basenie oceanicznym
      const [x] = points[i];
      const westBoost = this.calculateWesternIntensification(
        x,
        cells.c[i],
        cells.h,
        points,
        graphWidth,
        config.westernIntensification
      );

      uRaw *= westBoost;
      vRaw *= westBoost;

      oceanU[i] = uRaw;
      oceanV[i] = vRaw;
    }

    // 4. Warunki brzegowe (rzutowanie styczne V · n = 0)
    for (let i = 0; i < n; i++) {
      if (!isWater(i)) continue;
      if (cells.t && cells.t[i] < 0) {
        const [tangU, tangV] = projectTangentToCoast(oceanU[i], oceanV[i], i, cells.t, points, cells.c);
        oceanU[i] = tangU;
        oceanV[i] = tangV;
      }
    }

    // 5. Wygładzanie ciągłości przepływu (barrier-aware)
    this.barrierAwareSmooth(oceanU, cells.c, cells.h, 0.2, 1);
    this.barrierAwareSmooth(oceanV, cells.c, cells.h, 0.2, 1);

    // Ponowne zabezpieczenie brzegowe
    for (let i = 0; i < n; i++) {
      if (!isWater(i)) {
        oceanU[i] = 0;
        oceanV[i] = 0;
        continue;
      }
      if (cells.t && cells.t[i] < 0) {
        const [tangU, tangV] = projectTangentToCoast(oceanU[i], oceanV[i], i, cells.t, points, cells.c);
        oceanU[i] = tangU;
        oceanV[i] = tangV;
      }
    }

    // 6. Anomalia SST z transportu ciepła
    for (let i = 0; i < n; i++) {
      if (!isWater(i)) {
        sstAnomaly[i] = 0;
        continue;
      }

      const [, y] = points[i];
      const lat = mapCoordinates.latN - (y / graphHeight) * mapCoordinates.latT;
      const v = oceanV[i];
      const u = oceanU[i];
      const speed = Math.sqrt(u * u + v * v);

      if (speed < 0.01) {
        sstAnomaly[i] = 0;
        continue;
      }

      // Prąd od równika = ciepło, od bieguna = chłód
      let meridionalHeating = 0;
      if (lat >= 0) {
        meridionalHeating = -v * SST_MERIDIONAL_FACTOR;
      } else {
        meridionalHeating = v * SST_MERIDIONAL_FACTOR;
      }

      sstAnomaly[i] = Math.max(-SST_MAX_ANOMALY, Math.min(SST_MAX_ANOMALY, meridionalHeating));
    }

    // Wygładzenie anomalii SST
    this.barrierAwareSmooth(sstAnomaly, cells.c, cells.h, 0.3, 2);

    // 7. NOWE: SST wpływa na temperaturę brzegowych komórek lądowych
    this.propagateSstToLand(cells, points, spacing, kmPerCell);
  }

  /**
   * Analiza pozycji komórki w basenie oceanicznym:
   * Western Intensification bazowane na tym, czy komórka jest na zachodniej
   * krawędzi ciągłego akwenu (nie tylko "sąsiad z zachodu jest lądem").
   */
  private calculateWesternIntensification(
    x: number,
    neighbors: number[],
    heights: Uint8Array,
    points: [number, number][],
    graphWidth: number,
    maxBoost: number
  ): number {
    if (!neighbors || neighbors.length === 0) return 1.0;

    // Policz sąsiadów lądowych po zachodniej stronie
    let westLandCount = 0;
    let totalWest = 0;
    for (let j = 0; j < neighbors.length; j++) {
      const nx = points[neighbors[j]][0];
      if (nx < x) {
        totalWest++;
        if (heights[neighbors[j]] >= 20) westLandCount++;
      }
    }

    // Pozycja relatywna na mapie — im bardziej na zachód, tym silniejszy efekt
    const relX = x / graphWidth;
    const positionFactor = Math.max(0, 1 - relX * 2); // 1 na lewym brzegu, 0 w środku

    // Łączenie: bezpośredni ląd na zachód + pozycja w basenie
    const directLandFactor = totalWest > 0 ? westLandCount / totalWest : 0;
    const combinedFactor = Math.max(directLandFactor, positionFactor * 0.5);

    return 1.0 + (maxBoost - 1.0) * combinedFactor;
  }

  /**
   * Propaguje anomalię SST na komórki lądowe.
   * Efekt Golfsztromu: ciepły/chłodny prąd morski przenosi anomalię termiczną w głąb lądu
   * wzdłuż wektorów wiatru na odległość 800–1200 km.
   */
  private propagateSstToLand(cells: any, points: [number, number][], spacing: number, kmPerCell: number): void {
    const n = cells.h.length;
    if (!cells.sstAnomaly) return;

    if (!cells.sstLandInfluence || cells.sstLandInfluence.length !== n) {
      cells.sstLandInfluence = new Float32Array(n);
    }
    const influence = cells.sstLandInfluence;
    influence.fill(0);

    const { windU, windV, c: neighbors, h: heights } = cells;

    // Krok 1: Bezpośredni transfer z komórek morskich na przyległe komórki lądowe
    for (let i = 0; i < n; i++) {
      if (heights[i] < 20) continue; // pomiń ocean

      const nb = neighbors[i];
      if (!nb || nb.length === 0) continue;

      let sstSum = 0;
      let sstCount = 0;
      for (let j = 0; j < nb.length; j++) {
        const neighbor = nb[j];
        if (heights[neighbor] < 20 && cells.sstAnomaly[neighbor] !== 0) {
          sstSum += cells.sstAnomaly[neighbor];
          sstCount++;
        }
      }

      if (sstCount > 0) {
        const avgSst = sstSum / sstCount;
        influence[i] = Math.max(-SST_LAND_MAX_INFLUENCE, Math.min(SST_LAND_MAX_INFLUENCE, avgSst * 0.85));
      }
    }

    // Krok 2: Wielokrokowa adwekcja termiczna w głąb lądu pod wpływem wiatru (4 przejścia adwekcyjno-dyfuzyjne)
    const tempInf = new Float32Array(n);
    for (let pass = 0; pass < 4; pass++) {
      for (let i = 0; i < n; i++) {
        if (heights[i] < 20) {
          tempInf[i] = 0;
          continue;
        }
        const nb = neighbors[i];
        if (!nb || nb.length === 0) {
          tempInf[i] = influence[i];
          continue;
        }

        const [xi, yi] = points[i];
        const wu = windU ? windU[i] : 0;
        const wv = windV ? windV[i] : 0;
        const wSpeed = Math.hypot(wu, wv) || 1.0;

        let fluxSum = 0;
        let weightSum = 0;

        for (let j = 0; j < nb.length; j++) {
          const neighbor = nb[j];
          if (influence[neighbor] !== 0) {
            const [xj, yj] = points[neighbor];
            const dx = xi - xj; // wektor OD sąsiada DO komórki i
            const dy = yi - yj;
            const dist = Math.hypot(dx, dy) || 1.0;
            const dirX = dx / dist;
            const dirY = dy / dist;

            // Zgodność z wektorem wiatru
            const alignment = (wu * dirX + wv * dirY) / wSpeed; // [-1, 1]
            const weight = Math.max(0.1, 0.5 + 0.5 * alignment);
            const distKm = (dist / spacing) * kmPerCell;
            const decay = Math.exp(-distKm / (SST_LAND_DECAY_KM * 2.5)); // ~375 km e-folding

            fluxSum += influence[neighbor] * decay * weight;
            weightSum += weight;
          }
        }

        if (weightSum > 0) {
          const advected = fluxSum / weightSum;
          // Zachowaj bezpośredni wpływ na wybrzeżu, rozszerz w głąb lądu
          tempInf[i] = Math.max(-SST_LAND_MAX_INFLUENCE, Math.min(SST_LAND_MAX_INFLUENCE, influence[i] * 0.5 + advected * 0.5));
        } else {
          tempInf[i] = influence[i];
        }
      }
      influence.set(tempInf);
    }
  }

  /**
   * Wygładzanie Laplacjańskie barrier-aware (morze z morzem).
   */
  private barrierAwareSmooth(
    field: Float32Array,
    neighbors: number[][],
    heights: Uint8Array,
    alpha = 0.25,
    passes = 1
  ): void {
    const n = field.length;
    const temp = new Float32Array(n);

    for (let p = 0; p < passes; p++) {
      for (let i = 0; i < n; i++) {
        if (heights[i] >= 20) {
          temp[i] = field[i];
          continue;
        }
        const nb = neighbors[i];
        if (!nb || nb.length === 0) {
          temp[i] = field[i];
          continue;
        }

        let sumVal = 0;
        let waterCount = 0;
        for (let j = 0; j < nb.length; j++) {
          if (heights[nb[j]] < 20) {
            sumVal += field[nb[j]];
            waterCount++;
          }
        }

        temp[i] = waterCount > 0 ? (1 - alpha) * field[i] + alpha * (sumVal / waterCount) : field[i];
      }
      field.set(temp);
    }
  }
}

export const OceanEngine = new OceanEngineModule();
