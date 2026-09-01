import { afterEach, describe, expect, it } from "vitest";
import { restoreAeroHydroState, serializeAeroHydroState } from "./aero-hydro-state";

const N = 64;

function makeGrid() {
  return {
    cells: {
      i: new Uint32Array(N).map((_, i) => i),
      h: new Uint8Array(N).fill(25),
      pressure: new Float32Array(N),
      windU: new Float32Array(N),
      windV: new Float32Array(N),
      oceanU: new Float32Array(N),
      oceanV: new Float32Array(N),
      sstAnomaly: new Float32Array(N),
      sstLandInfluence: new Float32Array(N),
      moisture: new Float32Array(N)
    }
  };
}

describe("Aero-Hydro state serialization (.map section 52)", () => {
  afterEach(() => {
    delete (globalThis as any).grid;
  });

  it("round-trips Float32 physical fields through base64 without precision loss", () => {
    const grid = makeGrid();
    (globalThis as any).grid = grid;

    for (let i = 0; i < N; i++) {
      grid.cells.pressure[i] = 1000 + i * 0.123;
      grid.cells.moisture[i] = i * 0.007;
      grid.cells.oceanU[i] = -0.25 + i * 0.01;
      grid.cells.sstLandInfluence[i] = i % 7 === 0 ? 2.5 : 0;
    }

    const serialized = serializeAeroHydroState();
    expect(serialized).not.toBe("");
    const parsed = JSON.parse(serialized);
    expect(parsed.v).toBe(1);
    // Uwaga: matcher .toContain jest zepsuty w tym setupie vitest (TypeError z
    // instanceof w @vitest/expect) — używamy czystych asercji JS.
    const fieldNames = Object.keys(parsed.fields);
    expect(fieldNames.includes("pressure")).toBe(true);
    expect(fieldNames.includes("moisture")).toBe(true);
    expect(fieldNames.includes("windSpeed")).toBe(false);
    // windSpeed nie istnieje w gridzie testowym i nie powinien być dodany

    // Świeży grid — symulacja wczytania mapy
    const freshGrid = makeGrid();
    (globalThis as any).grid = freshGrid;
    const restored = restoreAeroHydroState(parsed);
    expect(restored).toBe(true);
    expect(freshGrid.cells.pressure.constructor).toBe(Float32Array);
    for (let i = 0; i < N; i++) {
      expect(freshGrid.cells.pressure[i]).toBeCloseTo(grid.cells.pressure[i], 5);
      expect(freshGrid.cells.moisture[i]).toBeCloseTo(grid.cells.moisture[i], 5);
      expect(freshGrid.cells.oceanU[i]).toBeCloseTo(grid.cells.oceanU[i], 5);
      expect(freshGrid.cells.sstLandInfluence[i]).toBe(grid.cells.sstLandInfluence[i]);
    }
  });

  it("skips all-zero fields and returns empty section (lean saves)", () => {
    (globalThis as any).grid = makeGrid();
    expect(serializeAeroHydroState()).toBe("");
  });

  it("returns empty section when grid is missing (e.g. no climate generated)", () => {
    expect(serializeAeroHydroState()).toBe("");
  });

  it("rejects unknown state versions (forward compatibility guard)", () => {
    (globalThis as any).grid = makeGrid();
    expect(restoreAeroHydroState({ v: 999, fields: { pressure: "AAAA" } })).toBe(false);
    expect(restoreAeroHydroState(null)).toBe(false);
    expect(restoreAeroHydroState("garbage")).toBe(false);
  });

  it("skips fields with cell-count mismatch instead of clobbering the grid", () => {
    (globalThis as any).grid = makeGrid();
    const goodMoisture = new Float32Array(N).fill(1.5);
    const parsed = {
      v: 1,
      fields: { moisture: btoa(String.fromCharCode(...new Uint8Array(goodMoisture.buffer))) }
    };

    // Grid po wczytaniu ma inną liczbę komórek (np. zmieniony mapSize)
    const smallerGrid = makeGrid();
    smallerGrid.cells.i = new Uint32Array(10).map((_, i) => i);
    (globalThis as any).grid = smallerGrid;

    expect(restoreAeroHydroState(parsed)).toBe(false);
    expect(smallerGrid.cells.moisture.every(v => v === 0)).toBe(true);

    // Pasująca długość — przywraca poprawnie
    (globalThis as any).grid = makeGrid();
    expect(restoreAeroHydroState(parsed)).toBe(true);
    const grid = (globalThis as any).grid;
    expect(grid.cells.moisture.every((v: number) => v === 1.5)).toBe(true);
  });
});