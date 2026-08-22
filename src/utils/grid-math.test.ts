import { beforeEach, describe, expect, it } from "vitest";

describe("grid-math", () => {
  let gridMath: typeof import("./grid-math");

  beforeEach(async () => {
    // Mock globalnych zmiennych FMG
    (globalThis as any).graphWidth = 1000;
    (globalThis as any).graphHeight = 600;
    (globalThis as any).mapCoordinates = {
      latN: 60,
      latS: 0,
      latT: 60,
      lonW: -30,
      lonE: 30,
      lonT: 60
    };
    (globalThis as any).grid = {
      spacing: 10,
      cellsX: 100,
      cellsY: 60
    };

    gridMath = await import("./grid-math");
  });

  describe("kmToGridCells / gridCellsToKm", () => {
    it("konwersja jest odwracalna (round-trip)", () => {
      const km = 500;
      const cells = gridMath.kmToGridCells(km);
      const back = gridMath.gridCellsToKm(cells);
      expect(Math.abs(back - km)).toBeLessThan(1); // < 1 km błędu
    });

    it("obsługuje ujemne wartości zwracając 0", () => {
      expect(gridMath.kmToGridCells(-50)).toBe(0);
      expect(gridMath.gridCellsToKm(-10)).toBe(0);
    });

    it("większa mapa fizyczna daje mniej komórek na 1 km", () => {
      const cellsSmallMap = gridMath.kmToGridCells(100);
      (globalThis as any).mapCoordinates.lonT = 180; // 3x szersza mapa
      const cellsBigMap = gridMath.kmToGridCells(100);
      expect(cellsBigMap).toBeLessThan(cellsSmallMap);
    });

    it("cellAreaKm2 zwraca dodatnią wartość fizyczną", () => {
      const area = gridMath.cellAreaKm2();
      expect(area).toBeGreaterThan(0);
    });
  });

  describe("scalarGradient", () => {
    it("gradient stałego pola jest zerowy", () => {
      const field = new Float32Array(9).fill(1013);
      const points: [number, number][] = [
        [5, 5],
        [15, 5],
        [25, 5],
        [5, 15],
        [15, 15],
        [25, 15],
        [5, 25],
        [15, 25],
        [25, 25]
      ];
      const neighbors = [
        [1, 3],
        [0, 2, 4],
        [1, 5],
        [0, 4, 6],
        [1, 3, 5, 7],
        [2, 4, 8],
        [3, 7],
        [4, 6, 8],
        [5, 7]
      ];
      const [dx, dy] = gridMath.scalarGradient(field, 4, points, neighbors);
      expect(Math.abs(dx)).toBeLessThan(0.001);
      expect(Math.abs(dy)).toBeLessThan(0.001);
    });

    it("gradient liniowego pola w osi X jest dodatni w dP/dx", () => {
      const points: [number, number][] = [
        [0, 5],
        [10, 5],
        [20, 5],
        [0, 15],
        [10, 15],
        [20, 15],
        [0, 25],
        [10, 25],
        [20, 25]
      ];
      const field = new Float32Array(points.map(p => 1000 + p[0]));
      const neighbors = [
        [1, 3],
        [0, 2, 4],
        [1, 5],
        [0, 4, 6],
        [1, 3, 5, 7],
        [2, 4, 8],
        [3, 7],
        [4, 6, 8],
        [5, 7]
      ];
      const [dx, dy] = gridMath.scalarGradient(field, 4, points, neighbors);
      expect(dx).toBeGreaterThan(0.5);
      expect(Math.abs(dy)).toBeLessThan(0.1);
    });
  });

  describe("projectTangentToCoast", () => {
    it("wektor prostopadły do brzegu jest zerowany/redukowany", () => {
      const points: [number, number][] = [
        [0, 10],
        [10, 10],
        [20, 10],
        [10, 20]
      ];
      const neighbors = [[1], [0, 2, 3], [1], [1]];
      const cellsT = [-2, -1, 1, -1]; // komórka 2 to ląd (t=1), komórka 1 to szelf (t=-1)

      const [pu] = gridMath.projectTangentToCoast(5, 0, 1, cellsT, points, neighbors);
      expect(pu).toBeLessThan(0.1);
    });
  });

  describe("interpolateVector", () => {
    it("zwraca dokładną wartość w punkcie siatki", () => {
      const points: [number, number][] = [
        [10, 10],
        [20, 10],
        [10, 20]
      ];
      const fieldU = new Float32Array([12, 0, 0]);
      const fieldV = new Float32Array([5, 0, 0]);

      const [u, v] = gridMath.interpolateVector(10, 10, fieldU, fieldV, points);
      expect(u).toBe(12);
      expect(v).toBe(5);
    });

    it("interpoluje wartości między sąsiadami", () => {
      const points: [number, number][] = [
        [0, 0],
        [20, 0]
      ];
      const fieldU = new Float32Array([10, 20]);
      const fieldV = new Float32Array([0, 0]);

      const [u, v] = gridMath.interpolateVector(10, 0, fieldU, fieldV, points);
      expect(u).toBeCloseTo(15, 1); // średnia ważona
      expect(v).toBe(0);
    });

    it("zwraca [0, 0] gdy punkt jest poza promieniem poszukiwań", () => {
      const points: [number, number][] = [[0, 0]];
      const fieldU = new Float32Array([10]);
      const fieldV = new Float32Array([10]);

      const [u, v] = gridMath.interpolateVector(500, 500, fieldU, fieldV, points, 50);
      expect(u).toBe(0);
      expect(v).toBe(0);
    });
  });

  describe("traceStreamline", () => {
    it("tworzy gładką trajektorię w jednorodnym polu", () => {
      const n = 100;
      const fieldU = new Float32Array(n).fill(5); // 5 m/s na wschód
      const fieldV = new Float32Array(n).fill(0);
      const points: [number, number][] = [];
      for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 10; x++) {
          points.push([x * 10 + 5, y * 10 + 5]);
        }
      }
      const path = gridMath.traceStreamline(5, 45, fieldU, fieldV, points, 6, 8, 45);
      expect(path.length).toBeGreaterThanOrEqual(4);
      for (let i = 1; i < path.length; i++) {
        expect(path[i][0]).toBeGreaterThanOrEqual(path[i - 1][0]);
      }
    });

    it("zatrzymuje trajektorię przy ostrym zakręcie > maxAngleDeg", () => {
      // Dwa punkty: w lewym wiatr na wschód (U=5, V=0), w prawym wiatr w dół (U=0, V=5) -> kąt 90°
      const points: [number, number][] = [
        [10, 10],
        [20, 10]
      ];
      const fieldU = new Float32Array([5, 0]);
      const fieldV = new Float32Array([0, 5]);

      // maxAngleDeg = 30° -> zakręt 90° powinien przerwać trajektorię
      const path = gridMath.traceStreamline(10, 10, fieldU, fieldV, points, 10, 8, 30);
      expect(path.length).toBeLessThan(5);
    });

    it("zatrzymuje trajektorię przy krawędzi mapy", () => {
      const points: [number, number][] = [
        [95, 10],
        [100, 10]
      ];
      const fieldU = new Float32Array([10, 10]); // wiatr wieje w prawo poza granicę mapy
      const fieldV = new Float32Array([0, 0]);

      const path = gridMath.traceStreamline(90, 10, fieldU, fieldV, points, 20, 10, 45, [100, 100]);
      const lastPoint = path[path.length - 1];
      expect(lastPoint[0]).toBeLessThanOrEqual(100);
    });
  });

  describe("laplacianSmooth", () => {
    it("wygładza skoki z wieloma przebiegami (multi-pass)", () => {
      const field = new Float32Array([0, 100, 0, 100, 0]);
      const neighbors = [[1], [0, 2], [1, 3], [2, 4], [3]];

      gridMath.laplacianSmooth(field, neighbors, 0.4, 3);
      // Po 3 przebiegach różnica powinna być drastycznie zredukowana
      expect(field[1]).toBeLessThan(60);
      expect(field[0]).toBeGreaterThan(15);
    });
  });

  describe("Wydajność (Performance Benchmarks)", () => {
    it("10 000 wywołań scalarGradient trwa < 50ms", () => {
      const n = 100;
      const field = new Float32Array(n).fill(1013);
      const points: [number, number][] = Array.from({ length: n }, (_, i) => [i * 10, 50]);
      const neighbors = Array.from({ length: n }, (_, i) => [Math.max(0, i - 1), Math.min(n - 1, i + 1)]);

      const start = performance.now();
      for (let i = 0; i < 10000; i++) {
        gridMath.scalarGradient(field, i % n, points, neighbors);
      }
      const duration = performance.now() - start;
      expect(duration).toBeLessThan(50);
    });
  });
});
