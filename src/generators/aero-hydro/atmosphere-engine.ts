/**
 * Silnik atmosfery Aero-Hydro 2.0.
 *
 * Generuje 2D pole ciśnienia barycznego P(x,y) oraz wektory wiatru metodą
 * Green-Gauss FVM z regularyzacją Coriolisa, tarciem przyziemnym i orografią.
 *
 * Reakcja na rzeźbę terenu (orografię):
 *   - Ciśnienie powierzchniowe spada z wysokością n.p.m. wg wzoru barometrycznego.
 *   - Dynamiczne spiętrzenie nawietrzne (windward ridge: +ciśnienie przed granią).
 *   - Bruzda zawietrzna (lee trough: -ciśnienie za granią).
 *   - Mechaniczna blokada orograficzna: wiatr omija góry wzdłuż poziomic/dolin
 *     zamiast wiać prosto w litą ścianę skalną.
 *   - Efekt Venturiego / Gap Winds: przyspieszenie w przełęczach i wąskich gardłach.
 *
 * @module generators/aero-hydro/atmosphere-engine
 */

import { type AtmosphereConfig, type BaricCenter, defaultAtmosphereConfig } from "@/types/aero-hydro";
import { gridCellsToKm, laplacianSmooth } from "@/utils/grid-math";

// ─── Named Constants ──────────────────────────────────────────────────────────

/** Skala konwersji gradientu ciśnienia → prędkość wiatru geostroficznego [m/s per hPa/cell] */
const GEOSTROPHIC_SCALE = 16.0;
/** Skala składowej cross-isobar (przeskok ciśnieniowy prostopadły do izobary) */
const CROSS_ISOBAR_SCALE = 6.0;
/** Perturbacja termiczna lądu — niż kontynentalny [hPa], uśredniony rocznie */
const LAND_THERMAL_PRESSURE = -2.5;
/** Perturbacja termiczna oceanu — stabilniejsze ciśnienie [hPa] */
const OCEAN_THERMAL_PRESSURE = 1.0;

/**
 * Domyślne kierunki wiatrów FMG (kąty zwrotu wektora "dokąd wiatr zmierza"):
 * 0°=N, 45°=NE, 90°=E, 135°=SE, 180°=S, 225°=SW, 270°=W, 315°=NW
 * Tier 0 (60-90°N): Polar Easterlies → wieją na SW (225°)
 * Tier 1 (30-60°N): Westerlies       → wieją na E/NE (45°/90°)
 * Tier 2 (0-30°N):  Trade Winds NE   → wieją na SW (225°)
 * Tier 3 (0-30°S):  Trade Winds SE   → wieją na NW (315°)
 * Tier 4 (30-60°S): Westerlies       → wieją na SE (135°)
 * Tier 5 (60-90°S): Polar Easterlies → wieją na NW (315°)
 */
const DEFAULT_WIND_ANGLES = [225, 45, 225, 315, 135, 315];

/** Siła modyfikacji ciśnienia przez options.winds hint [hPa] */
const WIND_HINT_STRENGTH = 3.0;

