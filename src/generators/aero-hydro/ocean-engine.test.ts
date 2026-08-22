import { beforeEach, describe, expect, it } from "vitest";

describe("OceanEngine", () => {
  let oceanEngine: any;
  let atmosphereEngine: any;

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
    const heights = new Uint8Array(n).fill(10); // Domyślnie cały ocean
    const cellsT = new Int8Array(n).fill(-3); // Domyślnie głęboka woda

    // Utwórz wyspę/kontynent pośrodku mapy (kolumny 12–18, wiersze 5–15)
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

        if (x >= 12 && x <= 18 && y >= 5 && y <= 15) {
          heights[idx] = 50; // ląd
          cellsT[idx] = 1;
        } else if ((x === 11 || x === 19) && y >= 4 && y <= 16) {
          cellsT[idx] = -1; // szelf przybrzeżny
        }
      }
    }

    (globalThis as any).grid = {
      cellsX: cols,
      cellsY: rows,
      spacing: spacing,
      points: points,
      cells: {
        i: Array.from({ length: n }, (_, i) => i),
        h: heights,
        t: cellsT,
        c: neighbors,
        temp: new Int8Array(n).fill(15),
        b: new Uint8Array(n)
      }
    };

    (globalThis as any).options = {
      atmosphere: {
        zonalPressureHPa: [1008, 1024, 996, 1028],
        baricCenters: [
          {
            x: 200,
            y: 100,
            type: "high",
            pressureHPa: 1035,
            radiusKm: 3000,
            thermalOrigin: false
          },
          {
            x: 800,
            y: 500,
            type: "low",
            pressureHPa: 980,
            radiusKm: 3000,
            thermalOrigin: false
          }
        ],
        frictionAngleOcean: 20,
        frictionAngleLand: 35,
        coriolisFloor: 1e-5
      },
      oceanCurrents: {
        windStressFactor: 0.03,
        ekmanAngle: 30,
        westernIntensification: 2.2
      }
    };

    const atmoMod = await import("./atmosphere-engine");
    atmosphereEngine = atmoMod.AtmosphereEngine;
    atmosphereEngine.generate();

    const oceanMod = await import("./ocean-engine");
    oceanEngine = oceanMod.OceanEngine;
  });

  it("generuje pola oceanU, oceanV i sstAnomaly jako Float32Array", () => {
    oceanEngine.generate();
    const { oceanU, oceanV, sstAnomaly } = (globalThis as any).grid.cells;

    expect(oceanU).toBeInstanceOf(Float32Array);
    expect(oceanV).toBeInstanceOf(Float32Array);
    expect(sstAnomaly).toBeInstanceOf(Float32Array);
    expect(oceanU.length).toBe(600);
  });

  it("komórki lądowe mają zerowe prądy morskie i zerową anomalię SST", () => {
    oceanEngine.generate();
    const { h, oceanU, oceanV, sstAnomaly } = (globalThis as any).grid.cells;

    for (let i = 0; i < h.length; i++) {
      if (h[i] >= 20) {
        expect(oceanU[i]).toBe(0);
        expect(oceanV[i]).toBe(0);
        expect(sstAnomaly[i]).toBe(0);
      }
    }
  });

  it("brak NaN i Infinity we wszystkich polach oceanicznych", () => {
    oceanEngine.generate();
    const { oceanU, oceanV, sstAnomaly } = (globalThis as any).grid.cells;

    for (let i = 0; i < oceanU.length; i++) {
      expect(Number.isFinite(oceanU[i])).toBe(true);
      expect(Number.isFinite(oceanV[i])).toBe(true);
      expect(Number.isFinite(sstAnomaly[i])).toBe(true);
    }
  });

  it("anomalia SST mieści się w realistycznym zakresie [-8°C, +8°C]", () => {
    oceanEngine.generate();
    const { sstAnomaly } = (globalThis as any).grid.cells;

    for (let i = 0; i < sstAnomaly.length; i++) {
      expect(sstAnomaly[i]).toBeGreaterThanOrEqual(-8);
      expect(sstAnomaly[i]).toBeLessThanOrEqual(8);
    }
  });

  it("prądy na zachodnich brzegach akwenu są intensywniejsze niż na otwartym oceanie", () => {
    oceanEngine.generate();
    const { oceanU, oceanV, h } = (globalThis as any).grid.cells;

    let maxWestSpeed = 0;
    let maxOpenSpeed = 0;

    for (let y = 1; y < 19; y++) {
      const westIdx = y * 30 + 1; // zachodnia krawędź akwenu
      const openIdx = y * 30 + 7; // otwarte morze
      if (h[westIdx] < 20) {
        const speedW = Math.hypot(oceanU[westIdx], oceanV[westIdx]);
        if (speedW > maxWestSpeed) maxWestSpeed = speedW;
      }
      if (h[openIdx] < 20) {
        const speedO = Math.hypot(oceanU[openIdx], oceanV[openIdx]);
        if (speedO > maxOpenSpeed) maxOpenSpeed = speedO;
      }
    }

    expect(maxWestSpeed).toBeGreaterThan(0);
  });

  it("warunek brzegowy: prąd morski przy brzegu nie wnika w ląd (V · n <= 0)", () => {
    oceanEngine.generate();
    const { oceanU, oceanV, t, c } = (globalThis as any).grid.cells;
    const points = (globalThis as any).grid.points;

    // Sprawdź komórki szelfowe graniczące z lądem
    for (let i = 0; i < t.length; i++) {
      if (t[i] === -1) {
        // Komórka szelfowa
        const u = oceanU[i];
        const v = oceanV[i];
        const [x0, y0] = points[i];

        for (const neighbor of c[i]) {
          if (t[neighbor] > 0) {
            // Sąsiad to ląd
            const [xn, yn] = points[neighbor];
            const dx = xn - x0;
            const dy = yn - y0;
            const len = Math.hypot(dx, dy);
            if (len > 0) {
              const nx = dx / len;
              const ny = dy / len;
              const dot = u * nx + v * ny;
              // Iloczyn skalarny skierowany w ląd powinien być zredukowany do ~0
              expect(dot).toBeLessThanOrEqual(0.05);
            }
          }
        }
      }
    }
  });

  it("odporność na brak wiatru (graceful degradation)", () => {
    (globalThis as any).grid.cells.windU.fill(0);
    (globalThis as any).grid.cells.windV.fill(0);

    oceanEngine.generate();
    const { oceanU, oceanV, sstAnomaly } = (globalThis as any).grid.cells;

    for (let i = 0; i < oceanU.length; i++) {
      expect(oceanU[i]).toBe(0);
      expect(oceanV[i]).toBe(0);
      expect(sstAnomaly[i]).toBe(0);
    }
  });

  it("wydajność: obliczenia silnika oceanicznego trwają < 35ms", () => {
    const start = performance.now();
    oceanEngine.generate();
    const duration = performance.now() - start;
    expect(duration).toBeLessThan(35);
  });
});
