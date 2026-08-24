/**
 * Eulerowski silnik wilgoci i opadów klimatycznych (Aero-Hydro 2.0).
 *
 * Model wieloprzebiegowy (iteracyjna równowaga transportu masy):
 *   Każda komórka lądowa otrzymuje wilgoć od sąsiadów w wyniku adwekcji
 *   wiatrem oraz izotropowej dyspersji/dyfuzji atmosferycznej (cyklony,
 *   turbulencja, zmienność synoptyczna).
 *
 * Mechanizmy:
 *   1. Parowanie oceaniczne (Clausius-Clapeyron + anomalia SST + prędkość wiatru)
 *   2. Adwekcja wiatrowa upwind & dyfuzja turbulencyjna
 *   3. Wymuszona kondensacja orograficzna na stokach nawietrznych (V · \nabla h > 0)
 *   4. Opad frontalno-nizinny (deszcz nasycenia i konwekcji)
 *   5. Cień opadowy za łańcuchami górskimi (zubożenie wilgoci po stronie zawietrznej)
 *   6. Ewapotranspiracja wegetacyjna (recykling opadów)
 *   7. Skalowanie fizyczne do bezwzględnych jednostek mm/rok i Uint8 (SCALE_FACTOR=20)
 *
 * @module generators/aero-hydro/moisture-advection-engine
 */