export class AtmosphereEngineModule {
  generate(customConfig?: Partial<AtmosphereConfig>): void {
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
    const config: AtmosphereConfig = {
      ...defaultAtmosphereConfig(),
      ...(options.atmosphere || {}),
      ...(customConfig || {})
    };

    const graphWidth = (globalThis as any).graphWidth ?? 1000;
    const graphHeight = (globalThis as any).graphHeight ?? 1000;
    const winds: number[] = options.winds || DEFAULT_WIND_ANGLES;

    // Automatyczna generacja centrów barycznych, gdy puste
    if (!config.baricCenters || config.baricCenters.length === 0) {
      config.baricCenters = this.autoGenerateBaricCenters();
    }

    const n = grid.cells.i.length;
    const { cells, points } = grid;
    const spacing = grid.spacing ?? 10;

    // 1. Alokacja buforów
    if (!cells.pressure || cells.pressure.length !== n) {
      cells.pressure = new Float32Array(n);
      cells.windU = new Float32Array(n);
      cells.windV = new Float32Array(n);
      cells.windSpeed = new Float32Array(n);
    }
    cells.pressureHPa = cells.pressure;

    const pressure = cells.pressure;
    const windU = cells.windU;
    const windV = cells.windV;
    const windSpeed = cells.windSpeed;

    const kmPerCell = Math.max(gridCellsToKm(1), 0.1);
    const isLand = (i: number) => cells.h[i] >= 20;

    // ─── 2. Ciśnienie zredukowane do poziomu morza (MSLP), centra baryczne i wind hints ───
    for (let i = 0; i < n; i++) {
      const [x, y] = points[i];
      const lat = mapCoordinates.latN - (y / graphHeight) * mapCoordinates.latT;
      const absLat = Math.abs(lat);

      // 2a. Profil strefowy na poziomie morza [hPa]
      const pZonal = this.calculateZonalPressure(absLat, config.zonalPressureHPa);

      // 2b. Perturbacja termiczna ląd ↔ morze [hPa]
      let pThermal = 0;
      if (isLand(i)) {
        const thermalStrength = Math.cos((absLat * Math.PI) / 180);
        pThermal = LAND_THERMAL_PRESSURE * thermalStrength;
      } else {
        pThermal = OCEAN_THERMAL_PRESSURE;
      }

      // 2c. Wind hint z options.winds[] — synoptyczna modyfikacja ciśnienia
      const windTier = this.getWindTier(lat);
      const userAngle = winds[windTier] ?? DEFAULT_WIND_ANGLES[windTier];
      const defaultAngle = DEFAULT_WIND_ANGLES[windTier];
      const pWindHint = this.calculateWindHintPressure(userAngle, defaultAngle, x, y, graphWidth, graphHeight);

      // 2d. Nadkład centrów barycznych (High/Low)
      let pCenters = 0;
      if (config.baricCenters?.length) {
        for (const c of config.baricCenters) {
          const dx = x - c.x;
          const dy = y - c.y;
          const distPx = Math.hypot(dx, dy);
          const distKm = (distPx / spacing) * kmPerCell;
          const radiusKm = Math.max(c.radiusKm, 10);

          if (distKm < radiusKm * 3) {
            const sigmaKm = radiusKm * 0.5;
            const gauss = Math.exp(-(distKm * distKm) / (2 * sigmaKm * sigmaKm));
            const deltaP = c.pressureHPa - pZonal;
            pCenters += deltaP * gauss;
          }
        }
      }

      pressure[i] = pZonal + pThermal + pWindHint + pCenters;
    }

    // 3. Wygładzenie Laplacjanem ciśnienia synoptycznego
    laplacianSmooth(pressure, cells.c, 0.08, 2);

    // ─── 4. Wektory wiatru (Planetary Background + Geostrophy + Terrain + Synoptic Vorticity) ───
    const omega = 7.2921e-5; // prędkość kątowa Ziemi [rad/s]

    // Skala falowa dla szumu synoptycznego (fale Rossby'ego / meandry)
    const waveKx = (2 * Math.PI) / Math.max(graphWidth * 0.6, 100);
    const waveKy = (2 * Math.PI) / Math.max(graphHeight * 0.5, 100);

    for (let i = 0; i < n; i++) {
      const [x, y] = points[i];
      const neigh = cells.c[i] || [];
      const p_i = pressure[i];
      const h_i = cells.h[i];
      const isL = h_i >= 20;

      // 4a. Łagodne tło planetarne (Prevailing Drift) jako tendencja wyjściowa
      const lat = mapCoordinates.latN - (y / graphHeight) * mapCoordinates.latT;
      const windTier = this.getWindTier(lat);
      const userAngle = winds[windTier] ?? DEFAULT_WIND_ANGLES[windTier];
      const userRad = (userAngle * Math.PI) / 180;
      const dirToX = Math.sin(userRad);
      const dirToY = -Math.cos(userRad);
      const basePlanetarySpeed = isL ? 1.0 : 1.8;
      const bgU = dirToX * basePlanetarySpeed;
      const bgV = dirToY * basePlanetarySpeed;

      // 4b. Gradient MSLP (Green-Gauss na komórce Voronoi)
      let gradX = 0;
      let gradY = 0;
      let gradHx = 0;
      let gradHy = 0;

      for (let k = 0; k < neigh.length; k++) {
        const nIdx = neigh[k];
        const [nx, ny] = points[nIdx];
        const dx = nx - x;
        const dy = ny - y;
        const dist = Math.hypot(dx, dy) || 1;
        gradX += ((pressure[nIdx] - p_i) * dx) / dist;
        gradY += ((pressure[nIdx] - p_i) * dy) / dist;
        gradHx += ((cells.h[nIdx] - h_i) * dx) / dist;
        gradHy += ((cells.h[nIdx] - h_i) * dy) / dist;
      }
      const nLen = Math.max(neigh.length, 1);
      gradX /= nLen;
      gradY /= nLen;
      gradHx /= nLen;
      gradHy /= nLen;

      // Parametr Coriolisa
      const latRad = (lat * Math.PI) / 180;
      const fCoriolis = Math.max(Math.abs(2 * omega * Math.sin(latRad)), config.coriolisFloor);
      const coriolisFactor = Math.min(Math.abs(2 * omega) / fCoriolis, 2.5);
      const latSign = lat >= 0 ? 1 : -1;

      // Współczynniki oporu podłoża
      const surfaceSpeedFactor = isL ? 0.75 : 1.25;
      const crossIsobarFactor = isL ? 0.30 : 0.10;

      // Składowa geostroficzna z gradientu ciśnienia synoptycznego
      const geoScale = GEOSTROPHIC_SCALE * coriolisFactor;
      const u_geo =
        (gradY * geoScale * latSign - gradX * (crossIsobarFactor * CROSS_ISOBAR_SCALE)) * surfaceSpeedFactor;
      const v_geo =
        (-gradX * geoScale * latSign - gradY * (crossIsobarFactor * CROSS_ISOBAR_SCALE)) * surfaceSpeedFactor;

      // 4c. Synoptyczna wirowość (Divergence-free curl meanders)
      // Wprowadza naturalną zmienność, fale i organiczny chaos bez równoległych strzałek
      const u_vort = -Math.sin(x * waveKx + 0.3) * Math.cos(y * waveKy + 0.8) * 1.5;
      const v_vort = Math.cos(x * waveKx + 0.3) * Math.sin(y * waveKy + 0.8) * 1.5;

      // Całkowity wiatr bazowy
      let u = bgU + u_geo + u_vort;
      let v = bgV + v_geo + v_vort;

      // ─── 4d. Mechaniczna blokada i opływanie grzbietów górskich ───────
      const hGradLen = Math.hypot(gradHx, gradHy);
      if (hGradLen > 0.005) {
        const normHx = gradHx / hGradLen; // normalna W GÓRĘ stoku
        const normHy = gradHy / hGradLen;
        const uphillDot = u * normHx + v * normHy;

        let tangX = -normHy;
        let tangY = normHx;
        if (u * tangX + v * tangY < 0) {
          tangX = -tangX;
          tangY = -tangY;
        }

        const currentSpeed = Math.hypot(u, v);

        if (uphillDot > 0) {
          const maxNeighborH = Math.max(...neigh.map((idx: number) => cells.h[idx]));
          const barrierSeverity = Math.min(Math.max((maxNeighborH - 25) / 40, 0), 1.0);
          const deflectFactor = barrierSeverity * Math.min(uphillDot / Math.max(currentSpeed, 0.1), 1.0);

          // Przekierowanie wektora ze stoku na kierunek styczny do poziomicy
          u = u * (1.0 - deflectFactor * 0.85) + tangX * currentSpeed * (deflectFactor * 0.85);
          v = v * (1.0 - deflectFactor * 0.85) + tangY * currentSpeed * (deflectFactor * 0.85);
        }

        // Efekt Venturiego w obniżeniach terenu / przełęczach między szczytami
        if (h_i >= 25 && h_i < 65) {
          let higherNeighCount = 0;
          for (let k = 0; k < neigh.length; k++) {
            if (cells.h[neigh[k]] > h_i + 12) higherNeighCount++;
          }
          if (higherNeighCount >= 2) {
            u *= 1.35;
            v *= 1.35;
          }
        }
      }

      // Tarcie na dużych wysokościach n.p.m.
      if (h_i > 65) {
        const altDamp = Math.max(0.4, 1.0 - (h_i - 65) / 100);
        u *= altDamp;
        v *= altDamp;
      }

      // Capping prędkości do fizycznych granic (maks. 32 m/s ~ 115 km/h)
      const spd = Math.hypot(u, v);
      if (spd > 32.0) {
        u = (u / spd) * 32.0;
        v = (v / spd) * 32.0;
      }

      windU[i] = u;
      windV[i] = v;
    }

    // 5. Delikatne wygładzenie pól wektorowych
    laplacianSmooth(windU, cells.c, 0.06, 1);
    laplacianSmooth(windV, cells.c, 0.06, 1);

    for (let i = 0; i < n; i++) {
      windSpeed[i] = Math.hypot(windU[i], windV[i]);
    }
  }

