/**
 * Eulerowski silnik wilgoci i opadów klimatycznych (Aero-Hydro 3.0).
 *
 * Model stanu równowagi i adwekcji podwiatrowej (Upwind Advection + Continental Moisture Recycling):
 *   1. Woda oceaniczna oraz granice nawietrzne (Ghost Domain) stanowią stałe źródło
 *      nasyconej wilgoci W_ocean = e_s(T + SST).
 *   2. Transport wilgoci w głąb lądu realizowany jest metodą Upwind Dijkstra / Gauss-Seidel Sweep
 *      wzdłuż wektorów wiatru na fizycznej skali odległości (km).
 *   3. Continental Moisture Recycling (recykling ewapotranspiracyjny przez lasy i glebę)
 *      zwraca 30-45% opadu z powrotem do kolumny powietrza na dystansie 3000–4500 km.
 *   4. Opad orograficzny usuwa wilgoć w sposób zbilansowany z wznoszeniem wiatru (Smith & Barstad 2004),
 *      a na stokach zawietrznych spadek powietrza wywołuje kompresyjne ogrzanie i wysuszenie fenowe (Föhn effect),
 *      tworząc naturalny, głęboki cień opadowy na dystansie 150–350 km.
 *   5. Płynny profil osiadania zwrotnikowego (Hadley cell subsidence) zapobiega skokowym artefaktom,
 *      a zapis do `cells.prec` i `cells.precipMm` zapewnia pełną kompatybilność z biomami FMG.
 *
 * @module generators/aero-hydro/moisture-advection-engine
 */

import { defaultMoistureConfig, type MoistureConfig } from "@/types/aero-hydro";
import { gridCellsToKm, laplacianSmooth } from "@/utils/grid-math";

class BinaryHeap {
  private items: number[] = [];
  private priorities: number[] = [];

  push(item: number, priority: number): void {
    let i = this.items.length;
    this.items.push(item);
    this.priorities.push(priority);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.priorities[i] >= this.priorities[p]) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop(): number | undefined {
    if (this.items.length === 0) return undefined;
    const top = this.items[0];
    const lastItem = this.items.pop()!;
    const lastPriority = this.priorities.pop()!;
    if (this.items.length > 0) {
      this.items[0] = lastItem;
      this.priorities[0] = lastPriority;
      this.down(0);
    }
    return top;
  }

  get length(): number {
    return this.items.length;
  }

  private down(i: number): void {
    const len = this.items.length;
    while (true) {
      let best = i;
      const l = (i << 1) + 1;
      const r = l + 1;
      if (l < len && this.priorities[l] < this.priorities[best]) best = l;
      if (r < len && this.priorities[r] < this.priorities[best]) best = r;
      if (best === i) break;
      this.swap(i, best);
      i = best;
    }
  }

  private swap(a: number, b: number): void {
    const ti = this.items[a];
    this.items[a] = this.items[b];
    this.items[b] = ti;
    const tp = this.priorities[a];
    this.priorities[a] = this.priorities[b];
    this.priorities[b] = tp;
  }
}

