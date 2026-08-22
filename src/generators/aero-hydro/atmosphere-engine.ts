/**
 * Silnik atmosfery Aero-Hydro 2.0.
 *
 * Generuje stacjonarne, 2-wymiarowe pole ciśnienia barycznego P(x,y)
 * oraz wyprowadza wektory wiatru (geostroficzne z regularyzacją Coriolisa,
 * skręceniem tarciowym przy ziemi i orograficznym odchyleniem wzdłuż barier).
 *
 * Fizyka odniesienia:
 *   - Ciśnienie strefowe: profil Hadleya/Ferrela/Polarnego [hPa]
 *   - Wiatr geostroficzny:  Vg = (1/ρ) · (1/f) · ∇P ⊥
 *   - Tarcie przyziemne:   rozkład między Vg (górna warstwa) a -∇P/|∇P|·|Vg| (przy ziemi)
 *   - Orografia:           odchylenie wzdłuż grzbietu gdy V·∇h > 0
 *
 * @module generators/aero-hydro/atmosphere-engine
 */

import { type AtmosphereConfig, defaultAtmosphereConfig } from "@/types/aero-hydro";
import { gridCellsToKm, laplacianSmooth, scalarGradient } from "@/utils/grid-math";

/** Gęstość powietrza na poziomie morza [kg/m³] */
const AIR_DENSITY = 1.225;

/** Prędkość kątowa obrotu planety [rad/s] */
const OMEGA = 7.2921e-5;

/**
 * Współczynnik skalujący geostrofię z gradientu hPa/px na m/s.
 * Wyprowadzony z 1/(ρ·f) dla typowych warunków:
 *   ρ = 1.225 kg/m³,  f = 1e-4 s⁻¹,  ∇P ≈ 1 hPa / 50 km
 *   ⇒ Vg ≈ (1/1.225)·(1/1e-4)·(100 Pa / 50000 m) ≈ 0.0163 m/s
 * Mnożnik 100 jest dodany ręcznie, by uzyskać widoczne na mapie wektory (1–25 m/s).
 */
const GEOSTROPHE_SCALE = 0.08;