  // ─── Pomocnicze ─────────────────────────────────────────────────────

  getWindTier(lat: number): number {
    if (lat >= 60) return 0;
    if (lat >= 30) return 1;
    if (lat >= 0) return 2;
    if (lat >= -30) return 3;
    if (lat >= -60) return 4;
    return 5;
  }

  private calculateWindHintPressure(
    userAngle: number,
    defaultAngle: number,
    x: number,
    y: number,
    graphWidth: number,
    graphHeight: number
  ): number {
    const angleDiff = ((userAngle - defaultAngle + 540) % 360) - 180;
    if (Math.abs(angleDiff) < 5) return 0;

    const userRad = (userAngle * Math.PI) / 180;
    const fromX = -Math.sin(userRad);
    const fromY = Math.cos(userRad);

    const relX = (x / graphWidth) * 2 - 1;
    const relY = (y / graphHeight) * 2 - 1;
    const projection = relX * fromX + relY * fromY;
    const strength = WIND_HINT_STRENGTH * Math.min(Math.abs(angleDiff) / 180, 1.0);
    return projection * strength;
  }

  calculateZonalPressure(absLat: number, zonal: [number, number, number, number]): number {
    const [pITCZ, pHigh, pLow, pPolar] = zonal;

    if (absLat <= 30) {
      const t = absLat / 30;
      const s = (1 - Math.cos(t * Math.PI)) * 0.5;
      return pITCZ + (pHigh - pITCZ) * s;
    }
    if (absLat <= 60) {
      const t = (absLat - 30) / 30;
      const s = (1 - Math.cos(t * Math.PI)) * 0.5;
      return pHigh + (pLow - pHigh) * s;
    }
    {
      const t = Math.min((absLat - 60) / 30, 1.0);
      const s = (1 - Math.cos(t * Math.PI)) * 0.5;
      return pLow + (pPolar - pLow) * s;
    }
  }

