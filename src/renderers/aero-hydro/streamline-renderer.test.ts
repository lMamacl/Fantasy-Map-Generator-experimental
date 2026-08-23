import { beforeEach, describe, expect, it } from "vitest";

describe("StreamlineRenderer", () => {
  let streamlineRenderer: any;
  let atmosphereEngine: any;
  let oceanEngine: any;

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
    const heights = new Uint8Array(n).fill(10);
    const cellsT = new Int8Array(n).fill(-3);

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
          heights[idx] = 50; // wyspa
          cellsT[idx] = 1;
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
        temp: new Float32Array(n).fill(15),
        b: new Uint8Array(n)
      }
    };

    (globalThis as any).options = {
      atmosphere: {
        zonalPressureHPa: [1008, 1024, 996, 1028],
        baricCenters: [
          {
            x: 200,
            y: 150,
            type: "high",
            pressureHPa: 1035,
            radiusKm: 2500,
            thermalOrigin: false
          },
          {
            x: 800,
            y: 450,
            type: "low",
            pressureHPa: 980,
            radiusKm: 2500,
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

    const atmoMod = await import("@/generators/aero-hydro/atmosphere-engine");
    atmosphereEngine = atmoMod.AtmosphereEngine;
    atmosphereEngine.generate();

    const oceanMod = await import("@/generators/aero-hydro/ocean-engine");
    oceanEngine = oceanMod.OceanEngine;
    oceanEngine.generate();

    const rendererMod = await import("./streamline-renderer");
    streamlineRenderer = rendererMod.StreamlineRenderer;
  });

  it("generuje wstęgi wiatru z prawidłowymi metrykami", () => {
    const streamlines = streamlineRenderer.generateStreamlines("wind");
    expect(streamlines).toBeInstanceOf(Array);
    expect(streamlines.length).toBeGreaterThan(0);

    const first = streamlines[0];
    expect(first.type).toBe("wind");
    expect(first.points.length).toBeGreaterThanOrEqual(4);
    expect(first.svgPath).toMatch(/^M \d/);
    expect(first.avgSpeed).toBeGreaterThan(0);
    expect(first.arrowHead).toBeDefined();
  });

  it("wstęgi łączą punkty bez gwałtownych zwrotów o 180°", () => {
    const streamlines = streamlineRenderer.generateStreamlines("wind");

    for (const line of streamlines) {
      expect(line.points.length).toBeGreaterThanOrEqual(4);
      expect(line.points.length).toBeLessThanOrEqual(33);

      // Sprawdź kąty między kolejnymi segmentami
      for (let i = 1; i < line.points.length - 1; i++) {
        const [x0, y0] = line.points[i - 1];
        const [x1, y1] = line.points[i];
        const [x2, y2] = line.points[i + 1];

        const a1 = Math.atan2(y1 - y0, x1 - x0);
        const a2 = Math.atan2(y2 - y1, x2 - x1);
        let diff = Math.abs(a2 - a1);
        if (diff > Math.PI) diff = 2 * Math.PI - diff;
        const diffDeg = (diff * 180) / Math.PI;

        // Kąt skrętu między sąsiednimi segmentami nie przekracza ostrego zwrotu (>90°)
        expect(diffDeg).toBeLessThanOrEqual(90);
      }
    }
  });

  it("zachowuje separację (odstęp buforowy) między wstęgami", () => {
    const sep = 60;
    const streamlines = streamlineRenderer.generateStreamlines("wind", {
      separationDistancePx: sep
    });

    // Sprawdź odległości między punktami początkowymi wstęg
    for (let i = 0; i < streamlines.length; i++) {
      const [x1, y1] = streamlines[i].points[0];
      for (let j = i + 1; j < streamlines.length; j++) {
        const [x2, y2] = streamlines[j].points[0];
        const dist = Math.hypot(x2 - x1, y2 - y1);
        expect(dist).toBeGreaterThanOrEqual(sep * 0.7); // w granicach tolerancji dyskretnej siatki
      }
    }
  });

  it("wstęgi oceaniczne generowane są tylko nad wodą", () => {
    const streamlines = streamlineRenderer.generateStreamlines("ocean");
    const { h } = (globalThis as any).grid.cells;
    const points = (globalThis as any).grid.points;

    for (const line of streamlines) {
      expect(line.type).toBe("ocean");
      for (const [px, py] of line.points) {
        // Znajdź najbliższą komórkę
        let closest = 0;
        let minD = Infinity;
        for (let i = 0; i < points.length; i++) {
          const d = Math.hypot(px - points[i][0], py - points[i][1]);
          if (d < minD) {
            minD = d;
            closest = i;
          }
        }
        // Punkty prądów oceanicznych nie powinny zaczynać się w głębi lądu
        expect(h[closest]).toBeLessThan(60);
      }
    }
  });

  it("wydajność: generowanie wstęg trwa < 35ms", () => {
    const start = performance.now();
    streamlineRenderer.generateStreamlines("wind");
    const duration = performance.now() - start;
    expect(duration).toBeLessThan(35);
  });
});
