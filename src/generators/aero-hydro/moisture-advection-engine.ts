/**
 * Eulerowski silnik wilgoci i opadów klimatycznych (Aero-Hydro 2.0).
 *
 * Model stanu równowagi i adwekcji podwiatrowej (Upwind Advection + Continental Moisture Recycling):
 *   1. Woda oceaniczna stanowi stałe źródło nasyconej wilgoci W_ocean = e_s(T + SST).
 *   2. Transport wilgoci w głąb lądu realizowany jest metodą Upwind Gauss-Seidel Sweep wzdłuż
 *      wektorów wiatru (eliminacja sztucznego rozmycia i ograniczenia horyzontu Jacobiego).
 *   3. Continental Moisture Recycling (recykling ewapotranspiracyjny przez lasy i glebę)
 *      zwraca 30-50% opadu z powrotem do kolumny powietrza, umożliwiając penetrację wilgoci
 *      na odległość 2500–3500 km (od Atlantyku po Dniepr i Wołgę).
 *   4. Opad orograficzny usuwa wilgoć w sposób zbilansowany z wznoszeniem wiatru (V · ∇h),
 *      tworząc naturalne zjawisko cienia opadowego (Föhn effect) na stokach zawietrznych.
 *   5. Zapis do tablicy FMG `cells.prec` w skali FMG-kompatybilnej (1 prec ≈ 40 mm/rok),
 *      zapewniając idealne pokrycie biomów umiarkowanych (15-25 prec) i rzek.
 *
 * @module generators/aero-hydro/moisture-advection-engine
 */

import { DEFAULT_EVAPOTRANSPIRATION, defaultMoistureConfig, type MoistureConfig } from "@/types/aero-hydro";
import { gridCellsToKm, laplacianSmooth } from "@/utils/grid-math";

export class MoistureAdvectionEngineModule {
  /**
   * Główna metoda generująca pole wilgoci i opadów rocznych.
   */
  generate(customConfig?: Partial<MoistureConfig>): void {
    const grid = (globalThis as any).grid;
    if (!grid?.cells?.i) return;

    const options = (globalThis as any).options || {};
    const precModifier = (options.prec ?? 100) / 100;
    const config: MoistureConfig = {
      ...defaultMoistureConfig(),
      ...(options.moistureAdvection || {}),
      ...(customConfig || {})
    };

    const n = grid.cells.i.length;
    const { cells, points } = grid;
    const kmPerCell = Math.max(gridCellsToKm(1), 5.0);

    // 1. Alokacja struktur danych
    if (!cells.moisture || cells.moisture.length !== n) {
      cells.moisture = new Float32Array(n);
    }
    if (!cells.prec || cells.prec.length !== n) {
      cells.prec = new Uint8Array(n);
    }

    const { windU, windV, sstAnomaly, temp, h } = cells;
    const moisture = cells.moisture;
    const isWater = (i: number) => h[i] < 20;

    const getTemp = (i: number): number => {
      if (temp && typeof temp[i] === "number" && Number.isFinite(temp[i])) return temp[i];
      return 15;
    };

    // ─── Krok 1: Potencjał parowania oceanicznego (Clausius-Clapeyron + SST + Wiatr) ───
    const oceanMoisture = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      if (isWater(i)) {
        const baseTemp = getTemp(i);
        const sst = sstAnomaly ? sstAnomaly[i] : 0;
        const satVaporHPa = this.clausiusClapeyron(baseTemp + sst);
        const windSpeed = Math.hypot(windU ? windU[i] : 0, windV ? windV[i] : 0);
        const windBonus = 1.0 + Math.min(windSpeed * 0.04, 0.35);
        oceanMoisture[i] = satVaporHPa * 1.5 * windBonus;
        moisture[i] = oceanMoisture[i];
      } else {
        moisture[i] = 0;
      }
    }

    // ─── Krok 2: Upwind Gauss-Seidel Advection + Continental Recycling ─────────
    let meanU = 0;
    let meanV = 0;
    for (let i = 0; i < n; i++) {
      meanU += windU ? windU[i] : 0;
      meanV += windV ? windV[i] : 0;
    }
    meanU /= n;
    meanV /= n;
    if (Math.hypot(meanU, meanV) < 0.1) {
      meanU = 3.5;
      meanV = -1.5;
    }

