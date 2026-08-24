/**
 * Eulerowski silnik wilgoci i opadów klimatycznych (Aero-Hydro 2.0).
 *
 * Model stanu równowagi (Quasi-Steady-State Mass Balance):
 *   1. Iteracje służą do wyznaczenia ustalonego, ciągłego pola wilgotności atmosfery W(x,y)
 *      w oparciu o parowanie oceaniczne, adwekcję wiatrem, dyfuzję turbulencyjną
 *      oraz blokadę i zrzut orograficzny na grzbietach górskich.
 *   2. Po ustabilizowaniu pola wilgoci W(x,y), opad roczny w mm/rok jest wyliczany jednokrotnie:
 *      - Opad nizinny frontalno-konwekcyjny: proporcjonalny do wilgoci kolumny powietrza W
 *      - Opad orograficzny: proporcjonalny do strumienia wznoszenia wiatru po stoku (V · \nabla h)
 *      - Cień opadowy: naturalny spadek opadów za granią w wyniku zubożenia wilgoci W
 *   3. Zapis do tablicy FMG `cells.prec` w ścisłych jednostkach decymetrów (1 prec = 100 mm/rok),
 *      zapewniając idealną kompatybilność z biomes-generator, rzekami i tooltipami.
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

    // ─── Krok 1: Potencjał parowania oceanicznego (Clausius-Clapeyron + SST + Wiatr) ───
    // Wilgotność oceanu wyrażona w [mm precipitable water] (typowo 20–55 mm)
    const oceanMoisture = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      if (isWater(i)) {
        const baseTemp = getTemp(i);
        const sst = sstAnomaly ? sstAnomaly[i] : 0;
        const satVaporHPa = this.clausiusClapeyron(baseTemp + sst);
        const windSpeed = Math.hypot(windU ? windU[i] : 0, windV ? windV[i] : 0);
        const windBonus = 1.0 + Math.min(windSpeed * 0.04, 0.4);
        // Wilgotność nasyconego słupa powietrza nad morzem
        oceanMoisture[i] = satVaporHPa * 1.5 * windBonus;
        moisture[i] = oceanMoisture[i];
      } else {
        moisture[i] = 0;
      }
    }

    // ─── Krok 2: Iteracyjne ustalenie ciągłego pola wilgoci W(x,y) ─────────
    const moistureNext = new Float32Array(n);
    const characteristicDistKm = 2200; // dystans zaniku wilgoci w głąb lądu [km]

    for (let iter = 0; iter < config.iterations; iter++) {
      // Przywróć stan oceanu jako nieskończonego źródła
      for (let i = 0; i < n; i++) {
        if (isWater(i)) {
          moisture[i] = oceanMoisture[i];
          moistureNext[i] = oceanMoisture[i];
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

          // Składowa wiatru z komórki j w kierunku docelowej komórki i
          const wu = windU ? windU[j] : 0;
          const wv = windV ? windV[j] : 0;
          const windMag = Math.hypot(wu, wv);

          let advectionFactor = 0;
          if (windMag > 0.01) {
            const dot = (wu * dirX + wv * dirY) / windMag; // [-1..1]
            // Gdy wiatr wieje z j do i (dot > 0), transport jest silnie wzmocniony
            advectionFactor = Math.max(0, dot) * Math.min(windMag / 3.5, 2.5);
          }

          // Waga transportu = dyfuzja bazowa (izotropowa) + kierunkowy wiatr
          const weight = config.diffusionCoeff + config.advectionStrength * advectionFactor;

          // Zanik odległościowy w km
          const distKm = (distPx / spacing) * kmPerCell;
          const distanceDecay = Math.exp(-distKm / characteristicDistKm);

          weightedMoisture += moisture[j] * weight * distanceDecay;
          totalWeight += weight;
        }

        let incomingMoisture = totalWeight > 0 ? weightedMoisture / totalWeight : moisture[i];

        // Bariera orograficzna: wznoszenie po stoku powoduje utratę wilgoci z kolumny
        for (let k = 0; k < nb.length; k++) {
          const j = nb[k];
          const diffH = h[i] - h[j];
          if (diffH > 0) {
            const dxPx = xi - points[j][0];
            const dyPx = yi - points[j][1];
            const distPx = Math.hypot(dxPx, dyPx) || 1;
            const wu = windU ? windU[j] : 0;
            const wv = windV ? windV[j] : 0;
            const dot = wu * (dxPx / distPx) + wv * (dyPx / distPx);
            // Im wyższa grań i silniejszy wiatr pod górę, tym większa utrata wilgoci
            const slopeLoss = Math.min((diffH / 18.0) * (1.0 + Math.max(0, dot) / 4.0), 0.7);
            incomingMoisture *= 1.0 - slopeLoss * 0.45;
          }
        }

        // Pojemność kolumny powietrza (temperatura i wysokość)
        const tempI = getTemp(i);
        const altitudeCapacityFactor = Math.max(0.2, 1.0 - (h[i] - 20) / 90);
        const airCapacity = this.clausiusClapeyron(tempI) * 1.6 * altitudeCapacityFactor;

        // Ograniczenie wilgoci do pojemności powietrza
        moistureNext[i] = Math.min(incomingMoisture, airCapacity);
      }

      // Aktualizacja pola dla kolejnej iteracji
      for (let i = 0; i < n; i++) {
        if (!isWater(i)) moisture[i] = moistureNext[i];
      }
    }

    // Wygładzenie pola ustalonej wilgotności powietrza
    laplacianSmooth(moisture, cells.c, 0.08, 1);

    // ─── Krok 3: Obliczenie rocznego opadu z ustalonego stanu równowagi ───
    const precipMmYr = new Float32Array(n);

    // Mnożnik przeliczenia wilgoci [mm] na roczną sumę opadów nizinnych [mm/rok]
    const BASE_ANNUAL_FACTOR = 32.0;

    for (let i = 0; i < n; i++) {
      if (isWater(i)) {
        precipMmYr[i] = 700 * precModifier; // stały opad morski (~700 mm/rok)
        continue;
      }

      const nb = cells.c[i];
      const [xi, yi] = points[i];
      const h_i = h[i];
      const w_i = moisture[i];
      const tempI = getTemp(i);

      // 1. Opad nizinny (frontalno-konwekcyjny)
      const baseRain = w_i * BASE_ANNUAL_FACTOR;

      // 2. Opad orograficzny (wznoszenie mas powietrza po stoku nawietrznym)
      let windwardLifting = 0;
      if (nb && nb.length > 0) {
        for (let k = 0; k < nb.length; k++) {
          const j = nb[k];
          const diffH = h_i - h[j];
          if (diffH > 0) {
            const dxPx = xi - points[j][0];
            const dyPx = yi - points[j][1];
            const distPx = Math.hypot(dxPx, dyPx) || 1;
            const wu = windU ? windU[i] : 0;
            const wv = windV ? windV[i] : 0;
            const dot = wu * (dxPx / distPx) + wv * (dyPx / distPx);
            if (dot > 0) {
              windwardLifting = Math.max(windwardLifting, (diffH / 12.0) * (dot / 3.0));
            } else {
              windwardLifting = Math.max(windwardLifting, diffH / 25.0);
            }
          }
        }
      }

      const oroRain = windwardLifting * w_i * 45.0 * config.orographicBlockRate;

      // 3. Ewapotranspiracja (podtrzymanie opadów w zalesionych nizinach)
      const evapRate = this.estimateEvapotranspiration(tempI, (baseRain + oroRain) / 100, h_i);
      const evapBonus = (baseRain + oroRain) * evapRate * 0.25;

      const totalRain = (baseRain + oroRain + evapBonus) * precModifier;
      precipMmYr[i] = Math.max(100, totalRain); // minimalny opad pustynny 100 mm/rok
    }

    // Delikatne wygładzenie opadów
    laplacianSmooth(precipMmYr, cells.c, 0.1, 1);

    // ─── Krok 4: Zapis do tablicy FMG cells.prec [0–255] w decymetrach (100 mm) ───
    for (let i = 0; i < n; i++) {
      if (isWater(i)) {
        cells.prec[i] = Math.min(255, Math.round(7 * precModifier)); // 7 dm = 700 mm
      } else {
        // Konwersja mm/rok -> dm (1 prec = 100 mm)
        // 1000 mm -> prec = 10
        // 2500 mm -> prec = 25
        // 4500 mm -> prec = 45
        const precDm = Math.round(precipMmYr[i] / 100);
        cells.prec[i] = Math.max(1, Math.min(255, precDm));
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
    if (precUnits < 4) return DEFAULT_EVAPOTRANSPIRATION[1]; // Sucho (<400 mm)

    if (tempC > 20 && precUnits > 20) return DEFAULT_EVAPOTRANSPIRATION[7]; // Rainforest (>2000 mm)
    if (tempC > 15 && precUnits > 12) return DEFAULT_EVAPOTRANSPIRATION[5]; // Seasonal forest (>1200 mm)
    if (tempC > 5 && precUnits > 9) return DEFAULT_EVAPOTRANSPIRATION[6]; // Deciduous forest (>900 mm)
    if (tempC > 0 && precUnits > 5) return DEFAULT_EVAPOTRANSPIRATION[9]; // Taiga (>500 mm)

    return DEFAULT_EVAPOTRANSPIRATION[4]; // Grassland
  }
}

export const MoistureAdvectionEngine = new MoistureAdvectionEngineModule();
