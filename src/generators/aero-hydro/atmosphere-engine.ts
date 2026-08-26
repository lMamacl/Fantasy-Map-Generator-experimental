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
const GEOSTROPHIC_SCALE = 14.0;
/** Skala składowej cross-isobar (przeskok ciśnieniowy prostopadły do izobary) */
const CROSS_ISOBAR_SCALE = 8.0;
/** Perturbacja termiczna lądu — niż kontynentalny [hPa], uśredniony rocznie */
const LAND_THERMAL_PRESSURE = -2.5;
/** Perturbacja termiczna oceanu — stabilniejsze ciśnienie [hPa] */
const OCEAN_THERMAL_PRESSURE = 1.0;

/**
 * Domyślne kierunki wiatrów na Ziemi (kąty FMG: 0°=N, 90°=E, 180°=S, 270°=W):
 * Tier 0 (60-90°N): Polar Easterlies → 45° (NE)
 * Tier 1 (30-60°N): Westerlies → 225° (SW)
 * Tier 2 (0-30°N): Trade Winds NE → 45° (NE)
 * Tier 3 (0-30°S): Trade Winds SE → 315° (NW)
 * Tier 4 (30-60°S): Westerlies → 135° (SE)
 * Tier 5 (60-90°S): Polar Easterlies → 315° (NW)
 */
const DEFAULT_WIND_ANGLES = [45, 225, 45, 315, 135, 315];

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
    // W meteorologii wiatr geostroficzny wynika z gradientu MSLP (Mean Sea Level Pressure).
    // Surowy spadek barometryczny na wysokości (-70 hPa na szczytach) nie generuje huraganów
    // o prędkości 3000 m/s na graniach — wiatr opływa góry mechanicznie.
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

      // Ciśnienie na poziomie morza (MSLP) — to ono definiuje pole baryczne i izobary synoptyczne
      pressure[i] = pZonal + pThermal + pWindHint + pCenters;
    }

    // 3. Wygładzenie Laplacjanem ciśnienia synoptycznego
    laplacianSmooth(pressure, cells.c, 0.08, 2);

    // ─── 4. Wektory wiatru (Planetary Background + Geostrophic Perturbation + Orografia) ───
    const omega = 7.2921e-5; // prędkość kątowa Ziemi [rad/s]

    for (let i = 0; i < n; i++) {
      const [x, y] = points[i];
      const neigh = cells.c[i] || [];
      const p_i = pressure[i];
      const h_i = cells.h[i];
      const isL = h_i >= 20;

      // 4a. Planetarny wiatr tła (Prevailing Planetary Wind) wg strefy i options.winds
      const lat = mapCoordinates.latN - (y / graphHeight) * mapCoordinates.latT;
      const windTier = this.getWindTier(lat);
      const userAngle = winds[windTier] ?? DEFAULT_WIND_ANGLES[windTier];
      const userRad = (userAngle * Math.PI) / 180;
      // FMG kąt wiatru: kąt skąd wieje (0=N, 90=E, 180=S, 270=W)
      // Zwrot wektora prędkości (dokąd wieje): dirX = sin(userRad), dirY = -cos(userRad)
      const dirToX = Math.sin(userRad);
      const dirToY = -Math.cos(userRad);
      const basePlanetarySpeed = isL ? 3.8 : 6.2;
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
      const surfaceSpeedFactor = isL ? 0.7 : 1.2;
      const crossIsobarFactor = isL ? 0.35 : 0.1;

      // Składowa geostroficzna z gradientu ciśnienia synoptycznego
      const geoScale = GEOSTROPHIC_SCALE * coriolisFactor;
      const u_geo = (-gradY * geoScale * latSign + gradX * (crossIsobarFactor * CROSS_ISOBAR_SCALE)) * surfaceSpeedFactor;
      const v_geo = (gradX * geoScale * latSign + gradY * (crossIsobarFactor * CROSS_ISOBAR_SCALE)) * surfaceSpeedFactor;

      // Całkowity wiatr = tło planetarne + perturbacja baryczna
      let u = bgU + u_geo;
      let v = bgV + v_geo;

      // ─── 4c. Mechaniczna blokada i opływanie grzbietów górskich ───────
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
          const barrierSeverity = Math.min(Math.max((maxNeighborH - 30) / 45, 0), 1.0);
          const deflectFactor = barrierSeverity * Math.min(uphillDot / Math.max(currentSpeed, 0.1), 1.0);

          u = u * (1.0 - deflectFactor * 0.8) + tangX * currentSpeed * deflectFactor;
          v = v * (1.0 - deflectFactor * 0.8) + tangY * currentSpeed * deflectFactor;
        }

        // Efekt Venturiego w obniżeniach terenu między szczytami
        if (h_i >= 30 && h_i < 65) {
          let higherNeighCount = 0;
          for (let k = 0; k < neigh.length; k++) {
            if (cells.h[neigh[k]] > h_i + 15) higherNeighCount++;
          }
          if (higherNeighCount >= 2) {
            u *= 1.25;
            v *= 1.25;
          }
        }
      }

      // Tarcie na dużych wysokościach n.p.m.
      if (h_i > 60) {
        const altDamp = Math.max(0.4, 1.0 - (h_i - 60) / 120);
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
    laplacianSmooth(windU, cells.c, 0.08, 1);
    laplacianSmooth(windV, cells.c, 0.08, 1);

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

    const centers: BaricCenter[] = [
      {
        x: graphWidth * 0.22,
        y: graphHeight * 0.3,
        type: "high",
        pressureHPa: 1030,
        radiusKm: 2100,
        thermalOrigin: false
      },
      {
        x: graphWidth * 0.75,
        y: graphHeight * 0.32,
        type: "low",
        pressureHPa: 988,
        radiusKm: 1800,
        thermalOrigin: false
      },
      {
        x: graphWidth * 0.48,
        y: graphHeight * 0.8,
        type: "high",
        pressureHPa: 1028,
        radiusKm: 2000,
        thermalOrigin: false
      }
    ];

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
          pressureHPa: isCold ? 1026 : 998,
          radiusKm: 1100,
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