export class MoistureAdvectionEngineModule {
  /**
   * Główna metoda generująca pole wilgoci i opadów rocznych w oparciu o fizyczne odległości (km).
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
    const mapCoordinates = (globalThis as any).mapCoordinates || {
      latN: 60,
      latS: -60,
      latT: 120,
      lonW: -90,
      lonE: 90,
      lonT: 180
    };
    const graphWidth = (globalThis as any).graphWidth ?? 1000;
    const graphHeight = (globalThis as any).graphHeight ?? 1000;

    // Przeliczniki pikseli na fizyczne kilometry w osi X i Y
    let kmPerPxX: number;
    let kmPerPxY: number;

    if ((globalThis as any).mapCoordinates?.lonT && (globalThis as any).mapCoordinates?.latT) {
      const mapWidthKm = (Math.max(mapCoordinates.lonT, 1) / 360) * 40075;
      const mapHeightKm = (Math.max(mapCoordinates.latT, 1) / 180) * 20004;
      kmPerPxX = mapWidthKm / Math.max(graphWidth, 1);
      kmPerPxY = mapHeightKm / Math.max(graphHeight, 1);
    } else {
      const kmPerCell = Math.max(gridCellsToKm(1), 1.0);
      const spacing = grid.spacing || 10;
      kmPerPxX = kmPerCell / spacing;
      kmPerPxY = kmPerCell / spacing;
    }

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
    const spacing = grid.spacing || 10;

    const getTemp = (i: number): number => {
      if (temp && typeof temp[i] === "number" && Number.isFinite(temp[i])) return temp[i];
      return 15;
    };

    const elevationM = (hVal: number): number => {
      if (hVal < 20) return 0;
      return 4800 * ((hVal - 20) / 80) ** 1.25;
    };

    // ─── Krok 1: Potencjał parowania oceanicznego (Clausius-Clapeyron + SST + Wiatr) ───
    const oceanMoisture = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      if (isWater(i)) {
        const baseTemp = getTemp(i);
        const sst = sstAnomaly ? sstAnomaly[i] : 0;
        const satVaporHPa = this.clausiusClapeyron(baseTemp + sst);
        const windSpeed = Math.hypot(windU ? windU[i] : 0, windV ? windV[i] : 0);
        const windBonus = 1.0 + Math.min(windSpeed * 0.03, 0.25);
        oceanMoisture[i] = satVaporHPa * windBonus;
        moisture[i] = oceanMoisture[i];
      } else {
        moisture[i] = 0;
      }
    }

    // ─── Krok 2: Makroregionalne pole wysokości w metrach dla strefy przedgórskiej (Foothills) ───
    const elevMacro = new Float32Array(n);
    for (let i = 0; i < n; i++) elevMacro[i] = elevationM(h[i]);
    for (let sm = 0; sm < 3; sm++) {
      laplacianSmooth(elevMacro, cells.c, 0.45, 1);
    }

    // ─── Krok 3: Wyznaczenie fizycznej odległości nawietrznej od wybrzeża (Dijkstra) ───
    const distFromCoastKm = new Float32Array(n);
    distFromCoastKm.fill(1e9);
    const pq = new BinaryHeap();

    // Inicjalizacja źródeł morskich oraz krawędzi nawietrznych (Ghost Domain marine inflow)
    for (let i = 0; i < n; i++) {
      const [xi] = points[i];
      const wu = windU ? windU[i] : 0;
      const isWestBoundaryInflow = xi <= spacing * 2.5 && wu > 0.4;

      if (isWater(i)) {
        distFromCoastKm[i] = 0;
        pq.push(i, 0);
      } else if (isWestBoundaryInflow) {
        // Dopływ wilgoci z Atlantyku leżącego na zachód poza krawędzią mapy
        distFromCoastKm[i] = 50.0;
        pq.push(i, 50.0);
        if (moisture[i] === 0) {
          const baseTemp = getTemp(i);
          moisture[i] = this.clausiusClapeyron(baseTemp) * 0.88;
        }
      }
    }

    while (pq.length > 0) {
      const u = pq.pop()!;
      const dCurr = distFromCoastKm[u];
      const [xi, yi] = points[u];
      const wu = windU ? windU[u] : 0;
      const wv = windV ? windV[u] : 0;
      const wSpeed = Math.hypot(wu, wv) || 1.0;

      const nb = cells.c[u];
      if (!nb) continue;

      for (let k = 0; k < nb.length; k++) {
        const v = nb[k];
        const [xj, yj] = points[v];
        const dxKm = (xj - xi) * kmPerPxX;
        const dyKm = (yj - yi) * kmPerPxY;
        const dStepKm = Math.hypot(dxKm, dyKm) || 0.1;

        const dirX = dxKm / dStepKm;
        const dirY = dyKm / dStepKm;
        const alignment = (wu * dirX + wv * dirY) / wSpeed;

        const cost = alignment > 0.05 ? dStepKm / (0.35 + 0.65 * alignment) : dStepKm * 3.5;
        const newDist = dCurr + cost;

        if (newDist < distFromCoastKm[v]) {
          distFromCoastKm[v] = newDist;
          pq.push(v, newDist);
        }
      }
    }

    // Sortowanie topologiczne według odległości od brzegu nawietrznego
    const sortedIndices = new Int32Array(n);
    for (let i = 0; i < n; i++) sortedIndices[i] = i;
    sortedIndices.sort((a, b) => distFromCoastKm[a] - distFromCoastKm[b]);

    // ─── Krok 4: Fizyczna adwekcja podwiatrowa z modelem Smith-Barstad i Föhnem ─────────
    const L_continental = 3200.0; // [km] fizyczna skala zaniku wilgoci wzdłuż strugi
    const foehnShadow = new Float32Array(n); // Współczynnik wysuszenia fenowego [0..1]

    for (let k = 0; k < n; k++) {
      const i = sortedIndices[k];
      if (isWater(i)) continue;

      const nb = cells.c[i];
      if (!nb || nb.length === 0) continue;

      const [xi, yi] = points[i];
      const wu_i = windU ? windU[i] : 0;
      const wv_i = windV ? windV[i] : 0;
      const wSpeed_i = Math.hypot(wu_i, wv_i) || 1.0;

      let fluxSum = 0;
      let weightSum = 0;

      let gradZx = 0;
      let gradZy = 0;
      let gradMacroX = 0;
      let gradMacroY = 0;

      for (let jIdx = 0; jIdx < nb.length; jIdx++) {
        const j = nb[jIdx];
        const [xj, yj] = points[j];

        const dxKm = (xj - xi) * kmPerPxX;
        const dyKm = (yj - yi) * kmPerPxY;
        const distKm = Math.hypot(dxKm, dyKm) || 0.1;

        if (distFromCoastKm[j] < distFromCoastKm[i]) {
          const dirFromJ_x = -dxKm / distKm;
          const dirFromJ_y = -dyKm / distKm;
          const dot = (wu_i * dirFromJ_x + wv_i * dirFromJ_y) / wSpeed_i; // [-1, 1]

          const w = Math.max(0.05, 0.5 + 0.5 * dot);
          const decay = Math.exp(-distKm / L_continental);
          fluxSum += moisture[j] * decay * w;
          weightSum += w;
        }

        const dz = elevationM(h[j]) - elevationM(h[i]);
        const dzMacro = elevMacro[j] - elevMacro[i];
        gradZx += (dz * dxKm) / (distKm * distKm);
        gradZy += (dz * dyKm) / (distKm * distKm);
        gradMacroX += (dzMacro * dxKm) / (distKm * distKm);
        gradMacroY += (dzMacro * dyKm) / (distKm * distKm);
      }

      const nbLen = nb.length;
      gradZx /= nbLen;
      gradZy /= nbLen;
      gradMacroX /= nbLen;
      gradMacroY /= nbLen;

      const advectedQ = weightSum > 0 ? fluxSum / weightSum : 10.0;

      // Continental Moisture Recycling: równowaga ewapotranspiracyjna zależna od strefy
      const latitude = mapCoordinates.latN - (yi / graphHeight) * mapCoordinates.latT;
      const absLat = Math.abs(latitude);

      // Płynny profil równowagi kontynentalnej (bez skoków)
      let qEquil = 10.5; // Strefa umiarkowana (600-800 mm lasy i łąki)
      if (absLat < 38.0) {
        const tSub = Math.max(0, Math.min(1, (absLat - 20.0) / 18.0));
        qEquil = 2.5 + 8.0 * (tSub ** 1.5); // 2.5 hPa na zwrotniku -> 10.5 hPa na 38°N
      }

      const effDistKm = Math.min(distFromCoastKm[i], 3500.0);
      const blend = 1.0 - Math.exp(-effDistKm / 2000.0);
      let recycledQ = advectedQ * (1.0 - blend * 0.35) + qEquil * (blend * 0.35);

      // Wymuszenie orograficzne (Smith & Barstad 2004)
      const wForcing = ((wu_i * (gradMacroX * 0.7 + gradZx * 0.3) + wv_i * (gradMacroY * 0.7 + gradZy * 0.3)) / 1000.0) * 60.0;

      if (wForcing > 0) {
        // Stok nawietrzny: kondensacja i ubytek wilgoci z kolumny powietrza
        const rainoutFraction = Math.min(0.85, wForcing * 0.08 * config.orographicBlockRate);
        recycledQ *= (1.0 - rainoutFraction);
      } else {
        // Stok zawietrzny: kompresyjne ogrzanie i wysuszenie fenowe
        const descent = Math.abs(wForcing);
        const localFoehn = Math.min(1.0, descent * 0.18 * config.foehnHeatingRate);
        foehnShadow[i] = Math.max(foehnShadow[i], localFoehn);
      }

      // Propagacja cienia fenowego wzdłuż linii prądu na dystans ~250 km
      if (foehnShadow[i] > 0.05) {
        for (let jIdx = 0; jIdx < nb.length; jIdx++) {
          const j = nb[jIdx];
          if (distFromCoastKm[j] > distFromCoastKm[i]) {
            const [xj, yj] = points[j];
            const dxKm = (xj - xi) * kmPerPxX;
            const dyKm = (yj - yi) * kmPerPxY;
            const dStepKm = Math.hypot(dxKm, dyKm) || 0.1;
            const dot = (wu_i * (dxKm / dStepKm) + wv_i * (dyKm / dStepKm)) / wSpeed_i;
            if (dot > 0.15) {
              const fDecay = Math.exp(-dStepKm / 240.0);
              foehnShadow[j] = Math.max(foehnShadow[j], foehnShadow[i] * fDecay * dot);
            }
          }
        }
      }

      // Ograniczenie wilgoci w cieniu fenowym
      recycledQ *= (1.0 - foehnShadow[i] * 0.50);

      // Granica kondensacyjna nasycenia kolumny powietrza na danej wysokości i temperaturze
      const tempI = getTemp(i);
      const altFactor = Math.exp(-elevationM(h[i]) / 5500.0);
      const airCap = this.clausiusClapeyron(tempI) * 1.35 * altFactor;

      moisture[i] = Math.min(recycledQ, airCap);
    }

    laplacianSmooth(moisture, cells.c, 0.06, 1);

    // ─── Krok 5: Obliczenie rocznego opadu z ustalonego stanu równowagi ───
    const precipMmYr = new Float32Array(n);
    const BASE_ANNUAL_FACTOR = 52.0;

    for (let i = 0; i < n; i++) {
      if (isWater(i)) {
        precipMmYr[i] = 600 * precModifier;
        continue;
      }

      const nb = cells.c[i];
      const [xi, yi] = points[i];
      const w_i = moisture[i];

      // 1. Opad nizinny frontalno-konwekcyjny z osiadaniem Hadley (Subtropical Ridge: Sahara 22-32°N)
      const latitude = mapCoordinates.latN - (yi / graphHeight) * mapCoordinates.latT;
      const absLat = Math.abs(latitude);

      let subsidence = 1.0;
      if (absLat >= 18.0 && absLat <= 36.0) {
        if (absLat >= 22.0 && absLat <= 32.0) {
          subsidence = 0.15; // Pas pustyń zwrotnikowych (Sahara / Płw. Arabski)
        } else if (absLat < 22.0) {
          const t = (22.0 - absLat) / 4.0;
          subsidence = 0.15 + 0.85 * Math.min(1.0, t ** 1.3);
        } else {
          const t = (absLat - 32.0) / 4.0;
          subsidence = 0.15 + 0.85 * Math.min(1.0, t ** 1.3);
        }
      } else if (absLat < 18.0) {
        subsidence = 1.0;
      }

      // Tłumienie opadu bazowego w cieniu fenowym
      const baseRain = w_i * BASE_ANNUAL_FACTOR * subsidence * (1.0 - foehnShadow[i] * 0.70);

      // 2. Opad orograficzny (strefa przedgórska + stoki górskie)
      let gradZx = 0;
      let gradZy = 0;
      let gradMacroX = 0;
      let gradMacroY = 0;

      if (nb && nb.length > 0) {
        for (let jIdx = 0; jIdx < nb.length; jIdx++) {
          const j = nb[jIdx];
          const [xj, yj] = points[j];
          const dxKm = (xj - xi) * kmPerPxX;
          const dyKm = (yj - yi) * kmPerPxY;
          const distKm = Math.hypot(dxKm, dyKm) || 0.1;
          const dz = elevationM(h[j]) - elevationM(h[i]);
          const dzMacro = elevMacro[j] - elevMacro[i];
          gradZx += (dz * dxKm) / (distKm * distKm);
          gradZy += (dz * dyKm) / (distKm * distKm);
          gradMacroX += (dzMacro * dxKm) / (distKm * distKm);
          gradMacroY += (dzMacro * dyKm) / (distKm * distKm);
        }
        gradZx /= nb.length;
        gradZy /= nb.length;
        gradMacroX /= nb.length;
        gradMacroY /= nb.length;
      }

      const wu_i = windU ? windU[i] : 0;
      const wv_i = windV ? windV[i] : 0;
      const wAscent = Math.max(
        0,
        ((wu_i * (gradMacroX * 0.7 + gradZx * 0.3) + wv_i * (gradMacroY * 0.7 + gradZy * 0.3)) / 1000.0) * 60.0
      );
      const oroRain = wAscent * w_i * 42.0 * config.orographicBlockRate;

      const totalRain = (baseRain + oroRain) * precModifier;
      precipMmYr[i] = Math.max(15, totalRain);
    }

    laplacianSmooth(precipMmYr, cells.c, 0.08, 1);

    // ─── Krok 6: Zapis do tablicy FMG cells.prec [0–255] i floatów ───
    const FMG_PREC_DIVISOR = 45; // 1 prec ≈ 45 mm/rok
    cells.precipMm = precipMmYr;

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
}

export const MoistureAdvectionEngine = new MoistureAdvectionEngineModule();
