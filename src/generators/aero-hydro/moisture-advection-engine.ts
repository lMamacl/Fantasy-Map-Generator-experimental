/**
 * Silnik termodynamiki wilgoci i adwekcji opadów 2D (Aero-Hydro 2.0).
 *
 * Modeluje:
 *   1. Równanie nasycenia Clausiusa-Clapeyrona e_s(T).
 *   2. Parowanie z oceanu modulowane anomalią SST (ciepłe prądy parują mocniej) oraz prędkością wiatru.
 *   3. Wieloprzebiegową adwekcję wilgoci 2D wzdłuż wektora wiatru (multi-pass upwind).
 *   4. Orograficzne wymuszenie opadów po stronie nawietrznej gór (adiabatic cooling & rainout).
 *   5. Ogrzewanie fenowe i cień opadowy po stronie zawietrznej (Föhn effect / adiabatic compression).
 *   6. Dyfuzję atmosferyczną zapobiegającą nienaturalnym ścianom opadów.
 *   7. Gwarantowane opady minimalne (brak martwych stref na pustyniach).
 *
 * Zapisuje wynik do `grid.cells.prec` (Uint8Array, 0–255) oraz `grid.cells.moisture` (Float32Array).
 *
 * @module generators/aero-hydro/moisture-advection-engine
 */

import { defaultMoistureConfig, type MoistureConfig } from "@/types/aero-hydro";
import { laplacianSmooth, scalarGradient } from "@/utils/grid-math";

