/**
 * Silnik termiczny klimatu Aero-Hydro 2.0 (TemperatureEngine).
 *
 * Oblicza fizyczne 2D pole temperatury `grid.cells.temp` w °C w oparciu o:
 *   1. Insolację zonalną (radiacyjny profil południkowy z grzbietem zwrotnikowym).
 *   2. Środowiskowy pionowy gradient termiczny (Environmental Lapse Rate: 6.5°C/1000m)
 *      z fizycznym rzutowaniem wysokości siatki h in [20, 100] -> Z(h) in [0, 3200m].
 *   3. Sprzężenie z cyrkulacją oceaniczną (anomalia SST i wpływ na wybrzeże).
 *
 * @module generators/aero-hydro/temperature-engine
 */

export interface TemperatureConfig {
  /** Temperatura na równiku (0°N) [°C], domyślnie 27 */
  temperatureEquator: number;
  /** Temperatura na biegunie północnym (90°N) [°C], domyślnie -12 */
  temperatureNorthPole: number;
  /** Temperatura na biegunie południowym (90°S) [°C], domyślnie -15 */
  temperatureSouthPole: number;
  /** Maksymalna wysokość szczytów (dla h=100) w metrach n.p.m., domyślnie 4800 */
  maxElevationMeters: number;
  /** Gradient pionowy w troposferze [°C / 1000m], domyślnie 6.5 */
  lapseRatePerKm: number;
}

export const defaultTemperatureConfig = (): TemperatureConfig => ({
  temperatureEquator: 27,
  temperatureNorthPole: -12,
  temperatureSouthPole: -15,
  maxElevationMeters: 4800,
  lapseRatePerKm: 6.5
});

export class TemperatureEngineModule {
  /**
   * Główna metoda generująca tablicę temperatur `grid.cells.temp` [Int8Array w °C].
   */
  generate(customConfig?: Partial<TemperatureConfig>): void {
    const grid = (globalThis as any).grid;
    if (!grid?.cells?.i) return;

    const options = (globalThis as any).options || {};
    const mapCoordinates = (globalThis as any).mapCoordinates || {
      latN: 53.6,
      latS: 29.7,
      latT: 23.9,
      lonW: 5.4,
      lonE: 37.3,
      lonT: 31.9
    };
    const graphHeight = (globalThis as any).graphHeight ?? 1000;

    const config: TemperatureConfig = {
      ...defaultTemperatureConfig(),
      temperatureEquator: options.temperatureEquator ?? 27,
      temperatureNorthPole: options.temperatureNorthPole ?? -12,
      temperatureSouthPole: options.temperatureSouthPole ?? -15,
      ...(customConfig || {})
    };

    const n = grid.cells.i.length;
    const { cells, points } = grid;

    if (!cells.temp || cells.temp.length !== n) {
      cells.temp = new Int8Array(n);
    }

    const { latN, latT } = mapCoordinates;
    const sstInfluence = cells.sstLandInfluence;
    const sstAnomaly = cells.sstAnomaly;

    for (let i = 0; i < n; i++) {
      const [, y] = points[i];
      const latitude = latN - (y / graphHeight) * latT;
      const seaLevelTemp = this.getSeaLevelTemp(latitude, config);
      const h = cells.h[i];

      if (h < 20) {
        // Woda morska / jezioro: temperatura zbliżona do temperatury powierzchni morza
        const sst = sstAnomaly ? sstAnomaly[i] : 0;
        const waterTemp = seaLevelTemp + sst * 0.5;
        cells.temp[i] = Math.max(-128, Math.min(127, Math.round(waterTemp)));
      } else {
        // Ląd: spadek z wysokością n.p.m. + ewentualny wpływ morskiej bryzy/prądu
        const drop = this.getAltitudeTemperatureDrop(h, config);
        const sstEffect = sstInfluence ? sstInfluence[i] : 0;
        const landTemp = seaLevelTemp - drop + sstEffect;
        cells.temp[i] = Math.max(-128, Math.min(127, Math.round(landTemp)));
      }
    }
  }

  /**
   * Oblicza temperaturę na poziomie morza dla zadanej szerokości geograficznej.
   * Modeluje grzbiet termiczny wyżów zwrotnikowych (22°N/20°S) oraz nieliniowy spadek ku biegunom.
   */
  getSeaLevelTemp(latitude: number, config: TemperatureConfig = defaultTemperatureConfig()): number {
    const isNorth = latitude >= 0;
    const absLat = Math.abs(latitude);
    const poleTemp = isNorth ? config.temperatureNorthPole : config.temperatureSouthPole;
    const eqTemp = config.temperatureEquator;

    // Pozycja grzbietu zwrotnikowego (Hadley descending branch)
    const ridgeLat = isNorth ? 22.0 : 20.0;
    const ridgeTemp = eqTemp - 0.5;

    if (absLat <= ridgeLat) {
      // Pomiędzy równikiem a grzbietem zwrotnikowym: równikowe plateau
      const frac = absLat / ridgeLat;
      return eqTemp - 0.5 * (1 - (1 - frac) ** 2);
    }

    // Od grzbietu zwrotnikowego do bieguna: nieliniowy profil radiacyjny
    const norm = (absLat - ridgeLat) / (90.0 - ridgeLat); // [0, 1]
    const clampedNorm = Math.max(0, Math.min(1, norm));
    // Krzywa insolacyjna troposfery
    const curve = 1.15 * clampedNorm ** 1.1 - 0.15 * clampedNorm ** 2;
    const tempDelta = ridgeTemp - poleTemp;
    return ridgeTemp - tempDelta * curve;
  }

  /**
   * Przelicza wysokość w skali FMG h in [20, 100] na realną wysokość w metrach.
   * h=20 -> 0m (poziom morza)
   * h=50 -> ~1485m (wyżyny / średnie góry)
   * h=70 -> ~2720m (piętro subalpejskie / regiel górny)
   * h=100 -> 4800m (szczyty alpejskie)
   */
  heightToMeters(h: number, maxMeters = 4800): number {
    if (h < 20) return 0;
    const frac = Math.max(0, Math.min(1, (h - 20) / 80));
    return maxMeters * frac ** 1.25;
  }

  /**
   * Oblicza spadek temperatury dla danej wysokości siatki h [20–100].
   */
  getAltitudeTemperatureDrop(h: number, config: TemperatureConfig = defaultTemperatureConfig()): number {
    if (h < 20) return 0;
    const meters = this.heightToMeters(h, config.maxElevationMeters);
    return (meters / 1000) * config.lapseRatePerKm;
  }

  /**
   * Pomocnicza metoda do obliczenia temperatury pojedynczej komórki.
   */
  calculateCellTemp(seaLevelTemp: number, h: number, config: TemperatureConfig = defaultTemperatureConfig()): number {
    if (h < 20) return seaLevelTemp;
    const drop = this.getAltitudeTemperatureDrop(h, config);
    return seaLevelTemp - drop;
  }
}

export const TemperatureEngine = new TemperatureEngineModule();
