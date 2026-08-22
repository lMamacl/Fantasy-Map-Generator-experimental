/**
 * Typy i interfejsy dla systemu Aero-Hydro 2.0
 * Fizyka wiatrów, oceanów i hydrologii na siatce Voronoi FMG.
 *
 * @module types/aero-hydro
 */

/**
 * Jednostkowe centrum baryczne (stacjonarne, klimatologiczne centrum wyżowe lub niżowe).
 *
 * @example
 * const high: BaricCenter = {
 *   x: 500, y: 300, type: "high",
 *   pressureHPa: 1028, radiusKm: 1500, thermalOrigin: false
 * };
 */
export interface BaricCenter {
  /** współrzędna x na mapie (piksele) */
  x: number;
  /** współrzędna y na mapie (piksele) */
  y: number;
  /** typ centrum — wyż lub niż */
  type: "high" | "low";
  /** ciśnienie centralne w hPa (zwykłe: 1013 ± 20 hPa) */
  pressureHPa: number;
  /** promień wpływu w km (skalowany fizycznie) */
  radiusKm: number;
  /** true = monsunowy niż termiczny nad lądem latem */
  thermalOrigin: boolean;
}

/**
 * Waliduje BaricCenter — zwraca true gdy wartości mieszczą się w fizycznie
 * realistycznych zakresach.
 */
export function isValidBaricCenter(b: Partial<BaricCenter>): boolean {
  if (!b.type) return false;
  if (b.type !== "high" && b.type !== "low") return false;
  const p = b.pressureHPa ?? NaN;
  if (!Number.isFinite(p) || p < 850 || p > 1150) return false;
  const r = b.radiusKm ?? NaN;
  if (!Number.isFinite(r) || r <= 0) return false;
  return true;
}

/**
 * Konfiguracja silnika atmosfery.
 * Ciśnienie bazowe jest definiowane jako wektor 4-elementowy
 * [ITCZ, Subtropical High, Subpolar Low, Polar High] w hPa.
 */
export interface AtmosphereConfig {
  /** Pasowe ciśnienia bazowe [ITCZ, Subtropical High, Subpolar Low, Polar High] w hPa */
  zonalPressureHPa: [number, number, number, number];
  /** Ośrodki baryczne definiowane przez użytkownika lub generowane automatycznie */
  baricCenters: BaricCenter[];
  /** Kąt skręcenia wiatru przy ziemi nad oceanem (stopnie) */
  frictionAngleOcean: number;
  /** Kąt skręcenia wiatru przy ziemi nad lądem (stopnie) */
  frictionAngleLand: number;
  /** Minimalna wartość |f| zapobiegająca dzieleniu przez 0 w strefie równikowej */
  coriolisFloor: number;
}

/** Domyślne wartości domyślne dla AtmosphereConfig */
export function defaultAtmosphereConfig(): AtmosphereConfig {
  return {
    zonalPressureHPa: [1008, 1024, 996, 1028],
    baricCenters: [],
    frictionAngleOcean: 20,
    frictionAngleLand: 35,
    coriolisFloor: 1e-5
  };
}

/**
 * Konfiguracja silnika oceanicznego.
 * Model oparty na cyrkulacji Ekmana i wzmocnieniu zachodnim basenów oceanicznych.
 */
export interface OceanCurrentsConfig {
  /** Współczynnik transferu naprężenia wiatru na powierzchnię wody (typowo 0.02–0.05) */
  windStressFactor: number;
  /** Kąt odchylenia wstęgi Ekmana od kierunku wiatru (stopnie, typowo 20–45°) */
  ekmanAngle: number;
  /** Wzmacnianie prądów na zachodnich brzegach basenów względem wschodnich (typowo 1.8–2.5×) */
  westernIntensification: number;
}

/** Domyślne wartości domyślne dla OceanCurrentsConfig */
export function defaultOceanCurrentsConfig(): OceanCurrentsConfig {
  return {
    windStressFactor: 0.03,
    ekmanAngle: 20,
    westernIntensification: 2.2
  };
}

/**
 * Konfiguracja adwekcji wilgoci.
 * Model Clausiusa-Clapeyrona z multi-pass adwekcją 2D.
 */
export interface MoistureConfig {
  /** Minimalne opady bazowe w mm/rok — nawet pustynie mają > 0 */
  minPrecipMmYr: number;
  /** Liczba przejść adwekcyjnych (multi-pass, typowo 3–6) */
  advectionPasses: number;
  /** Współczynnik dyfuzji atmosferycznej wygładzającej gradienty */
  diffusionCoeff: number;
}

/** Domyślne wartości domyślne dla MoistureConfig */
export function defaultMoistureConfig(): MoistureConfig {
  return {
    minPrecipMmYr: 10,
    advectionPasses: 4,
    diffusionCoeff: 0.15
  };
}

/**
 * Pola fizyczne dołączane do grid.cells.
 * Każde pole to Float32Array o długości grid.cells.i.length.
 */
export interface AeroHydroCells {
  /** ciśnienie atmosferyczne [hPa] */
  pressure: Float32Array;
  /** składowa X wektora wiatru [m/s] */
  windU: Float32Array;
  /** składowa Y wektora wiatru [m/s] */
  windV: Float32Array;
  /** |V| prędkość wiatru [m/s] */
  windSpeed: Float32Array;
  /** składowa X prądu morskiego [m/s] */
  oceanU: Float32Array;
  /** składowa Y prądu morskiego [m/s] */
  oceanV: Float32Array;
  /** anomalia temperatury powierzchni oceanu [°C] */
  sstAnomaly: Float32Array;
  /** zawartość wilgoci w kolumnie powietrza [mm equiv.] */
  moisture: Float32Array;
}

/**
 * Tworzy pustą strukturę AeroHydroCells o podanej długości.
 */
export function createAeroHydroCells(n: number): AeroHydroCells {
  return {
    pressure: new Float32Array(n),
    windU: new Float32Array(n),
    windV: new Float32Array(n),
    windSpeed: new Float32Array(n),
    oceanU: new Float32Array(n),
    oceanV: new Float32Array(n),
    sstAnomaly: new Float32Array(n),
    moisture: new Float32Array(n)
  };
}