export class MoistureAdvectionEngineModule {
  /**
   * Główna metoda wyznaczająca rozkład wilgotności atmosfery i opadów rocznych.
   *
   * @param customConfig Opcjonalna niestandardowa konfiguracja wilgoci
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

    // 1. Alokacja lub ponowne użycie TypedArrays
    if (!cells.moisture || cells.moisture.length !== n) {
      cells.moisture = new Float32Array(n);
    }
    if (!cells.prec || cells.prec.length !== n) {
      cells.prec = new Uint8Array(n);
    }

    const { moisture, prec, windU, windV, sstAnomaly, temp, h } = cells;
    const isWater = (i: number) => h[i] < 20;

    // Pobierz temperaturę komórki z bezpiecznym fallbackiem
    const getTemp = (i: number): number => {
      if (temp && typeof temp[i] === "number" && Number.isFinite(temp[i])) {
        return temp[i];
      }
      return 15; // standardowy fallback (15°C)
    };

    // Parametry konfiguracyjne ze stałymi fizycznymi
    const advectionRate = config.advectionRate ?? 0.6;
    const orographicRate = config.orographicCondensationRate ?? 0.75;
    const baseRainoutRate = config.baseRainoutRate ?? 0.08;
    const foehnHeatingRate = config.foehnHeatingRate ?? 0.35;

    // Tymczasowy bufor opadów w wartościach ciągłych (mm/rok)
    const rawPrecip = new Float32Array(n);

    // 2. Krok I: Inicjalizacja wilgoci nad oceanami (Parowanie oparte na Clausiusie-Clapeyronie i SST)
    for (let i = 0; i < n; i++) {
      const baseTemp = getTemp(i);
      const sst = sstAnomaly ? sstAnomaly[i] : 0;
      const effectiveTemp = isWater(i) ? baseTemp + sst : baseTemp;

      const satVaporCapacity = this.clausiusClapeyron(effectiveTemp);

      if (isWater(i)) {
        // Ocean dostarcza wilgoć nasyconą do atmosfery
        // Prędkość wiatru zwiększa turbulencyjne parowanie
        const windSpeed = Math.hypot(windU ? windU[i] : 0, windV ? windV[i] : 0);
        const windEvapBonus = 1 + Math.min(windSpeed * 0.03, 0.5);
        moisture[i] = satVaporCapacity * windEvapBonus;
      } else {
        // Ląd startuje z zerową wilgocią (wilgoć napływa z oceanu wraz z adwekcją)
        moisture[i] = 0;
      }
    }

    // 3. Krok II: Wieloprzebiegowa adwekcja 2D (Multi-Pass Upwind Advection)
    const passes = Math.max(config.advectionPasses, 1);
    const tempMoisture = new Float32Array(n);

    for (let pass = 0; pass < passes; pass++) {
      tempMoisture.set(moisture);

      for (let i = 0; i < n; i++) {
        const u = windU ? windU[i] : 0;
        const v = windV ? windV[i] : 0;
        const windSpeed = Math.hypot(u, v);

        if (windSpeed < 0.05) continue;

        // Wyznacz sąsiadów nawietrznych (skąd wieje wiatr)
        const [x0, y0] = points[i];
        const nb = cells.c[i];
        let upwindMoistureSum = 0;
        let upwindWeightSum = 0;

        for (let j = 0; j < nb.length; j++) {
          const neighbor = nb[j];
          const [xn, yn] = points[neighbor];
          const dx = x0 - xn; // wektor od sąsiada do nas
          const dy = y0 - yn;
          const len = Math.hypot(dx, dy);
          if (len < 1e-4) continue;

          // Iloczyn skalarny z kierunkiem wiatru (dodatni, gdy wiatr wieje OD sąsiada DO nas)
          const dot = (u * (dx / len) + v * (dy / len)) / windSpeed;
          if (dot > 0.1) {
            const weight = dot / len;
            upwindMoistureSum += tempMoisture[neighbor] * weight;
            upwindWeightSum += weight;
          }
        }

        // Zmieszaj wilgoć z napływającej masy powietrza
        if (upwindWeightSum > 0) {
          const advected = upwindMoistureSum / upwindWeightSum;
          moisture[i] = moisture[i] * (1 - advectionRate) + advected * advectionRate;
        }

        // Fizyka lądowa: orografia, kondensacja i efekt Fenu
        if (!isWater(i)) {
          const cellTemp = getTemp(i);
          const currentSat = this.clausiusClapeyron(cellTemp);

          // Wymuszenie orograficzne: nachylenie terenu wzdłuż wektora wiatru
          const [dhx, dhy] = scalarGradient(h, i, points, cells.c);
          const slopeAscent = (u * dhx + v * dhy) / Math.max(windSpeed, 0.1);

          let condensation = 0;
          if (slopeAscent > 0) {
            // Nawietrzna strona (Wznoszenie): ochładzanie wilgotnoadiabatyczne (~6.5°C/km)
            const adiabaticCooling = slopeAscent * 3.5;
            const cooledSat = this.clausiusClapeyron(cellTemp - adiabaticCooling);
            if (moisture[i] > cooledSat) {
              condensation = (moisture[i] - cooledSat) * orographicRate;
            }
          } else if (slopeAscent < -0.1) {
            // Zawietrzna strona (Efekt Fenu): ogrzewanie suchoadiabatyczne (~10°C/km)
            const foehnWarming = Math.abs(slopeAscent) * foehnHeatingRate * 4.0;
            const warmedSat = this.clausiusClapeyron(cellTemp + foehnWarming);
            // W podgrzanym powietrzu brak kondensacji, a wilgotność względna spada
            condensation = 0;
            if (moisture[i] > warmedSat) {
              condensation = (moisture[i] - warmedSat) * 0.2;
            }
          } else if (moisture[i] > currentSat) {
            // Zwykłe przesycenie frontalne
            condensation = (moisture[i] - currentSat) * 0.5;
          }

          // Naturalny ubytek wilgoci w kolumnie powietrza (opad bazowy)
          // Po zawietrznej stronie efekt Fenu tłumi ubytek bazowy
          const rainoutFactor = slopeAscent < -0.2 ? baseRainoutRate * 0.3 : baseRainoutRate;
          const baseRainout = moisture[i] * rainoutFactor;
          const totalRain = Math.max(condensation + baseRainout, 0);

          rawPrecip[i] += totalRain;
          moisture[i] = Math.max(moisture[i] - totalRain, 0);
        } else {
          // Nad wodą wilgoć jest stale uzupełniana przez parowanie
          const seaTemp = getTemp(i) + (sstAnomaly ? sstAnomaly[i] : 0);
          const seaSat = this.clausiusClapeyron(seaTemp);
          moisture[i] = Math.max(moisture[i], seaSat * 0.9);
          rawPrecip[i] += seaSat * 0.04;
        }
      }
    }

    // 4. Krok III: Dyfuzja atmosferyczna (wygładzenie gradientów i eliminacja nienaturalnych ścian)
    if (config.diffusionCoeff > 0) {
      laplacianSmooth(rawPrecip, cells.c, config.diffusionCoeff, 2);
    }

    // 5. Krok IV: Gwarantowany opad minimalny i konwersja do formatu FMG (0–255)
    let maxRain = 1.0;
    for (let i = 0; i < n; i++) {
      if (rawPrecip[i] > maxRain) maxRain = rawPrecip[i];
    }

    for (let i = 0; i < n; i++) {
      let rainMm = rawPrecip[i];

      // Gwarantowane minimum na lądzie (brak martwych 0-pustyń)
      if (!isWater(i)) {
        rainMm = Math.max(rainMm, config.minPrecipMmYr * 0.05);
      }

      // Skalowanie modyfikatorem użytkownika i rzutowanie do bajtu 0–255
      const scaledVal = (rainMm / maxRain) * 220 * precModifier;
      prec[i] = Math.max(0, Math.min(255, Math.round(scaledVal)));
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
}

export const MoistureAdvectionEngine = new MoistureAdvectionEngineModule();