  autoGenerateBaricCenters(): BaricCenter[] {
    const grid = (globalThis as any).grid;
    const graphWidth = (globalThis as any).graphWidth ?? 1000;
    const graphHeight = (globalThis as any).graphHeight ?? 1000;
    const mapCoordinates = (globalThis as any).mapCoordinates || {
      latN: 60,
      latS: -60,
      latT: 120,
      lonW: -90,
      lonE: 90,
      lonT: 180
    };

    const latN = mapCoordinates.latN ?? 60;
    const latS = mapCoordinates.latS ?? -60;
    const latT = Math.max(mapCoordinates.latT ?? 120, 1);
    const lonW = mapCoordinates.lonW ?? -90;
    const lonT = Math.max(mapCoordinates.lonT ?? 180, 1);

    const latToY = (lat: number) => ((latN - lat) / latT) * graphHeight;
    const lonToX = (lon: number) => ((lon - lonW) / lonT) * graphWidth;

    const centers: BaricCenter[] = [];

    // 1. Wyż Podzwrotnikowy (np. Wyż Azorski / Północnoatlantycki ~32-38°N na zachód od lądu)
    // Gdy mapa jest wycinkiem regionalnym (np. Fate lonW=5.4°E), wyż leży na zachód od krawędzi (w ghost domain x < 0)
    const azoresLat = 35.0;
    const azoresLon = lonW < -20 ? -28.0 : lonW - Math.max(lonT * 0.35, 20.0);
    centers.push({
      x: lonToX(azoresLon),
      y: latToY(azoresLat),
      type: "high",
      pressureHPa: 1026,
      radiusKm: 2800,
      thermalOrigin: false
    });

    // 2. Niż Subpolarny / Atlantycki (np. Niż Islandzki ~60-64°N na północnym zachodzie)
    const icelandLat = 62.0;
    const icelandLon = lonW < -20 ? -20.0 : lonW - Math.max(lonT * 0.3, 18.0);
    centers.push({
      x: lonToX(icelandLon),
      y: latToY(icelandLat),
      type: "low",
      pressureHPa: 998,
      radiusKm: 3000,
      thermalOrigin: false
    });

    if (grid?.cells?.h && grid?.points) {
      let landX = 0;
      let landY = 0;
      let landCount = 0;
      const n = grid.cells.i.length;
      for (let i = 0; i < n; i++) {
        if (grid.cells.h[i] >= 20) {
          landX += grid.points[i][0];
          landY += grid.points[i][1];
          landCount++;
        }
      }
      if (landCount > 50) {
        const avgX = landX / landCount;
        const avgY = landY / landCount;
        const lat = mapCoordinates.latN - (avgY / graphHeight) * mapCoordinates.latT;
        const isCold = Math.abs(lat) > 50;
        centers.push({
          x: Math.round(avgX),
          y: Math.round(avgY),
          type: isCold ? "high" : "low",
          pressureHPa: isCold ? 1024 : 1002,
          radiusKm: 1400,
          thermalOrigin: true
        });
      }
    }

    let options = (globalThis as any).options;
    if (!options) {
      options = {};
      (globalThis as any).options = options;
    }
    if (!options.atmosphere) options.atmosphere = {};
    options.atmosphere.baricCenters = centers;
    return centers;
  }
}

export const AtmosphereEngine = new AtmosphereEngineModule();
