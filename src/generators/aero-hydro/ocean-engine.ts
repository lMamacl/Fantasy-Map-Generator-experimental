/**
 * Silnik cyrkulacji oceanicznej i anomalii SST (Aero-Hydro 2.0).
 *
 * Modeluje wieloletnie, średnioroczne prądy morskie napędzane wiatrem (wind-driven
 * gyres, transport Ekmana, wzmocnienie prądów zachodnich krawędzi) oraz oblicza
 * anomalię temperatury powierzchni morza (SST Anomaly) wywołaną transportem ciepła.
 *
 * Warunek brzegowy:
 *   W strefie brzegowej wektor prądu jest rzutowany stycznie do linii brzegowej
 *   (V · n_coast = 0), uniemożliwiając wciekanie wody na ląd i zapewniając
 *   płynne opływanie przylądków i wysp.
 *
 * @module generators/aero-hydro/ocean-engine
 */

import { defaultOceanCurrentsConfig, type OceanCurrentsConfig } from "@/types/aero-hydro";
import { projectTangentToCoast } from "@/utils/grid-math";

export class OceanEngineModule {
  /**
   * Główna metoda generująca wektory prądów morskich i pole anomalii SST.
   * Wpisuje wyniki bezpośrednio do struktur w `grid.cells`:
   *   - `oceanU`       – składowa X prądu morskiego [m/s]
   *   - `oceanV`       – składowa Y prądu morskiego [m/s]
   *   - `sstAnomaly`   – anomalia temperatury powierzchni morza [°C]
   *
   * @param customConfig Opcjonalna niestandardowa konfiguracja prądów morskich
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

    // 1. Alokacja lub ponowne użycie TypedArrays
    if (!cells.oceanU || cells.oceanU.length !== n) {
      cells.oceanU = new Float32Array(n);
      cells.oceanV = new Float32Array(n);
      cells.sstAnomaly = new Float32Array(n);
    }

    const { oceanU, oceanV, sstAnomaly, windU, windV } = cells;
    const isWater = (i: number) => cells.h[i] < 20;

    // Kąt Ekmana w radianach
    const ekmanRad = (config.ekmanAngle * Math.PI) / 180;

    // 2. Krok I: Naprężenie wiatrowe z odchyleniem Ekmana na otwartym oceanie
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

      // Kąt odchylenia transportu Ekmana (w prawo na NH (+), w lewo na SH (-))
      const rotAngle = -fSign * ekmanRad;

      const cosE = Math.cos(rotAngle);
      const sinE = Math.sin(rotAngle);

      let uRaw = (wU * cosE - wV * sinE) * config.windStressFactor;
      let vRaw = (wU * sinE + wV * cosE) * config.windStressFactor;

      // 3. Wzmocnienie zachodnich brzegów basenu oceanicznego (Western Boundary Currents)
      // Jeśli na zachód (w lewo) od komórki w odległości szelfu znajduje się ląd, wzmocnij prąd
      const [x] = points[i];
      const relX = x / graphWidth;
      // Wykrywanie zachodniego brzegu akwenu (ląd na zachód, woda na wschód)
      let westBoost = 1.0;
      const nb = cells.c[i];
      let hasWestLand = false;
      for (let j = 0; j < nb.length; j++) {
        const neighbor = nb[j];
        if (cells.h[neighbor] >= 20 && points[neighbor][0] < x) {
          hasWestLand = true;
          break;
        }
      }

      if (hasWestLand || relX < 0.25) {
        westBoost = config.westernIntensification;
      }

      uRaw *= westBoost;
      vRaw *= westBoost;

      oceanU[i] = uRaw;
      oceanV[i] = vRaw;
    }

    // 4. Krok II: Warunki brzegowe (rzutowanie styczne do linii brzegowej V · n = 0)
    for (let i = 0; i < n; i++) {
      if (!isWater(i)) continue;

      // Sprawdź czy komórka graniczy z lądem lub jest w strefie szelfu (cells.t < 0)
      if (cells.t && cells.t[i] < 0) {
        const [tangU, tangV] = projectTangentToCoast(oceanU[i], oceanV[i], i, cells.t, points, cells.c);
        oceanU[i] = tangU;
        oceanV[i] = tangV;
      }
    }

    // 5. Krok III: Wygładzanie ciągłości przepływu w basenie morskim
    // barrier-aware: wygładzamy tylko między komórkami wodnymi
    this.barrierAwareSmooth(oceanU, cells.c, cells.h, 0.2, 1);
    this.barrierAwareSmooth(oceanV, cells.c, cells.h, 0.2, 1);

    // Ponowne zabezpieczenie brzegowe po wygładzeniu
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

    // 6. Krok IV: Obliczanie Anomalii SST (°C)
    // Prąd płynący od równika niesie ciepło (anomalia +), a od bieguna chłód (anomalia -).
    // Na półkuli N: składowa ku północy (V < 0 w układzie ekranowym y w dół) to prąd ciepły.
    // Na półkuli S: składowa ku południowi (V > 0) to prąd ciepły.
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

      // Prędkość południkowa: ujemne V to ruch ku północy, dodatnie ku południowi
      // Na NH (lat > 0): ruch na północ (v < 0) niesie ciepłą wodę z równika -> anomalia > 0
      // Na SH (lat < 0): ruch na południe (v > 0) niesie ciepłą wodę z równika -> anomalia > 0
      let meridionalHeating = 0;
      if (lat >= 0) {
        meridionalHeating = -v * 12.0; // [°C] proporcjonalne do prędkości prądu
      } else {
        meridionalHeating = v * 12.0;
      }

      // Ograniczenie anomalii do realistycznego zakresu fizycznego [-8°C, +8°C]
      sstAnomaly[i] = Math.max(-8, Math.min(8, meridionalHeating));
    }

    // Wygładzenie pola anomalii SST nad wodą
    this.barrierAwareSmooth(sstAnomaly, cells.c, cells.h, 0.3, 2);
  }

  /**
   * Wygładzanie Laplacjańskie respektujące bariery ląd/woda (barrier-aware smoothing).
   * Miesza wartości tylko pomiędzy komórkami o tym samym typie ośrodka (morze z morzem).
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
          const neighbor = nb[j];
          if (heights[neighbor] < 20) {
            sumVal += field[neighbor];
            waterCount++;
          }
        }

        if (waterCount > 0) {
          const meanVal = sumVal / waterCount;
          temp[i] = (1 - alpha) * field[i] + alpha * meanVal;
        } else {
          temp[i] = field[i];
        }
      }
      field.set(temp);
    }
  }
}

export const OceanEngine = new OceanEngineModule();