/**
 * Silnik generujący stacjonarne pole ciśnienia i pole wiatrów przyziemnych.
 *
 * Wpisuje wyniki w `grid.cells` bezpośrednio:
 *   - `pressure`    – ciśnienie [hPa]
 *   - `windU`       – składowa X wiatru [m/s]
 *   - `windV`       – składowa Y wiatru [m/s]
 *   - `windSpeed`   – |V| [m/s]
 */
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

    const n = grid.cells.i.length;
    const { cells, points } = grid;
    const graphHeight = (globalThis as any).graphHeight ?? 1000;
    const spacing = grid.spacing ?? 10;

    // 1. Alokacja lub ponowne użycie TypedArrays
    if (!cells.pressure || cells.pressure.length !== n) {
      cells.pressure = new Float32Array(n);
      cells.windU = new Float32Array(n);
      cells.windV = new Float32Array(n);
      cells.windSpeed = new Float32Array(n);
    }

    const pressure = cells.pressure;
    const windU = cells.windU;
    const windV = cells.windV;
    const windSpeed = cells.windSpeed;

    // Metryka siatki [km/px] — jedno wyliczenie przed pętlą
    const kmPerCell = Math.max(gridCellsToKm(1), 0.1);
    const mPerPx = (kmPerCell / Math.max(spacing, 1)) * 1000;

    const isLand = (i: number) => cells.h[i] >= 20;

    // ─── 2. Ciśnienie bazowe ───────────────────────────────────────────
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

      // 2c. Nadkład centrów barycznych [hPa]
      //    Odległość w km, promień i sigma także w km — obliczenia w przestrzeni fizycznej.
      let pCenters = 0;
      if (config.baricCenters?.length) {
        for (const c of config.baricCenters) {
          const dx = x - c.x;
          const dy = y - c.y;
          const distPx = Math.sqrt(dx * dx + dy * dy);

          // Konwersja: piksele → komórki → km
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

    // 3. Wygładzenie Laplacjanem (slabe, by nie zatrzeć sygnału baricenterów)
    //  Parametry dobrane tak, by usunac szum wysokoczesztotliwosciowy
    //  bez kasowania gradientow dolnoczesztotliwosciowych (np. profil strefowy).
    laplacianSmooth(pressure, cells.c, 0.05, 1);

    // ─── 4. Wektory wiatru ────────────────────────────────────────────
    for (let i = 0; i < n; i++) {
      const [, y] = points[i];
      const lat = mapCoordinates.latN - (y / graphHeight) * mapCoordinates.latT;
      const phiRad = (lat * Math.PI) / 180;

      // Gradient ciśnienia [hPa/px]
      const [dpx, dpy] = scalarGradient(pressure, i, points, cells.c);

      // Coriolis z regularyzacją równikową
      const fRaw = 2 * OMEGA * Math.sin(phiRad);
      const fSign = lat >= 0 ? 1 : -1;
      const fReg = fSign * Math.sqrt(fRaw * fRaw + config.coriolisFloor * config.coriolisFloor);

      // Gradient w Pa/m
      const gradYPaM = (dpy * 100) / mPerPx;
      const gradXPaM = (dpx * 100) / mPerPx;

      // ─ 4a. Wiatr geostroficzny [m/s] ─
      let ug = -(1 / (AIR_DENSITY * fReg)) * gradYPaM * GEOSTROPHE_SCALE;
      let vg = (1 / (AIR_DENSITY * fReg)) * gradXPaM * GEOSTROPHE_SCALE;

      // Limit prędkości geostroficnej (buchta burzowa)
      const rawSpeed = Math.sqrt(ug * ug + vg * vg);
      if (rawSpeed > 35) {
        const norm = 35 / rawSpeed;
        ug *= norm;
        vg *= norm;
      }

      // ─ 4b. Tarcie przyziemne — rozkład wektorowy ─
      // Kąt pochylenia wektora wiatru względem izobary (Hargreaves, 1943)
      const land = isLand(i);
      const frictionDeg = land ? config.frictionAngleLand : config.frictionAngleOcean;
      const tanF = Math.tan(((frictionDeg * Math.PI) / 180) * fSign);

      // Rozkład: V_surf = Vg / (1 + tan²F) · (1, -tanF)  +  (tanF · |∇P|/|∇P|) · k
      // Uproszczona forma: skręcenie o kąt frikcji w stronę niżu
      const cosF = 1 / Math.sqrt(1 + tanF * tanF);
      const sinF = tanF * cosF;

      let uSurf = ug * cosF - vg * sinF;
      let vSurf = ug * sinF + vg * cosF;

      // Tłumienie tarciowe nad lądem (szorstkość powierzchni)
      if (land) {
        const dragFactor = 0.75;
        uSurf *= dragFactor;
        vSurf *= dragFactor;
      }

      // ─ 4c. Orograficzne odchylenie ─
      if (cells.h[i] > 60) {
        const [dhx, dhy] = scalarGradient(cells.h, i, points, cells.c);
        const slopeDot = uSurf * dhx + vSurf * dhy;

        // Tylko gdy wiatr wieje pod górę (energia kinet. → potencjalna)
        if (slopeDot > 0) {
          // Wektor styczny do grzbietu (równoległy do poziomicy)
          // Perpendicular to ∇h: (-dhy, dhx)  — prawoskrętny obrót o 90°
          const ridgeX = -dhy;
          const ridgeY = dhx;
          const rLen = Math.sqrt(ridgeX * ridgeX + ridgeY * ridgeY);
          if (rLen > 0.1) {
            const rX = ridgeX / rLen;
            const rY = ridgeY / rLen;

            // Projektacja V na kierunek grzbietu
            const vAlongRidge = uSurf * rX + vSurf * rY;

            // Tłumienie składowej prostopadłej, przeniesienie energii wzdłuż grzbietu
            const blend = 0.4;
            uSurf = uSurf * (1 - blend) + rX * Math.abs(vAlongRidge) * blend;
            vSurf = vSurf * (1 - blend) + rY * Math.abs(vAlongRidge) * blend;
          }
        }
      }

      // 4d. Pomiar końcowy
      const speed = Math.sqrt(uSurf * uSurf + vSurf * vSurf);

      windU[i] = uSurf;
      windV[i] = vSurf;
      windSpeed[i] = speed;
    }
  }

  // ─── Pomocnicze ─────────────────────────────────────────────────────

  /**
   * Ciśnienie strefowe P_zonal(φ) interpolowane między 4 punktami łamanych:
   *   ITCZ (0°) → Subtropical High (30°) → Subpolar Low (60°) → Polar High (90°)
   *
   * Łagodne przejścia (cosine blend) zapobiegają skokom na granicach stref.
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
