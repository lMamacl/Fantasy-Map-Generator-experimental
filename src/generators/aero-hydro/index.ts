/**
 * Główny koordynator modułu Aero-Hydro 2.0.
 *
 * Zarządza sekwencją wywołań silników fizycznych i rejestruje
 * globalny interfejs (`window.AeroHydro`, `window.generateAeroHydro`).
 *
 * @module generators/aero-hydro
 */

export class AeroHydroModule {
  /**
   * Cechy przepływowe (wstęgi wiatru, prądy morskie) wygenerowane przez silniki.
   * Wypełniane przez pętle 1–5; w Pętli 0 pozostaje puste.
   */
  flowFeatures: any[] = [];

  /**
   * Wykonuje pełny potok fizyczny klimatu i hydrologii.
   *
   * W Pętli 0 inicjalizuje tylko puste struktury. W kolejnych pętlach
   * zostaną wpięte: AtmosphereEngine → OceanEngine → MoistureEngine → HydrologyEngine.
   */
  generate(): void {
    if (typeof TIME !== "undefined" && TIME) console.time("generateAeroHydro");

    this.flowFeatures = []; // reset

    // Placeholder: w Pętli 1 zostanie tu wpięty AtmosphereEngine.generate()
    // W Pętli 2 OceanEngine.generate()
    // W Pętli 3 MoistureEngine.generate()
    // W Pętli 4 HydrologyEngine.generate()

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
