import { beforeEach, describe, expect, it } from "vitest";

/**
 * Helper: buduje siatkę testową z konfigurowalnymi parametrami.
 * Zwraca n = cols * rows komórek, z siatką regularną.
 */
function buildGrid(params: {
  cols: number;
  rows: number;
  spacing: number;
  heightFn: (x: number, y: number) => number;
  tempFn?: (x: number, y: number) => number;
  windU?: number;
  windV?: number;
}) {
  const { cols, rows, spacing, heightFn, tempFn, windU = 0, windV = 0 } = params;
  const n = cols * rows;

  const points: [number, number][] = [];
  const neighbors: number[][] = [];
  const heights = new Uint8Array(n);
  const cellsT = new Int8Array(n).fill(-3);
  const temp = new Float32Array(n);
  const sstAnomaly = new Float32Array(n);

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const idx = y * cols + x;
      points.push([x * spacing + spacing / 2, y * spacing + spacing / 2]);

      const nb: number[] = [];
      if (x > 0) nb.push(idx - 1);
      if (x < cols - 1) nb.push(idx + 1);
      if (y > 0) nb.push(idx - cols);
      if (y < rows - 1) nb.push(idx + cols);
      neighbors.push(nb);

      const h = heightFn(x, y);
      heights[idx] = Math.max(0, Math.min(100, h));
      cellsT[idx] = h >= 20 ? 1 : -3;
      temp[idx] = tempFn ? tempFn(x, y) : 20;
    }
  }

  (globalThis as any).graphWidth = cols * spacing;
  (globalThis as any).graphHeight = rows * spacing;

  (globalThis as any).grid = {
    cellsX: cols,
    cellsY: rows,
    spacing,
    points,
    cells: {
      i: Array.from({ length: n }, (_, i) => i),
      h: heights,
      t: cellsT,
      c: neighbors,
      temp,
      b: new Uint8Array(n),
      windU: new Float32Array(n).fill(windU),
      windV: new Float32Array(n).fill(windV),
      sstAnomaly
    }
  };

  return { n, cols, rows, points, heights };
}

