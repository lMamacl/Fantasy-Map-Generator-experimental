/**
 * Główny koordynator modułu Aero-Hydro 2.0.
 *
 * Zarządza sekwencją wywołań silników fizycznych i rejestruje
 * globalny interfejs (`window.AeroHydro`, `window.generateAeroHydro`).
 *
 * @module generators/aero-hydro
 */

import { StreamlineRenderer } from "@/renderers/aero-hydro/streamline-renderer";
import { AtmosphereEngine } from "./atmosphere-engine";
import { HydrologyEngine } from "./hydrology-engine";
import { MoistureAdvectionEngine } from "./moisture-advection-engine";
import { OceanEngine } from "./ocean-engine";

export class AeroHydroModule {
  /**
   * Cechy przepływowe (wstęgi wiatru, prądy morskie) wygenerowane przez silniki.
   * Wypełniane przez pętle 1–5.
   */
  flowFeatures: any[] = [];

  /**
   * Wykonuje pełny potok fizyczny klimatu i hydrologii.
   * Sekwencja: AtmosphereEngine → OceanEngine (P2) → MoistureEngine (P3) → HydrologyEngine (P4) → StreamlineRenderer (P5).
   */
  generate(): void {
    if (typeof TIME !== "undefined" && TIME) console.time("generateAeroHydro");

    this.flowFeatures = []; // reset

    // Pętla 1: Silnik atmosfery i 2D pola ciśnienia
    AtmosphereEngine.generate();

    // Pętla 2: Silnik cyrkulacji oceanicznej i anomalii SST
    OceanEngine.generate();

    // Pętla 3: Silnik termodynamiki wilgoci i opadów 2D
    MoistureAdvectionEngine.generate();

    // Pętla 4: Silnik hydrologii i geometrii rzek
    HydrologyEngine.generate();

    // Pętla 5: Agregacja wstęg przepływu (wiatr i prądy morskie)
    const windStreamlines = StreamlineRenderer.generateStreamlines("wind");
    const oceanStreamlines = StreamlineRenderer.generateStreamlines("ocean");
    this.flowFeatures = [...windStreamlines, ...oceanStreamlines];

    if (typeof TIME !== "undefined" && TIME) console.timeEnd("generateAeroHydro");
  }
}

export const AeroHydro = new AeroHydroModule();

declare global {
  // biome-ignore lint/suspicious/noRedeclare: exposed on window for legacy JS
  var AeroHydro: AeroHydroModule;
}

if (typeof window !== "undefined") {
  window.AeroHydro = AeroHydro;
}
