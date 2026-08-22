import { beforeEach, describe, expect, it } from "vitest";

describe("MoistureAdvectionEngine", () => {
  let moistureEngine: any;

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
    const heights = new Uint8Array(n).fill(10); // Ocean po lewej
    const cellsT = new Int8Array(n).fill(-3);

    // Utwórz konfigurację: Ocean po lewej (x: 0..9), Ląd po prawej (x: 10..29)
    // Pasmo górskie w kolumnach 14–16 (h = 80)
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const idx = y * cols + x;
        // P0 FIX: dodawanie pojedynczej pary [x, y] do tablicy points
        points.push([x * spacing + 16, y * 30 + 15]);

        const nb: number[] = [];
        if (x > 0) nb.push(idx - 1);
        if (x < cols - 1) nb.push(idx + 1);
        if (y > 0) nb.push(idx - cols);
        if (y < rows - 1) nb.push(idx + cols);
        neighbors.push(nb);

        if (x >= 10) {
          heights[idx] = 30; // nizina
          cellsT[idx] = 1;
        }
        if (x >= 11 && x <= 13 && y >= 3 && y <= 16) {
          heights[idx] = 80; // pasmo górskie przybrzeżne
        }
      }
    }

    const windU = new Float32Array(n).fill(5.0); // Wiatr wiejący na wschód (5 m/s)
    const windV = new Float32Array(n).fill(0);
    const sstAnomaly = new Float32Array(n).fill(0);
    const temp = new Float32Array(n).fill(20); // P0 FIX: Float32Array

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
        temp: temp,
        windU: windU,
        windV: windV,
        sstAnomaly: sstAnomaly,
        b: new Uint8Array(n)
      }
    };

    (globalThis as any).options = {
      prec: 100,
      moistureAdvection: {
        minPrecipMmYr: 10,
        advectionPasses: 4,
        diffusionCoeff: 0.15,
        advectionRate: 0.6,
        orographicEfficiency: 0.75,
        baseRainoutRate: 0.08
      }
    };

    const moistMod = await import("./moisture-advection-engine");
    moistureEngine = moistMod.MoistureAdvectionEngine;
  });

  it("generuje pola prec (Uint8Array) i moisture (Float32Array)", () => {
    moistureEngine.generate();
    const { prec, moisture } = (globalThis as any).grid.cells;

    expect(prec).toBeInstanceOf(Uint8Array);
    expect(moisture).toBeInstanceOf(Float32Array);
    expect(prec.length).toBe(600);
    expect(moisture.length).toBe(600);
  });

  it("równanie Clausiusa-Clapeyrona rośnie nieliniowo z temperaturą", () => {
    const e10 = moistureEngine.clausiusClapeyron(10);
    const e20 = moistureEngine.clausiusClapeyron(20);
    const e30 = moistureEngine.clausiusClapeyron(30);

    expect(e20).toBeGreaterThan(e10);
    expect(e30).toBeGreaterThan(e20);
    // Wzrost z 10°C do 30°C to ponad 3-krotny wzrost ciśnienia pary nasyconej
    expect(e30 / e10).toBeGreaterThan(3.0);
  });

  it("brak martwych stref — każda komórka lądowa ma prec > 0", () => {
    moistureEngine.generate();
    const { prec, h } = (globalThis as any).grid.cells;

    for (let i = 0; i < h.length; i++) {
      if (h[i] >= 20) {
        expect(prec[i]).toBeGreaterThan(0);
      }
    }
  });

  it("efekt orograficzny i cień opadowy (Föhn effect): nawietrzna strona ma znacznie wyższe opady niż zawietrzna", () => {
    const { windU, windV } = (globalThis as any).grid.cells;
    windU.fill(8.0); // silny wiatr z zachodu na wschód (prosto w góry)
    windV.fill(0);

    moistureEngine.generate();
    const { prec } = (globalThis as any).grid.cells;

    // Nawietrzny stok górski (x = 11, y = 10), gdzie wilgotny wiatr z oceanu wspina się na pasmo
    const windwardIdx = 10 * 30 + 11;
    // Zawietrzna komórka (x = 18, y = 10) za grzbietem w cieniu opadowym (efekt Fenu)
    const leewardIdx = 10 * 30 + 18;

    expect(prec[windwardIdx]).toBeGreaterThan(prec[leewardIdx]);
    // Opad po stronie nawietrznej powinien być co najmniej 1.5x wyższy niż w cieniu
    expect(prec[windwardIdx] / Math.max(prec[leewardIdx], 1)).toBeGreaterThan(1.5);
  });

  it("anomalia SST zwiększa parowanie i wilgoć docierającą do wybrzeża", () => {
    // 1. Wygeneruj z zerową anomalią SST
    (globalThis as any).grid.cells.sstAnomaly.fill(0);
    moistureEngine.generate();
    const baseCoastMoisture = (globalThis as any).grid.cells.moisture[10 * 30 + 10];

    // 2. Wygeneruj z silną dodatnią anomalią SST (ciepły prąd morski +6°C)
    (globalThis as any).grid.cells.sstAnomaly.fill(6.0);
    moistureEngine.generate();
    const warmCoastMoisture = (globalThis as any).grid.cells.moisture[10 * 30 + 10];

    expect(warmCoastMoisture).toBeGreaterThan(baseCoastMoisture);
  });

  it("modyfikator precModifier (options.prec) skaluje wartości opadów", () => {
    (globalThis as any).options.prec = 50;
    moistureEngine.generate();
    const rainLow = (globalThis as any).grid.cells.prec[10 * 30 + 11];

    (globalThis as any).options.prec = 150;
    moistureEngine.generate();
    const rainHigh = (globalThis as any).grid.cells.prec[10 * 30 + 11];

    expect(rainHigh).toBeGreaterThan(rainLow);
  });

  it("brak NaN i Infinity we wszystkich polach wilgoci i opadów", () => {
    moistureEngine.generate();
    const { prec, moisture } = (globalThis as any).grid.cells;

    for (let i = 0; i < prec.length; i++) {
      expect(Number.isFinite(prec[i])).toBe(true);
      expect(Number.isFinite(moisture[i])).toBe(true);
      expect(prec[i]).toBeGreaterThanOrEqual(0);
      expect(prec[i]).toBeLessThanOrEqual(255);
    }
  });

  it("wydajność: obliczenia silnika wilgoci trwają < 35ms", () => {
    const start = performance.now();
    moistureEngine.generate();
    const duration = performance.now() - start;
    expect(duration).toBeLessThan(35);
  });
});