import {
  DEFAULT_EVAPOTRANSPIRATION,
  defaultMoistureConfig,
  type MoistureConfig,
  PRECIP_SCALE_FACTOR
} from "@/types/aero-hydro";
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
    const spacing = grid.spacing ?? 10;
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

    // ─── Krok 1: Potencjał parowania i wilgotność nasycenia oceanu ──────
    const oceanSource = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      if (isWater(i)) {
        const baseTemp = getTemp(i);
        const sst = sstAnomaly ? sstAnomaly[i] : 0;
        const satVaporHPa = this.clausiusClapeyron(baseTemp + sst);
        const windSpeed = Math.hypot(windU ? windU[i] : 0, windV ? windV[i] : 0);
        const windBonus = 1.0 + Math.min(windSpeed * 0.05, 0.6);
        // Wilgoć wyrażona w [mm precipitable water] (~ 2.0 * e_s)
        oceanSource[i] = satVaporHPa * 2.2 * windBonus;
        moisture[i] = oceanSource[i];
      } else {
        moisture[i] = 0;
      }
    }

    // ─── Krok 2: Iteracyjny transport masy i bilans wilgoci ───────────
    const rawPrecipMm = new Float32Array(n);
    const moistureNext = new Float32Array(n);

    // Długość charakterystyczna zaniku wilgoci w głąb lądu [km]
    const characteristicDistKm = 2400;

    for (let iter = 0; iter < config.iterations; iter++) {
      // Przywróć wilgoć nad oceanem (nieskończony rezerwuar parowania)
      for (let i = 0; i < n; i++) {
        if (isWater(i)) {
          moisture[i] = oceanSource[i];
          moistureNext[i] = oceanSource[i];
        }
      }

      for (let i = 0; i < n; i++) {
        if (isWater(i)) continue;

        const nb = cells.c[i];
        if (!nb || nb.length === 0) continue;

        const [xi, yi] = points[i];
        let totalWeight = 0;
        let weightedMoisture = 0;

        for (let k = 0; k < nb.length; k++) {
          const j = nb[k];
          const [xj, yj] = points[j];

          const dxPx = xi - xj;
          const dyPx = yi - yj;
          const distPx = Math.hypot(dxPx, dyPx) || 1;
          const dirX = dxPx / distPx;
          const dirY = dyPx / distPx;

          // Prędkość wiatru w sąsiedzie j w kierunku docelowej komórki i
          const wu = windU ? windU[j] : 0;
          const wv = windV ? windV[j] : 0;
          const windMag = Math.hypot(wu, wv);

          let advectionFactor = 0;
          if (windMag > 0.01) {
            const dot = (wu * dirX + wv * dirY) / windMag; // [-1..1]
            // Gdy wiatr wieje z j do i (dot > 0), transfer jest silnie kierunkowy
            advectionFactor = Math.max(0, dot) * Math.min(windMag / 3.0, 3.0);
          }

          // Waga transportu = dyfuzja bazowa (izotropowa) + ukierunkowany wiatr
          const weight = config.diffusionCoeff + config.advectionStrength * advectionFactor;

          // Ubytek odległościowy wzdłuż drogi
          const distKm = (distPx / spacing) * kmPerCell;
          const distanceDecay = Math.exp(-distKm / characteristicDistKm);

          weightedMoisture += moisture[j] * weight * distanceDecay;
          totalWeight += weight;
        }

        const incomingMoisture = totalWeight > 0 ? weightedMoisture / totalWeight : moisture[i];

        // Pojemność kolumny powietrza na danej wysokości i temperaturze
        const tempI = getTemp(i);
        const altitudeCapacityFactor = Math.max(0.15, 1.0 - (h[i] - 20) / 80);
        const airCapacity = this.clausiusClapeyron(tempI) * 1.8 * altitudeCapacityFactor;

        // Opad nizinny (kondensacja konwekcyjna/frontalna)
        const baseRainRate = 0.12; // 12% wilgoci zamienia się w opad na cykl
        let rainMm = incomingMoisture * baseRainRate;
        let remainingMoisture = incomingMoisture - rainMm;

        // Opad orograficzny (wznoszenie po stoku):
        // Oblicz gradient wysokości i iloczyn ze składową wiatru/przepływu
        let _avgNbHeight = 0;
        let windwardSlope = 0;
        for (let k = 0; k < nb.length; k++) {
          const j = nb[k];
          _avgNbHeight += h[j];
          const diffH = h[i] - h[j];
          if (diffH > 0) {
            const dxPx = xi - points[j][0];
            const dyPx = yi - points[j][1];
            const distPx = Math.hypot(dxPx, dyPx) || 1;
            const dirX = dxPx / distPx;
            const dirY = dyPx / distPx;
            const wu = windU ? windU[j] : 0;
            const wv = windV ? windV[j] : 0;
            const dot = wu * dirX + wv * dirY;
            if (dot > 0) {
              windwardSlope = Math.max(windwardSlope, (diffH / 10.0) * (1 + dot / 4.0));
            } else {
              windwardSlope = Math.max(windwardSlope, diffH / 15.0);
            }
          }
        }
        _avgNbHeight /= nb.length;

        if (windwardSlope > 0) {
          const oroFraction = Math.min(windwardSlope * config.orographicBlockRate * 0.45, 0.88);
          const oroRain = remainingMoisture * oroFraction;
          rainMm += oroRain;
          remainingMoisture -= oroRain;
        }

        // Jeśli pozostała wilgoć przekracza lokalną pojemność powietrza, skrapla się nadmiar
        if (remainingMoisture > airCapacity) {
          const excess = (remainingMoisture - airCapacity) * config.condensationRate;
          rainMm += excess;
          remainingMoisture -= excess;
        }

        // Ewapotranspiracja (recykling części deszczu przez lasy i glebę)
        const evapRate = this.estimateEvapotranspiration(tempI, rainMm, h[i]);
        const recycledMoisture = rainMm * evapRate * 0.35;
        remainingMoisture += recycledMoisture;

        rawPrecipMm[i] += rainMm;
        moistureNext[i] = Math.max(0.05, remainingMoisture);
      }

      // Aktualizacja pola wilgoci dla kolejnej iteracji
      for (let i = 0; i < n; i++) {
        if (!isWater(i)) moisture[i] = moistureNext[i];
      }
    }

    // ─── Krok 3: Wygładzenie dyfuzyjne pola opadów ──────────────────────
    laplacianSmooth(rawPrecipMm, cells.c, 0.12, 2);

    // ─── Krok 4: Skalowanie do jednostek rocznych FMG [0–255] ─────────
    const ANNUAL_EVENT_MULTIPLIER = 40.0;

    for (let i = 0; i < n; i++) {
      if (isWater(i)) {
        cells.prec[i] = Math.min(255, Math.round(35 * precModifier));
      } else {
        const annualMm = rawPrecipMm[i] * ANNUAL_EVENT_MULTIPLIER;
        const scaledUnits = Math.round((annualMm / PRECIP_SCALE_FACTOR) * precModifier);
        cells.prec[i] = Math.max(2, Math.min(255, scaledUnits));
      }
    }
  }

  /**
   * Równanie Clausiusa-Clapeyrona dla ciśnienia pary nasyconej e_s(T) w hPa.
   * Wzór August-Roche-Magnus dla temperatur -40°C do +50°C.
   */
  clausiusClapeyron(tempC: number): number {
    const t = Math.max(-40, Math.min(50, tempC));
    return 6.112 * Math.exp((17.67 * t) / (t + 243.5));
  }

  /**
   * Estymacja ewapotranspiracji na podstawie parametrów klimatycznych komórki.
   */
  private estimateEvapotranspiration(tempC: number, rainAmount: number, height: number): number {
    if (tempC < -5 || height > 80) return DEFAULT_EVAPOTRANSPIRATION[11]; // Glacier / skały
    if (tempC < 0) return DEFAULT_EVAPOTRANSPIRATION[10]; // Tundra
    if (rainAmount < 1.0) return DEFAULT_EVAPOTRANSPIRATION[1]; // Sucho

    if (tempC > 20 && rainAmount > 4.0) return DEFAULT_EVAPOTRANSPIRATION[7]; // Rainforest
    if (tempC > 15 && rainAmount > 2.5) return DEFAULT_EVAPOTRANSPIRATION[5]; // Seasonal forest
    if (tempC > 5 && rainAmount > 2.0) return DEFAULT_EVAPOTRANSPIRATION[6]; // Deciduous forest
    if (tempC > 0 && rainAmount > 1.0) return DEFAULT_EVAPOTRANSPIRATION[9]; // Taiga

    return DEFAULT_EVAPOTRANSPIRATION[4]; // Grassland
  }
}

export const MoistureAdvectionEngine = new MoistureAdvectionEngineModule();
