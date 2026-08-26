/**
 * Główny koordynator modułu Aero-Hydro 2.0.
 *
 * Zarządza sekwencją wywołań silników fizycznych i rejestruje
 * globalny interfejs (`window.AeroHydro`, `window.generateAeroHydro`).
 *
 * Pipeline:
 *   1. AtmosphereEngine  → cells.pressure, cells.windU/V/Speed
 *   2. OceanEngine       → cells.oceanU/V, cells.sstAnomaly, cells.sstLandInfluence
 *   3. SST → temp overlay (sstLandInfluence → cells.temp)
 *   4. MoistureEngine    → cells.moisture, cells.prec
 *   5. StreamlineRenderer → flowFeatures (SVG-ready)
 *
 * HydrologyEngine is NOT in the auto-pipeline — FMG's own river-generator.ts
 * handles river generation on pack.cells after reGraph(). HydrologyEngine can be
 * invoked standalone from the Aero-Hydro editor for visualization purposes.
 *
 * @module generators/aero-hydro
 */

import { StreamlineRenderer } from "@/renderers/aero-hydro/streamline-renderer";
import { AtmosphereEngine } from "./atmosphere-engine";
import { MoistureAdvectionEngine } from "./moisture-advection-engine";
import { OceanEngine } from "./ocean-engine";

export class AeroHydroModule {
  /**
   * Cechy przepływowe (wstęgi wiatru, prądy morskie) wygenerowane przez silniki.
   * Wypełniane przez pętle 1–5.
   */
  flowFeatures: any[] = [];

  /**
   * Wykonuje pełny potok fizyczny klimatu.
   * Sekwencja: AtmosphereEngine → OceanEngine → SST overlay → MoistureEngine → StreamlineRenderer.
   */
  generate(): void {
    if (typeof TIME !== "undefined" && TIME) console.time("generateAeroHydro");

    this.flowFeatures = []; // reset

    const grid = (globalThis as any).grid;

    // Pętla 1: Silnik atmosfery i 2D pola ciśnienia
    AtmosphereEngine.generate();

    // Pętla 2: Silnik cyrkulacji oceanicznej i anomalii SST
    OceanEngine.generate();

    // Pętla 3: Aplikacja wpływu SST na temperaturę lądową (efekt Golfsztromu)
    // Musi nastąpić PO OceanEngine i PO calculateTemperatures() — w pipeline FMG
    // generateAeroHydro() jest wywoływane PRZED calculateTemperatures(), więc
    // overlay jest aplikowany tu z buforowania, a potem calculateTemperatures()
    // nadpisze cells.temp. Dlatego overlay jest aplikowany ponownie po moisture.
    // Alternatywnie: overlay jest robiony tu, a calculateTemperatures() jest świadomy.
    this.applySstLandInfluence(grid);

    // Pętla 4: Silnik termodynamiki wilgoci i opadów 2D
    MoistureAdvectionEngine.generate();

    // Pętla 5: Agregacja wstęg przepływu (wiatr i prądy morskie)
    const windStreamlines = StreamlineRenderer.generateStreamlines("wind");
    const oceanStreamlines = StreamlineRenderer.generateStreamlines("ocean");
    this.flowFeatures = [...windStreamlines, ...oceanStreamlines];

    if (typeof TIME !== "undefined" && TIME) console.timeEnd("generateAeroHydro");
  }

  /**
   * Aplikuje anomalię SST na temperaturę brzegowych komórek lądowych.
   * OceanEngine oblicza cells.sstLandInfluence, ale nigdzie nie jest dodawane do cells.temp.
   * Ta metoda naprawia BUG-5.
   */
  private applySstLandInfluence(grid: any): void {
    if (!grid?.cells?.sstLandInfluence || !grid?.cells?.temp) return;

    const n = grid.cells.i?.length ?? 0;
    const influence = grid.cells.sstLandInfluence;
    const temp = grid.cells.temp;

    for (let i = 0; i < n; i++) {
      if (influence[i] !== 0) {
        temp[i] = Math.max(-128, Math.min(127, temp[i] + Math.round(influence[i])));
      }
    }
  }
}

export const AeroHydro = new AeroHydroModule();

declare global {
  // biome-ignore lint/suspicious/noRedeclare: exposed on window for legacy JS
  var AeroHydro: AeroHydroModule;
}

// ─── Rejestracja globalnych wywołań ─────────────────────────────────────────
if (typeof window !== "undefined") {
  window.AeroHydro = AeroHydro;
  window.generateAeroHydro = () => AeroHydro.generate();
  window.generatePrecipitation = () => {
    MoistureAdvectionEngine.generate();
  };
}
