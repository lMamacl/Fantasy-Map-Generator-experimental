import { describe, expect, it } from "vitest";
import {
  type AeroHydroCells,
  type BaricCenter,
  createAeroHydroCells,
  defaultAtmosphereConfig,
  defaultMoistureConfig,
  defaultOceanCurrentsConfig,
  isValidBaricCenter
} from "./aero-hydro";

describe("AeroHydro type definitions", () => {
  it("AeroHydroCells fields can be instantiated as Float32Array", () => {
    const n = 100;
    const cells: AeroHydroCells = {
      pressure: new Float32Array(n),
      windU: new Float32Array(n),
      windV: new Float32Array(n),
      windSpeed: new Float32Array(n),
      oceanU: new Float32Array(n),
      oceanV: new Float32Array(n),
      sstAnomaly: new Float32Array(n),
      moisture: new Float32Array(n)
    };
    expect(cells.pressure).toBeInstanceOf(Float32Array);
    expect(cells.pressure.length).toBe(n);
    expect(cells.windU.length).toBe(n);
    expect(cells.sstAnomaly.length).toBe(n);
  });

  it("createAeroHydroCells tworzy prawidłową strukturę", () => {
    const n = 50;
    const cells = createAeroHydroCells(n);
    expect(cells.pressure.length).toBe(n);
    expect(cells.windU.length).toBe(n);
    expect(cells.windV.length).toBe(n);
    expect(cells.windSpeed.length).toBe(n);
    expect(cells.oceanU.length).toBe(n);
    expect(cells.oceanV.length).toBe(n);
    expect(cells.sstAnomaly.length).toBe(n);
    expect(cells.moisture.length).toBe(n);
    // Wartości domyślne Float32Array to 0
    expect(cells.pressure[0]).toBe(0);
    expect(cells.pressure[49]).toBe(0);
  });

  it("BaricCenter — prawidłowe dane przechodzą walidację", () => {
    const valid: BaricCenter = {
      x: 500,
      y: 300,
      type: "high",
      pressureHPa: 1028,
      radiusKm: 1500,
      thermalOrigin: false
    };
    expect(isValidBaricCenter(valid)).toBe(true);
  });

  it("BaricCenter — niepoprawny typ odrzuca walidację", () => {
    expect(isValidBaricCenter({ type: "invalid" as any })).toBe(false);
  });

  it("BaricCenter — ciśnienie poza zakresem odrzuca walidację", () => {
    expect(isValidBaricCenter({ pressureHPa: 500 } as Partial<BaricCenter>)).toBe(false);
    expect(isValidBaricCenter({ pressureHPa: 1200 } as Partial<BaricCenter>)).toBe(false);
  });

  it("BaricCenter — ujemny promień odrzuca walidację", () => {
    expect(isValidBaricCenter({ radiusKm: -100 } as Partial<BaricCenter>)).toBe(false);
  });

  it("AtmosphereConfig default ma 4 elementy w zonalPressureHPa", () => {
    const config = defaultAtmosphereConfig();
    expect(config.zonalPressureHPa.length).toBe(4);
    expect(config.frictionAngleOcean).toBe(20);
    expect(config.frictionAngleLand).toBe(35);
    expect(config.coriolisFloor).toBe(1e-5);
    expect(config.baricCenters).toEqual([]);
  });

  it("OceanCurrentsConfig default jest w realistycznych zakresach", () => {
    const config = defaultOceanCurrentsConfig();
    expect(config.windStressFactor).toBeGreaterThanOrEqual(0.01);
    expect(config.windStressFactor).toBeLessThanOrEqual(0.1);
    expect(config.ekmanAngle).toBeGreaterThan(0);
    expect(config.ekmanAngle).toBeLessThan(90);
    expect(config.westernIntensification).toBeGreaterThan(1);
    expect(config.westernIntensification).toBeLessThan(5);
  });

  it("MoistureConfig default ma dodatnie parametry", () => {
    const config = defaultMoistureConfig();
    expect(config.minPrecipMmYr).toBeGreaterThan(0);
    expect(config.advectionPasses).toBeGreaterThan(0);
    expect(config.advectionPasses).toBeLessThanOrEqual(20);
    expect(config.diffusionCoeff).toBeGreaterThan(0);
    expect(config.diffusionCoeff).toBeLessThanOrEqual(1);
  });
});