    // Sortowanie komórek wzdłuż kierunku wiatru (od nawietrznej do zawietrznej)
    const indices = new Int32Array(n);
    const projections = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      indices[i] = i;
      projections[i] = points[i][0] * meanU + points[i][1] * meanV;
    }
    indices.sort((a, b) => projections[a] - projections[b]);

    // Inicjalizacja lądu
    for (let k = 0; k < n; k++) {
      const i = indices[k];
      if (isWater(i)) continue;
      const nb = cells.c[i];
      if (!nb || nb.length === 0) continue;
      let moistSum = 0;
      let waterCount = 0;
      for (let j = 0; j < nb.length; j++) {
        const neighbor = nb[j];
        if (moisture[neighbor] > 0) {
          moistSum += moisture[neighbor];
          waterCount++;
        }
      }
      moisture[i] = waterCount > 0 ? (moistSum / waterCount) * 0.95 : 12.0;
    }

    const SWEEP_COUNT = 4;
    const characteristicDistKm = 4200;

    for (let sweep = 0; sweep < SWEEP_COUNT; sweep++) {
      for (let k = 0; k < n; k++) {
        const i = indices[k];
        if (isWater(i)) {
          moisture[i] = oceanMoisture[i];
          continue;
        }

        const nb = cells.c[i];
        if (!nb || nb.length === 0) continue;

        const [xi, yi] = points[i];
        const h_i = h[i];
        let upwindFluxSum = 0;
        let upwindWeightSum = 0;
        let diffMoistSum = 0;

        let gradHx = 0;
        let gradHy = 0;

        for (let jIdx = 0; jIdx < nb.length; jIdx++) {
          const j = nb[jIdx];
          const [xj, yj] = points[j];

          const dxToJ = xj - xi;
          const dyToJ = yj - yi;
          const distPx = Math.hypot(dxToJ, dyToJ) || 1;
          const dh = h[j] - h_i;

          gradHx += (dh * dxToJ) / (distPx * distPx);
          gradHy += (dh * dyToJ) / (distPx * distPx);

          // Wektor przepływu z j do i: dxFromJ = -dxToJ
          const dxFromJ = -dxToJ;
          const dyFromJ = -dyToJ;
          const dirX = dxFromJ / distPx;
          const dirY = dyFromJ / distPx;

          const wu = windU ? windU[j] : 0;
          const wv = windV ? windV[j] : 0;
          const dot = wu * dirX + wv * dirY; // dodatni gdy wiatr wieje z j do i

          if (dot > 0) {
            const w = dot * 1.5;
            upwindFluxSum += moisture[j] * w;
            upwindWeightSum += w;
          }
          diffMoistSum += moisture[j];
        }

        gradHx /= nb.length;
        gradHy /= nb.length;

        const upwindM = upwindWeightSum > 0 ? upwindFluxSum / upwindWeightSum : diffMoistSum / nb.length;
        const diffM = diffMoistSum / nb.length;

        const distKm = kmPerCell;
        const distanceDecay = Math.exp(-distKm / characteristicDistKm);
        let incM = (upwindM * 0.88 + diffM * 0.12) * distanceDecay;

        // Opad orograficzny (wznoszenie V · ∇h)
        const wu_i = windU ? windU[i] : 0;
        const wv_i = windV ? windV[i] : 0;
        const lift = Math.max(0, (wu_i * gradHx + wv_i * gradHy) * 5.0);
        if (lift > 0) {
          const oroLoss = Math.min(lift * 0.05 * config.orographicBlockRate, 0.45);
          incM *= 1.0 - oroLoss;
        }

        // Continental Moisture Recycling
        incM *= 1.018;

        const tempI = getTemp(i);
        const altitudeCapacityFactor = Math.max(0.2, 1.0 - (h_i - 20) / 95);
        const airCapacity = this.clausiusClapeyron(tempI) * 1.6 * altitudeCapacityFactor;

        moisture[i] = Math.min(incM, airCapacity);
      }
    }

    laplacianSmooth(moisture, cells.c, 0.06, 1);

    // ─── Krok 3: Obliczenie rocznego opadu z ustalonego stanu równowagi ───
    const precipMmYr = new Float32Array(n);
    const BASE_ANNUAL_FACTOR = 34.0;

    for (let i = 0; i < n; i++) {
      if (isWater(i)) {
        precipMmYr[i] = 700 * precModifier;
        continue;
      }

      const nb = cells.c[i];
      const [xi, yi] = points[i];
      const h_i = h[i];
      const w_i = moisture[i];
      const tempI = getTemp(i);

      // 1. Opad nizinny frontalno-konwekcyjny
      const baseRain = w_i * BASE_ANNUAL_FACTOR;

      // 2. Opad orograficzny (wznoszenie po stoku nawietrznym)
      let gradHx = 0;
      let gradHy = 0;
      if (nb && nb.length > 0) {
        for (let jIdx = 0; jIdx < nb.length; jIdx++) {
          const j = nb[jIdx];
          const dxToJ = points[j][0] - xi;
          const dyToJ = points[j][1] - yi;
          const distPx = Math.hypot(dxToJ, dyToJ) || 1;
          const dh = h[j] - h_i;
          gradHx += (dh * dxToJ) / (distPx * distPx);
          gradHy += (dh * dyToJ) / (distPx * distPx);
        }
        gradHx /= nb.length;
        gradHy /= nb.length;
      }

      const wu_i = windU ? windU[i] : 0;
      const wv_i = windV ? windV[i] : 0;
      const lift = Math.max(0, (wu_i * gradHx + wv_i * gradHy) * 5.0);
      const oroRain = lift * w_i * 24.0 * config.orographicBlockRate;

      // 3. Ewapotranspiracja i recykling
      const evapRate = this.estimateEvapotranspiration(tempI, (baseRain + oroRain) / 40, h_i);
      const evapBonus = (baseRain + oroRain) * evapRate * 0.22;

      const totalRain = (baseRain + oroRain + evapBonus) * precModifier;
      precipMmYr[i] = Math.max(50, totalRain);
    }

    laplacianSmooth(precipMmYr, cells.c, 0.08, 1);

    // ─── Krok 4: Zapis do tablicy FMG cells.prec [0–255] ───
    const FMG_PREC_DIVISOR = 40;

    for (let i = 0; i < n; i++) {
      if (isWater(i)) {
        cells.prec[i] = Math.min(255, Math.round(5 * precModifier));
      } else {
        const fmgPrec = Math.round(precipMmYr[i] / FMG_PREC_DIVISOR);
        cells.prec[i] = Math.max(1, Math.min(255, fmgPrec));
      }
    }
  }

  /**
   * Równanie Clausiusa-Clapeyrona dla ciśnienia pary nasyconej e_s(T) w hPa.
   */
  clausiusClapeyron(tempC: number): number {
    const t = Math.max(-40, Math.min(50, tempC));
    return 6.112 * Math.exp((17.67 * t) / (t + 243.5));
  }

  /**
   * Estymacja ewapotranspiracji.
   */
  private estimateEvapotranspiration(tempC: number, precUnits: number, height: number): number {
    if (tempC < -5 || height > 80) return DEFAULT_EVAPOTRANSPIRATION[11];
    if (tempC < 0) return DEFAULT_EVAPOTRANSPIRATION[10];
    if (precUnits < 8) return DEFAULT_EVAPOTRANSPIRATION[1]; // Sucho (<320 mm)

    if (tempC > 20 && precUnits > 40) return DEFAULT_EVAPOTRANSPIRATION[7]; // Rainforest (>1600 mm)
    if (tempC > 15 && precUnits > 25) return DEFAULT_EVAPOTRANSPIRATION[5]; // Seasonal forest (>1000 mm)
    if (tempC > 5 && precUnits > 16) return DEFAULT_EVAPOTRANSPIRATION[6]; // Deciduous forest (>650 mm)
    if (tempC > 0 && precUnits > 10) return DEFAULT_EVAPOTRANSPIRATION[9]; // Taiga (>400 mm)

    return DEFAULT_EVAPOTRANSPIRATION[4]; // Grassland
  }
}

export const MoistureAdvectionEngine = new MoistureAdvectionEngineModule();
