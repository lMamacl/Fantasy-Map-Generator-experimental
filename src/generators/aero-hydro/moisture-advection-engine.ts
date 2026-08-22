/**
 * Silnik termodynamiki wilgoci i adwekcji opadów 2D (Aero-Hydro 2.0).
 *
 * Modeluje:
 *   1. Równanie nasycenia Clausiusa-Clapeyrona e_s(T).
 *   2. Parowanie z oceanu modulowane anomalią SST (ciepłe prądy parują mocniej).
 *   3. Wieloprzebiegową adwekcję wilgoci 2D wzdłuż wektora wiatru.
 *   4. Orograficzne wymuszenie opadów po stronie nawietrznej gór (ochładzanie wilgotnoadiabatyczne)
 *      oraz cień opadowy z efektem fenu (ogrzewanie suchoadiabatyczne) po stronie zawietrznej.
 *   5. Dyfuzję atmosferyczną zapobiegającą nienaturalnym ścianom opadów.
 *   6. Gwarantowane opady minimalne (brak martwych stref na pustyniach).
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

    const advectionRate = config.advectionRate ?? 0.6;
    const orographicEfficiency = config.orographicEfficiency ?? 0.75;
    const baseRainoutRate = config.baseRainoutRate ?? 0.08;

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

    // Tymczasowy bufor opadów w wartościach ciągłych (mm/rok)
    const rawPrecip = new Float32Array(n);

    // 2. Krok I: Inicjalizacja wilgoci nad oceanami (Parowanie oparte na Clausiusie-Clapeyronie i SST)
    for (let i = 0; i < n; i++) {
      const baseTemp = temp ? temp[i] : 15;
      const sst = sstAnomaly ? sstAnomaly[i] : 0;
      const effectiveTemp = isWater(i) ? baseTemp + sst : baseTemp;

      const satVaporCapacity = this.clausiusClapeyron(effectiveTemp);

      if (isWater(i)) {
        // Ocean dostarcza wilgoć nasyconą do atmosfery
        // Ciepłe prądy zwiększają parowanie
        const windSpeed = Math.hypot(windU ? windU[i] : 0, windV ? windV[i] : 0);
        const windEvapBonus = 1 + Math.min(windSpeed * 0.03, 0.5);
        moisture[i] = satVaporCapacity * windEvapBonus;
      } else {
        // Ląd startuje z wilgocią szczątkową
        moisture[i] = satVaporCapacity * 0.15;
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

        // Zmieszaj wilgoć z napływającej masy powietrza (skalowane prędkością wiatru)
        if (upwindWeightSum > 0) {
          const advected = upwindMoistureSum / upwindWeightSum;
          const fluxRate = Math.min(0.9, advectionRate * (1 + windSpeed * 0.05));
          moisture[i] = moisture[i] * (1 - fluxRate) + advected * fluxRate;
        }

        // Jeśli komórka to ląd, powietrze napotykające wzniesienie ulega orograficznej kondensacji
        if (!isWater(i)) {
          const cellTemp = temp ? temp[i] : 15;

          // Wymuszenie orograficzne: wznoszenie terenu wzdłuż wektora wiatru
          const [dhx, dhy] = scalarGradient(h, i, points, cells.c);
          const slopeAscent = (u * dhx + v * dhy) / Math.max(windSpeed, 0.1);

          let condensation = 0;
          let foehnDrying = 1.0;

          if (slopeAscent > 0) {
            // NAWIETRZNA: Wiatr wieje pod górę — ochładzanie adiabatyczne obniża próg nasycenia
            const adiabaticCooling = slopeAscent * 0.4;
            const cooledSat = this.clausiusClapeyron(cellTemp - adiabaticCooling);
            if (moisture[i] > cooledSat) {
              condensation = (moisture[i] - cooledSat) * orographicEfficiency;
            }
          } else if (slopeAscent < 0) {
            // ZAWIETRZNA (EFEKT FENU): Wiatr opada w dół stoku — kompresja i ogrzewanie suchoadiabatyczne
            const foehnWarming = Math.abs(slopeAscent) * 0.5;
            const warmedSat = this.clausiusClapeyron(cellTemp + foehnWarming);
            // Wyższa pojemność nasycenia drastycznie tłumi kondensację i deszcz
            if (moisture[i] > warmedSat) {
              condensation = (moisture[i] - warmedSat) * 0.2;
            }
            // Zmniejszenie opadu bazowego w cieniu fenowym
            foehnDrying = 0.3;
          } else {
            // PŁASKI TEREN: Zwykłe przesycenie (deszcz frontalny)
            const currentSat = this.clausiusClapeyron(cellTemp);
            if (moisture[i] > currentSat) {
              condensation = (moisture[i] - currentSat) * 0.5;
            }
          }

          // Naturalny ubytek wilgoci w atmosferze (opad bazowy modulowany fenem)
          const baseRainout = moisture[i] * baseRainoutRate * foehnDrying;
          const totalRain = Math.max(condensation + baseRainout, 0);

          rawPrecip[i] += totalRain;
          moisture[i] = Math.max(moisture[i] - totalRain, 0);
        } else {
          // Nad wodą wilgoć jest natychmiast uzupełniana przez parowanie
          const seaTemp = (temp ? temp[i] : 15) + (sstAnomaly ? sstAnomaly[i] : 0);
          const seaSat = this.clausiusClapeyron(seaTemp);
          moisture[i] = Math.max(moisture[i], seaSat * 0.9);
          // Niewielki opad nad oceanem
          rawPrecip[i] += seaSat * 0.04;
        }
      }
    }

    // 4. Krok III: Dyfuzja atmosferyczna (wygładzenie gradientów i eliminacja ścian opadów)
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

      // Gwarantowane minimum na lądzie (brak martwych pustyń o zerowych opadach)
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