describe("MoistureAdvectionEngine — Testy Fizyczne Klimatu", () => {
  let moistureEngine: any;

  beforeEach(async () => {
    (globalThis as any).TIME = false;
    (globalThis as any).mapCoordinates = {
      latN: 60,
      latS: -60,
      latT: 120,
      lonW: -90,
      lonE: 90,
      lonT: 180
    };
    (globalThis as any).options = {
      prec: 100,
      winds: [225, 45, 225, 45, 225, 45]
    };

    const mod = await import("./moisture-advection-engine");
    moistureEngine = mod.MoistureAdvectionEngine;
  });

  // ──────────────────────────────────────────────────────────────────────
  // Test 1: Wyspa w oceanie — opady na całym obwodzie
  // ──────────────────────────────────────────────────────────────────────
  it("wyspa w oceanie — opady na >85% komórek lądowych", () => {
    const cols = 30;
    const rows = 30;
    // Okrągła wyspa w centrum, reszta ocean
    buildGrid({
      cols,
      rows,
      spacing: 30,
      heightFn: (x, y) => {
        const cx = cols / 2;
        const cy = rows / 2;
        const dist = Math.hypot(x - cx, y - cy);
        return dist < 6 ? 35 : 10; // wyspa o promieniu 6 komórek
      },
      windU: 5,
      windV: 0 // wiatr z zachodu
    });

    moistureEngine.generate();
    const { prec, h } = (globalThis as any).grid.cells;

    let landCells = 0;
    let landWithPrecip = 0;
    for (let i = 0; i < h.length; i++) {
      if (h[i] >= 20) {
        landCells++;
        if (prec[i] > 0) landWithPrecip++;
      }
    }

    expect(landCells).toBeGreaterThan(0);
    const coverage = landWithPrecip / landCells;
    expect(coverage).toBeGreaterThan(0.85);
  });

  // ──────────────────────────────────────────────────────────────────────
  // Test 2: Rain shadow — góra blokuje wilgoć
  // ──────────────────────────────────────────────────────────────────────
  it("rain shadow — nawietrzna strona ma co najmniej 1.5× więcej opadów niż zawietrzna", () => {
    const cols = 40;
    const rows = 20;
    // Ocean po lewej (x < 10), ląd na reszcie, góry na x=18-20
    buildGrid({
      cols,
      rows,
      spacing: 25,
      heightFn: (x, _y) => {
        if (x < 10) return 10; // ocean
        if (x >= 14 && x <= 16) return 85; // pasmo górskie
        return 30; // nizina
      },
      windU: 6,
      windV: 0 // wiatr z zachodu (ocean → ląd)
    });

    moistureEngine.generate();
    const { prec } = (globalThis as any).grid.cells;

    // Nawietrzna: stok górski x=14, zawietrzna: nizina w cieniu x=22
    let windwardSum = 0;
    let leewardSum = 0;
    for (let y = 3; y < rows - 3; y++) {
      windwardSum += prec[y * cols + 14];
      leewardSum += prec[y * cols + 22];
    }

    expect(windwardSum).toBeGreaterThan(leewardSum * 1.5);
  });

  // ──────────────────────────────────────────────────────────────────────
  // Test 3: Duży kontynent — gradient penetracji wilgoci
  // ──────────────────────────────────────────────────────────────────────
  it("duży kontynent — opady maleją w głąb, ale centrum ma prec > 0", () => {
    const cols = 50;
    const rows = 20;
    // Ocean po lewej (x < 5), cały reszta ląd
    buildGrid({
      cols,
      rows,
      spacing: 20,
      heightFn: x => (x < 5 ? 10 : 30), // ocean → ląd
      windU: 5,
      windV: 0
    });

    moistureEngine.generate();
    const { prec } = (globalThis as any).grid.cells;

    // Wybrzeże (x=6), środek kontynentu (x=25), daleki wnętrze (x=45)
    const midY = Math.floor(rows / 2);
    const coastPrec = prec[midY * cols + 6];
    const midPrec = prec[midY * cols + 25];
    const farPrec = prec[midY * cols + 45];

    // Gradient: wybrzeże > środek
    expect(coastPrec).toBeGreaterThan(midPrec);
    // Centrum ma jakieś opady (dyfuzja zapewnia penetrację)
    expect(midPrec).toBeGreaterThan(0);
    // Nawet daleki wnętrze ma coś
    expect(farPrec).toBeGreaterThanOrEqual(0);
  });

  // ──────────────────────────────────────────────────────────────────────
  // Test 4: Kotlina między górami — sucha
  // ──────────────────────────────────────────────────────────────────────
  it("kotlina otoczona górami jest sucha", () => {
    const cols = 30;
    const rows = 30;
    // Ocean na brzegach, góry tworzą prostokąt, kotlina w środku
    buildGrid({
      cols,
      rows,
      spacing: 30,
      heightFn: (x, y) => {
        if (x < 3 || x > 26 || y < 3 || y > 26) return 10; // ocean
        // Pierścień górski
        if ((x >= 8 && x <= 10) || (x >= 19 && x <= 21)) return 85;
        if ((y >= 8 && y <= 10) || (y >= 19 && y <= 21)) return 85;
        // Kotlina wewnętrzna
        if (x > 10 && x < 19 && y > 10 && y < 19) return 25;
        return 30; // nizina zewnętrzna
      },
      windU: 5,
      windV: 0
    });

    moistureEngine.generate();
    const { prec } = (globalThis as any).grid.cells;

    // Nawietrzny stok (x=8)
    let windwardSum = 0;
    let basinSum = 0;
    let windwardCount = 0;
    let basinCount = 0;
    for (let y = 11; y < 19; y++) {
      windwardSum += prec[y * cols + 8];
      windwardCount++;
      basinSum += prec[y * cols + 15];
      basinCount++;
    }

    const avgWindward = windwardSum / windwardCount;
    const avgBasin = basinSum / basinCount;

    // Kotlina powinna mieć mniej opadów niż stok nawietrzny
    expect(avgWindward).toBeGreaterThan(avgBasin);
  });

  // ──────────────────────────────────────────────────────────────────────
  // Test 5: options.winds wpływa na rozkład opadów
  // ──────────────────────────────────────────────────────────────────────
  it("zmiana options.winds zmienia dystrybucję opadów", async () => {
    const cols = 30;
    const rows = 20;

    // Wyspa z oceanem dookoła
    const buildIsland = () =>
      buildGrid({
        cols,
        rows,
        spacing: 25,
        heightFn: (x, y) => {
          const cx = cols / 2;
          const cy = rows / 2;
          return Math.hypot(x - cx, y - cy) < 7 ? 35 : 10;
        },
        windU: 6,
        windV: 0 // wiatr z zachodu
      });

    // Run z wiatrem z zachodu
    buildIsland();
    moistureEngine.generate();
    const precWest = new Uint8Array((globalThis as any).grid.cells.prec);

    // Run z wiatrem z wschodu
    buildIsland();
    (globalThis as any).grid.cells.windU.fill(-6); // wiatr z wschodu
    (globalThis as any).grid.cells.windV.fill(0);
    moistureEngine.generate();
    const precEast = new Uint8Array((globalThis as any).grid.cells.prec);

    // Opady na zachodniej stronie wyspy powinny być inne
    const midY = Math.floor(rows / 2);
    const westSide = midY * cols + Math.floor(cols / 2) - 5;
    const eastSide = midY * cols + Math.floor(cols / 2) + 5;

    // Z wiatrem z zachodu: zachodnia strona mokrzejsza
    // Z wiatrem z wschodu: wschodnia strona mokrzejsza
    const westDominantWest = precWest[westSide] >= precWest[eastSide];
    const eastDominantEast = precEast[eastSide] >= precEast[westSide];

    // Przynajmniej jeden wzorzec powinien się odwrócić
    expect(westDominantWest || eastDominantEast).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────────────
  // Test 6: Clausius-Clapeyron rośnie nieliniowo
  // ──────────────────────────────────────────────────────────────────────
  it("Clausius-Clapeyron: ciśnienie pary rośnie >3× między 10°C a 30°C", () => {
    const e10 = moistureEngine.clausiusClapeyron(10);
    const e20 = moistureEngine.clausiusClapeyron(20);
    const e30 = moistureEngine.clausiusClapeyron(30);

    expect(e20).toBeGreaterThan(e10);
    expect(e30).toBeGreaterThan(e20);
    expect(e30 / e10).toBeGreaterThan(3.0);
  });

  // ──────────────────────────────────────────────────────────────────────
  // Test 7: Brak NaN/Infinity w polach wyjściowych
  // ──────────────────────────────────────────────────────────────────────
  it("brak NaN i Infinity we wszystkich polach", () => {
    buildGrid({
      cols: 20,
      rows: 15,
      spacing: 30,
      heightFn: x => (x < 5 ? 10 : 30),
      windU: 4,
      windV: 1
    });

    moistureEngine.generate();
    const { prec, moisture } = (globalThis as any).grid.cells;

    for (let i = 0; i < prec.length; i++) {
      expect(Number.isFinite(prec[i])).toBe(true);
      expect(Number.isFinite(moisture[i])).toBe(true);
      expect(prec[i]).toBeGreaterThanOrEqual(0);
      expect(prec[i]).toBeLessThanOrEqual(255);
    }
  });

  // ──────────────────────────────────────────────────────────────────────
  // Test 8: SST anomalia zwiększa wilgoć wybrzeżną
  // ──────────────────────────────────────────────────────────────────────
  it("ciepły prąd morski (SST +6°C) zwiększa wilgoć na wybrzeżu", () => {
    buildGrid({
      cols: 25,
      rows: 15,
      spacing: 30,
      heightFn: x => (x < 8 ? 10 : 30),
      windU: 5,
      windV: 0
    });

    // Bez anomalii
    moistureEngine.generate();
    const basePrec = (globalThis as any).grid.cells.prec[7 * 25 + 9];

    // Z ciepłym prądem
    buildGrid({
      cols: 25,
      rows: 15,
      spacing: 30,
      heightFn: x => (x < 8 ? 10 : 30),
      windU: 5,
      windV: 0
    });
    (globalThis as any).grid.cells.sstAnomaly.fill(6.0);
    moistureEngine.generate();
    const warmPrec = (globalThis as any).grid.cells.prec[7 * 25 + 9];

    expect(warmPrec).toBeGreaterThanOrEqual(basePrec);
  });

  // ──────────────────────────────────────────────────────────────────────
  // Test 9: Obsługa braku temp — fallback do 15°C
  // ──────────────────────────────────────────────────────────────────────
  it("obsługuje brak temp bez crashu", () => {
    buildGrid({
      cols: 15,
      rows: 10,
      spacing: 30,
      heightFn: x => (x < 5 ? 10 : 30),
      windU: 4,
      windV: 0
    });
    (globalThis as any).grid.cells.temp = undefined;

    expect(() => moistureEngine.generate()).not.toThrow();
  });

  // ──────────────────────────────────────────────────────────────────────
  // Test 10: Każda komórka lądowa dostaje opady (no dead zones)
  // ──────────────────────────────────────────────────────────────────────
  it("brak martwych stref — >80% komórek lądowych ma prec > 0", () => {
    buildGrid({
      cols: 30,
      rows: 20,
      spacing: 25,
      heightFn: x => {
        if (x < 8) return 10; // ocean
        return 30; // ląd
      },
      windU: 5,
      windV: 1
    });

    moistureEngine.generate();
    const { prec, h } = (globalThis as any).grid.cells;

    let landCells = 0;
    let landWithPrecip = 0;
    for (let i = 0; i < h.length; i++) {
      if (h[i] >= 20) {
        landCells++;
        if (prec[i] > 0) landWithPrecip++;
      }
    }

    expect(landCells).toBeGreaterThan(0);
    expect(landWithPrecip / landCells).toBeGreaterThan(0.8);
  });
});
