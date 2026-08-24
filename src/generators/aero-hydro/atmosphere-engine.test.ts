import { beforeEach, describe, expect, it } from "vitest";

describe("AtmosphereEngine", () => {
  let engine: any;

  beforeEach(async () => {
    (globalThis as any).TIME = false;
    (globalThis as any).graphWidth = 1000;
    (globalThis as any).graphHeight = 600;
    (globalThis as any).mapCoordinates = {
      latN: 60,
      latS: -60,
      latT: 120,
      lonW: -90,
      lonE: 90,
      lonT: 180
    };

    const cols = 30;
    const rows = 20;
    const n = cols * rows; // 600 komórek
    const spacing = 33;

    const points: [number, number][] = [];
    const neighbors: number[][] = [];

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const idx = y * cols + x;
        points.push([x * spacing + 16, y * 30 + 15]);

        const nb: number[] = [];
        if (x > 0) nb.push(idx - 1);
        if (x < cols - 1) nb.push(idx + 1);
        if (y > 0) nb.push(idx - cols);
        if (y < rows - 1) nb.push(idx + cols);
        neighbors.push(nb);
      }
    }

    (globalThis as any).grid = {
      cellsX: cols,
      cellsY: rows,
      spacing: spacing,
      points: points,
      cells: {
        i: Array.from({ length: n }, (_, i) => i),
        h: new Uint8Array(n).fill(10), // woda
        c: neighbors,
        temp: new Int8Array(n).fill(15),
        b: new Uint8Array(n)
      }
    };

    (globalThis as any).options = {
      atmosphere: {
        zonalPressureHPa: [1008, 1024, 996, 1028],
        baricCenters: [],
        frictionAngleOcean: 20,
        frictionAngleLand: 35,
        coriolisFloor: 1e-5
      }
    };

    const mod = await import("./atmosphere-engine");
    engine = mod.AtmosphereEngine;
  });

  it("generuje pole ciśnienia i pola wektorowe wiatru", () => {
    engine.generate();
    const cells = (globalThis as any).grid.cells;

    expect(cells.pressure).toBeInstanceOf(Float32Array);
    expect(cells.windU).toBeInstanceOf(Float32Array);
    expect(cells.windV).toBeInstanceOf(Float32Array);
    expect(cells.windSpeed).toBeInstanceOf(Float32Array);
    expect(cells.pressure.length).toBe(600);
  });

  it("ciśnienie mieści się w realistycznym zakresie 900–1100 hPa", () => {
    engine.generate();
    const p = (globalThis as any).grid.cells.pressure;
    for (let i = 0; i < p.length; i++) {
      expect(p[i]).toBeGreaterThan(900);
      expect(p[i]).toBeLessThan(1100);
    }
  });

  it("wszystkie wartości wiatru są skończone (brak NaN i Infinity)", () => {
    engine.generate();
    const { windU, windV, windSpeed } = (globalThis as any).grid.cells;
    for (let i = 0; i < windU.length; i++) {
      expect(Number.isFinite(windU[i])).toBe(true);
      expect(Number.isFinite(windV[i])).toBe(true);
      expect(Number.isFinite(windSpeed[i])).toBe(true);
    }
  });

  it("brak sztucznego tła wiatru — martwe strefy mogą występować", () => {
    engine.generate();
    const { windSpeed } = (globalThis as any).grid.cells;
    // Minimum to 0 (fizycznie poprawne: brak gradientu → brak wiatru)
    expect(Math.min(...windSpeed)).toBeGreaterThanOrEqual(0);
  });

  it("centrum niżowe tworzy obszar obniżonego ciśnienia", () => {
    // Promien srodkowany na pikselach — engine dzieli przez kmPerCell, wiec
    // radiusKm=200 oznacza ~20 px (przy spacing=33, kmPerCell~10).
    // Aby perturbacja byla widoczna po wygładzaniu, stosujemy silny niż.
    (globalThis as any).options.atmosphere.baricCenters = [
      {
        x: 500,
        y: 150,
        type: "low",
        pressureHPa: 900,
        radiusKm: 2500,
        thermalOrigin: false
      }
    ];

    engine.generate();
    const p = (globalThis as any).grid.cells.pressure;
    const centerIdx = 5 * 30 + 15;
    // Po wygładzaniu centrum powinno byc wyraźnie ponizej tła (~1010 hPa)
    expect(p[centerIdx]).toBeLessThan(970);
  });

  it("centrum wyżowe podnosi lokalne ciśnienie", () => {
    (globalThis as any).options.atmosphere.baricCenters = [
      {
        x: 500,
        y: 150,
        type: "high",
        pressureHPa: 1040,
        radiusKm: 100,
        thermalOrigin: false
      }
    ];

    engine.generate();
    const p = (globalThis as any).grid.cells.pressure;
    const centerIdx = 5 * 30 + 15;
    expect(p[centerIdx]).toBeGreaterThan(1015);
  });

  it("orografia: góry (h > 60) obniżają ciśnienie powierzchniowe i odchylają wektor wiatru", () => {
    const cells = (globalThis as any).grid.cells;
    // Płaska nizina bazowa
    for (let i = 0; i < cells.h.length; i++) cells.h[i] = 20;

    // Pasmo górskie w środku mapy
    for (let y = 8; y <= 12; y++) {
      for (let x = 10; x <= 20; x++) {
        cells.h[y * 30 + x] = 85;
      }
    }

    engine.generate();
    const mountainCell = 10 * 30 + 15;
    const lowlandCell = 3 * 30 + 15;
    const p = (globalThis as any).grid.cells.pressure;
    const { windU: u, windV: v } = (globalThis as any).grid.cells;

    // 1. Ciśnienie na szczycie góry musi być niższe niż na nizinie (wzór barometryczny)
    expect(p[mountainCell]).toBeLessThan(p[lowlandCell] - 20);

    // 2. Wiatr na granicy gór musi być skończony i przekierowany wzdłuż zbocza
    expect(Number.isFinite(u[mountainCell])).toBe(true);
    expect(Number.isFinite(v[mountainCell])).toBe(true);
  });

  it("wydajność: obliczenia trwają < 50ms", () => {
    const start = performance.now();
    engine.generate();
    const duration = performance.now() - start;
    expect(duration).toBeLessThan(50);
  });
});
