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
 * Konfiguracja Eulerowskiego silnika wilgoci i klimatu.
 * Model dyfuzyjno-adwekcyjny z Clausius-Clapeyron, orografią i ewapotranspiracją.
 */
export interface MoistureConfig {
  /** Liczba iteracji dyfuzji-adwekcji (zbieżność po 4–8) */
  iterations: number;
  /** Współczynnik dyfuzji bazowej — modeluje turbulencję i zmienność wiatru */
  diffusionCoeff: number;
  /** Siła adwekcji wiatrem (ile wiatr wzmacnia transport vs. dyfuzja) */
  advectionStrength: number;
  /** Wydajność kondensacji nadwyżki wilgoci ponad pojemność (0–1) */
  condensationRate: number;
  /** Jak silnie wznoszenie terenu blokuje/wymusza kondensację (m/km → rate) */
  orographicBlockRate: number;
  /** Skalowanie parowania oceanicznego do jednostek wewnętrznych */
  oceanEvapScale: number;
  /** Skalowanie pojemności Clausius-Clapeyron do pojemności kolumny powietrza */
  capacityScale: number;
  /** Ogrzewanie fenowe po zawietrznej stronie (°C na jednostkę spadku, domyślnie 0.35) */
  foehnHeatingRate: number;
}

/** Domyślne wartości dla MoistureConfig */
export function defaultMoistureConfig(): MoistureConfig {
  return {
    iterations: 14,
    diffusionCoeff: 0.15,
    advectionStrength: 0.4,
    condensationRate: 0.6,
    orographicBlockRate: 0.8,
    oceanEvapScale: 8.0,
    capacityScale: 0.5,
    foehnHeatingRate: 0.35
  };
}

/**
 * Współczynnik konwersji prec→mm/yr. 1 jednostka prec ≈ PRECIP_SCALE_FACTOR mm/yr.
 * Max Uint8 255 × 40 = 10200 mm/yr.
 * Skala FMG-kompatybilna: typowe niziny 15-60 prec, góry 80-120+.
 */
export const PRECIP_SCALE_FACTOR = 55;

/**
 * Domyślne współczynniki ewapotranspiracji per biom (indeks = biome ID z FMG).
 * Wartość 0–1: jaka część opadu jest recyklowana z powrotem do atmosfery.
 * Bazowane na danych rzeczywistych: lasy tropikalne ~45%, tundra ~3%.
 */
export const DEFAULT_EVAPOTRANSPIRATION: readonly number[] = [
  0.0, // 0  Marine — nie dotyczy
  0.02, // 1  Hot desert — prawie brak wegetacji
  0.03, // 2  Cold desert — minimalna
  0.15, // 3  Savanna — trawy i rozproszone drzewa
  0.12, // 4  Grassland — trawy
  0.35, // 5  Tropical seasonal forest
  0.25, // 6  Temperate deciduous forest
  0.45, // 7  Tropical rainforest — najwyższy recykling (Amazonia)
  0.3, // 8  Temperate rainforest
  0.1, // 9  Taiga — iglaste, powolne
  0.03, // 10 Tundra — minimalna
  0.0, // 11 Glacier — brak
  0.35 // 12 Wetland — mokradła, wysoki recykling
];

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
