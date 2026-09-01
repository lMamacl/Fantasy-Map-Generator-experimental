import { describe, expect, it } from "vitest";
import { defaultTemperatureConfig, TemperatureEngine } from "./temperature-engine";

describe("TemperatureEngine", () => {
  it("TEST-T1: Sea-level temperature matches physical European & Mediterranean transect", () => {
    const config = defaultTemperatureConfig();

    // 30°N (Egipt / Północna Sahara): oczekiwane 21.5 - 24.5°C
    const t30 = TemperatureEngine.getSeaLevelTemp(30.0, config);
    expect(t30).toBeGreaterThanOrEqual(21.0);
    expect(t30).toBeLessThanOrEqual(24.5);

    // 36°N (Kreta / Cypr / Lewant): oczekiwane 18.0 - 20.5°C
    const t36 = TemperatureEngine.getSeaLevelTemp(36.0, config);
    expect(t36).toBeGreaterThanOrEqual(18.0);
    expect(t36).toBeLessThanOrEqual(20.5);

    // 40°N (Grecja / Rzym / Saloniki): oczekiwane 15.5 - 18.0°C
    const t40 = TemperatureEngine.getSeaLevelTemp(40.0, config);
    expect(t40).toBeGreaterThanOrEqual(15.5);
    expect(t40).toBeLessThanOrEqual(18.0);

    // 45°N (Alpy / Wenecja / Krym / Dunaj): oczekiwane 12.5 - 15.0°C
    const t45 = TemperatureEngine.getSeaLevelTemp(45.0, config);
    expect(t45).toBeGreaterThanOrEqual(12.5);
    expect(t45).toBeLessThanOrEqual(15.0);

    // 50°N (Kraków / Frankfurt / Kijów): oczekiwane 9.5 - 12.0°C
    const t50 = TemperatureEngine.getSeaLevelTemp(50.0, config);
    expect(t50).toBeGreaterThanOrEqual(9.5);
    expect(t50).toBeLessThanOrEqual(12.0);

    // 53.6°N (Gdańsk / Hamburg / Bałtyk): oczekiwane 7.5 - 10.0°C
    const t53_6 = TemperatureEngine.getSeaLevelTemp(53.6, config);
    expect(t53_6).toBeGreaterThanOrEqual(7.5);
    expect(t53_6).toBeLessThanOrEqual(10.0);
  });

  it("TEST-T2: Altitude lapse rate calibrated to Alpine peaks (4800m, 31.2°C drop at h=100)", () => {
    const config = defaultTemperatureConfig();

    const maxDrop = TemperatureEngine.getAltitudeTemperatureDrop(100, config);
    expect(maxDrop).toBeCloseTo(31.2, 1.0);

    // Dla śródziemnomorskiej góry (40°N, T_sea = 16.7°C), szczyt alpejski h=100 ma ~ -14.5°C (lodowce/wieczna zmarzlina)
    const peakTemp = TemperatureEngine.calculateCellTemp(16.7, 100, config);
    expect(peakTemp).toBeGreaterThanOrEqual(-16.0);
    expect(peakTemp).toBeLessThanOrEqual(-12.5);

    // Dla wzgórza/średnich gór h=50 spadek wynosi ok. 9.16°C
    const hillDrop = TemperatureEngine.getAltitudeTemperatureDrop(50, config);
    expect(hillDrop).toBeCloseTo(9.16, 0.5);
  });

  it("TEST-T3: Mediterranean lowlands (h=25) maintain warm climate", () => {
    const config = defaultTemperatureConfig();
    const seaTemp = TemperatureEngine.getSeaLevelTemp(36.0, config); // ~18.3°C
    const lowlandTemp = TemperatureEngine.calculateCellTemp(seaTemp, 25, config);
    expect(lowlandTemp).toBeGreaterThanOrEqual(17.0);
  });

  it("TEST-T4: generate() correctly populates grid.cells.temp array", () => {
    (globalThis as any).grid = {
      cells: {
        i: [0, 1, 2, 3],
        h: new Uint8Array([10, 20, 50, 100]),
        temp: new Int8Array(4)
      },
      points: [
        [100, 100], // y=100 -> ~51.2°N
        [100, 500], // y=500 -> ~41.6°N
        [100, 800], // y=800 -> ~34.5°N
        [100, 950] // y=950 -> ~30.9°N
      ]
    };
    (globalThis as any).options = {
      temperatureEquator: 27,
      temperatureNorthPole: -12,
      temperatureSouthPole: -15
    };
    (globalThis as any).mapCoordinates = {
      latN: 53.6,
      latS: 29.7,
      latT: 23.9,
      lonW: 5.4,
      lonE: 37.3,
      lonT: 31.9
    };
    (globalThis as any).graphHeight = 1000;

    TemperatureEngine.generate();

    const temp = (globalThis as any).grid.cells.temp;
    expect(temp[0]).toBeGreaterThanOrEqual(8); // woda na północy
    expect(temp[1]).toBeGreaterThanOrEqual(14); // nizina na 41.6°N
    expect(temp[2]).toBeGreaterThanOrEqual(9); // wyżyna h=50 na 34.5°N (~10°C)
    expect(temp[3]).toBeLessThanOrEqual(0); // szczyt alpejski h=100 na 30.9°N (22.2 - 31.2 = ~ -9°C)
  });
});
