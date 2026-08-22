/**
 * Główny koordynator modułu Aero-Hydro 2.0.
 *
 * Zarządza sekwencją wywołań silników fizycznych i rejestruje
 * globalny interfejs (`window.AeroHydro`, `window.generateAeroHydro`).
 *
 * @module generators/aero-hydro
 */

import { AtmosphereEngine } from "./atmosphere-engine";
import { OceanEngine } from "./ocean-engine";

export class AeroHydroModule {
  /**
   * Cechy przepływowe (wstęgi wiatru, prądy morskie) wygenerowane przez silniki.
   * Wypełniane przez pętle 1–5.
   */
  flowFeatures: any[] = [];

  /**
   * Wykonuje pełny potok fizyczny klimatu i hydrologii.
   * Sekwencja: AtmosphereEngine → OceanEngine (P2) → MoistureEngine (P3) → HydrologyEngine (P4).
   */
  generate(): void {
    if (typeof TIME !== "undefined" && TIME) console.time("generateAeroHydro");

    this.flowFeatures = []; // reset

    // Pętla 1: Silnik atmosfery i 2D pola ciśnienia
    AtmosphereEngine.generate();

    // Pętla 2: Silnik cyrkulacji oceanicznej i anomalii SST
    OceanEngine.generate();

    // Pętla 3: MoistureEngine.generate()
    // Pętla 4: HydrologyEngine.generate()

    if (typeof TIME !== "undefined" && TIME) console.timeEnd("generateAeroHydro");
  }
}

export const AeroHydro = new AeroHydroModule();

/**
 * Rejestracja globalnego bridge'a dla klasycznego pipeline'u FMG.
 * Wywoływane tylko w przeglądarce.
 */
function registerBridge(): void {
  if (typeof window === "undefined") return;
  const w = window as any;
  if (!w.AeroHydro) {
    w.AeroHydro = AeroHydro;
    w.generateAeroHydro = () => AeroHydro.generate();
  }
}

registerBridge();
