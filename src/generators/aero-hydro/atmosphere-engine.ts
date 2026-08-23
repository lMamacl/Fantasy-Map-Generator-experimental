/**
 * Silnik atmosfery Aero-Hydro 2.0.
 *
 * Generuje 2-wymiarowe pole ciśnienia barycznego P(x,y)
 * oraz wyprowadza wektory wiatru metodą Green-Gauss FVM z regularyzacją Coriolisa,
 * tarciem przyziemnym i orografią (dokładna zgodność z geofizycznym demo).
 *
 * @module generators/aero-hydro/atmosphere-engine
 */

import { type AtmosphereConfig, defaultAtmosphereConfig } from "@/types/aero-hydro";
import { gridCellsToKm, laplacianSmooth } from "@/utils/grid-math";

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

    // Automatyczna generacja centrów barycznych, gdy puste
    if (!config.baricCenters || config.baricCenters.length === 0) {
      config.baricCenters = [
        {
          x: graphWidth * 0.22,
          y: graphHeight * 0.3,
          type: "high",
          pressureHPa: 1030,
          radiusKm: 1800,
          thermalOrigin: false
        },
        {
          x: graphWidth * 0.75,
          y: graphHeight * 0.32,
          type: "low",
          pressureHPa: 988,
          radiusKm: 1600,
          thermalOrigin: false
        },
        {
          x: graphWidth * 0.48,
          y: graphHeight * 0.8,
          type: "high",
          pressureHPa: 1028,
          radiusKm: 1700,
          thermalOrigin: false
        }
      ];
      if (!options.atmosphere) options.atmosphere = {};
      options.atmosphere.baricCenters = config.baricCenters;
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

    // ─── 2. Ciśnienie bazowe i centra baryczne ───────────────────────────
    for (let i = 0; i < n; i++) {
      const [x, y] = points[i];
      const lat = mapCoordinates.latN - (y / graphHeight) * mapCoordinates.latT;
      const absLat = Math.abs(lat);

      // 2a. Profil strefowy [hPa]
      const pZonal = this.calculateZonalPressure(absLat, config.zonalPressureHPa);

      // 2b. Perturbacja termiczna ląd ↔ morze [hPa]
      let pThermal = 0;
      if (isLand(i)) {
        const thermalStrength = Math.cos((absLat * Math.PI) / 180);
        pThermal = -3.5 * thermalStrength;
      } else {
        pThermal = +1.5;
      }

      // 2c. Nadkład centrów barycznych
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

      pressure[i] = pZonal + pThermal + pCenters;
    }

    // 3. Wygładzenie Laplacjanem
    laplacianSmooth(pressure, cells.c, 0.05, 1);

    // ─── 4. Wektory wiatru (FVM Green-Gauss + Coriolis + Friction + Orography) ───
    for (let i = 0; i < n; i++) {
      const [x, y] = points[i];
      const neigh = cells.c[i] || [];
      const p_i = pressure[i];
      const h_i = cells.h[i];

      let gradX = 0;
      let gradY = 0;
      for (let k = 0; k < neigh.length; k++) {
        const nIdx = neigh[k];
        const [nx, ny] = points[nIdx];
        const dx = nx - x;
        const dy = ny - y;
        const dist = Math.hypot(dx, dy) || 1;
        const dp = pressure[nIdx] - p_i;
        gradX += (dp * dx) / dist;
        gradY += (dp * dy) / dist;
      }
      gradX /= Math.max(neigh.length, 1);
      gradY /= Math.max(neigh.length, 1);

      const latSign = y < graphHeight * 0.5 ? 1 : -1;
      const isL = h_i >= 20;
      const friction = isL ? 0.32 : 0.12;

      let u = -gradY * 48 * latSign + gradX * (friction * 24);
      let v = gradX * 48 * latSign + gradY * (friction * 24);

      // Orograficzne opływanie grzbietów górskich
      if (h_i >= 65) {
        const alongY = (v > 0 ? 1 : -1) * Math.hypot(u, v) * 0.65;
        u *= 0.35;
        v = alongY;
      }

      const spd = Math.hypot(u, v);
      windU[i] = u;
      windV[i] = v;
      windSpeed[i] = spd;
    }
  }

  // ─── Pomocnicze ─────────────────────────────────────────────────────

  /**
   * Ciśnienie strefowe P_zonal(φ) interpolowane między 4 punktami łamanych:
   *   ITCZ (0°) → Subtropical High (30°) → Subpolar Low (60°) → Polar High (90°)
   */
  private calculateZonalPressure(absLat: number, zonal: [number, number, number, number]): number {
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
}

export const AtmosphereEngine = new AtmosphereEngineModule();
