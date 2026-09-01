import { describe, expect, it } from "vitest";
import { Biomes } from "../biomes-generator";
import { AeroHydro } from "./index";

describe("Fate World Map (Black-Box Aero-Hydro & Biomes Validation)", () => {
  it("generates physically grounded climate, temperatures, precipitation and biomes on the Fate domain", () => {
    // 1. Inicjalizacja siatki modelowej opartej na współrzędnych i topografii świata Fate
    const COLS = 20;
    const ROWS = 20;
    const N = COLS * ROWS;
    const points: [number, number][] = [];
    const heights = new Uint8Array(N);
    const neighbors: number[][] = [];

    // Siatka 20x20 w oknie 3800 x 2850
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const x = (c / (COLS - 1)) * 3800;
        const y = (r / (ROWS - 1)) * 2850;
        points.push([x, y]);

        const idx = r * COLS + c;
        // Topografia:
        // Zachód (c <= 1, r <= 7): Ocean Atlantycki / Morze Północne h=10
        // Północ (r <= 5): Ląd nizinny (Polska, Niemcy) h=25
        // Morze Bałtyckie (r=0..2, c=12..16): woda h=10
        // Centrum-Północ (r=6..8, c=5..16): Góry Alpy/Karpaty h=80
        // Centrum-Południe (r=9..13, c=1..18): Morze Śródziemne h=10
        // Południe (r >= 14): Ląd nizinny pustynny (Egipt, Sahara) h=25
        let h = 25;
        if (c <= 1 && r <= 7) {
          h = 10; // Ocean Atlantycki / Morze Północne
        } else if (r <= 2 && c >= 12 && c <= 16) {
          h = 10; // Morze Bałtyckie
        } else if (r >= 6 && r <= 8 && c >= 5 && c <= 16) {
          h = 80; // Góry centralne (Alpy / Karpaty)
        } else if (r >= 9 && r <= 13 && c >= 1 && c <= 18) {
          h = 10; // Morze Śródziemne
        } else if (r >= 14) {
          h = 25; // Afryka Północna / Egipt
        }
        heights[idx] = h;

        // Sąsiedzi 4-kierunkowi
        const nb: number[] = [];
        if (r > 0) nb.push((r - 1) * COLS + c);
        if (r < ROWS - 1) nb.push((r + 1) * COLS + c);
        if (c > 0) nb.push(r * COLS + (c - 1));
        if (c < COLS - 1) nb.push(r * COLS + (c + 1));
        neighbors.push(nb);
      }
    }

    const gridRef = new Uint32Array(N);
    for (let i = 0; i < N; i++) gridRef[i] = i;

    (globalThis as any).grid = {
      cells: {
        i: Array.from({ length: N }, (_, i) => i),
        h: heights,
        c: neighbors,
        temp: new Int8Array(N),
        prec: new Uint8Array(N),
        pressure: new Float32Array(N),
        windU: new Float32Array(N),
        windV: new Float32Array(N),
        windSpeed: new Float32Array(N)
      },
      points,
      spacing: 150,
      cellsX: COLS,
      cellsY: ROWS
    };

    (globalThis as any).pack = {
      cells: {
        i: Array.from({ length: N }, (_, i) => i),
        h: heights,
        c: neighbors,
        g: gridRef,
        fl: new Uint16Array(N),
        r: new Uint16Array(N),
        biome: new Uint8Array(N)
      },
      biomes: Biomes.getDefault()
    };

    // Rzeka Nil w dolnej części (r=16..19, c=10)
    for (let r = 16; r < ROWS; r++) {
      const cell = r * COLS + 10;
      (globalThis as any).pack.cells.r[cell] = 1;
      (globalThis as any).pack.cells.fl[cell] = 150; // duży przepływ
    }

    (globalThis as any).options = {
      temperatureEquator: 27,
      temperatureNorthPole: -12,
      temperatureSouthPole: -15,
      winds: [225, 225, 45, 315, 135, 315],
      prec: 100
    };

    (globalThis as any).mapCoordinates = {
      latN: 53.6,
      latS: 29.7,
      latT: 23.9,
      lonW: 5.4,
      lonE: 37.3,
      lonT: 31.9
    };
    (globalThis as any).graphHeight = 2850;
    (globalThis as any).graphWidth = 3800;

    // 2. Uruchomienie zintegrowanego potoku AeroHydro i Biomes
    AeroHydro.generate();
    Biomes.define();

    const temp = (globalThis as any).grid.cells.temp;
    const prec = (globalThis as any).grid.cells.prec;
    const biome = (globalThis as any).pack.cells.biome;

    // ─── Weryfikacja 1: Strefa Południowa (Egipt / Północna Sahara: r >= 16, lat ~29.7-33°N) ───
    const southDryCell = 18 * COLS + 3; // suchy ląd bez rzeki
    const southLat = 53.6 - (points[southDryCell][1] / 2850) * 23.9;
    expect(southLat).toBeLessThan(33.0);
    expect(temp[southDryCell]).toBeGreaterThanOrEqual(21); // Ciepły klimat subtropikalny/zwrotnikowy
    expect([7, 8, 15].includes(biome[southDryCell])).toBe(true); // Pustynia / półpustynia zwrotnikowa

    // Komórka rzeczna (Dolina Nilu / Oaza)
    const nileCell = 18 * COLS + 10;
    expect([15, 16, 22, 28].includes(biome[nileCell])).toBe(true); // Oaza nadrzeczna / zarośla subtropikalne

    // ─── Weryfikacja 2: Góry Środkowe (Alpy / Karpaty: r=7, c=10, h=80, lat ~45°N) ───
    const mountainCell = 7 * COLS + 10;
    const mountainLat = 53.6 - (points[mountainCell][1] / 2850) * 23.9;
    expect(mountainLat).toBeGreaterThan(43.0);
    expect(mountainLat).toBeLessThan(47.0);
    // Spadek temperatury na h=80 (wysokość ~2300m) z poziomu morza ~13°C daje ok. -2 do +1°C
    expect(temp[mountainCell]).toBeLessThanOrEqual(2);
    expect(biome[mountainCell]).toBe(43); // Montane glaciers (ponieważ T < 0°C na szczycie w strefie chłodnej)

    // ─── Weryfikacja 3: Nizina Europy Środkowej (Polska / Niemcy: r=3, c=6, h=25, lat ~49-51°N) ───
    const centralEuropeCell = 3 * COLS + 6;
    expect(temp[centralEuropeCell]).toBeGreaterThanOrEqual(8);
    expect(temp[centralEuropeCell]).toBeLessThanOrEqual(12);
    expect(prec[centralEuropeCell]).toBeGreaterThanOrEqual(6); // Opad umiarkowany >= 330 mm
    // Biomy umiarkowane nizinne (Grasslands / Woodlands / Forests: ID 20, 21, 26, 27, 31, 32)
    expect([20, 21, 26, 27, 31, 32].includes(biome[centralEuropeCell])).toBe(true);

    // ─── Weryfikacja 4: Brak patologii - brak lodowców na nizinach śródziemnomorskich ───
    for (let r = 14; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const idx = r * COLS + c;
        expect(biome[idx]).not.toBe(1); // Brak nizinnych lodowców na południu
        expect(biome[idx]).not.toBe(43); // Brak górskich lodowców na nizinach południa
      }
    }
  });

  it("verifies orographic rain shadow and Foehn effect across major mountain barriers", () => {
    // Topografia z łańcuchem górskim w centrum: wiatr wieje z zachodu na wschód
    const COLS = 16;
    const ROWS = 10;
    const N = COLS * ROWS;
    const points: [number, number][] = [];
    const heights = new Uint8Array(N);
    const neighbors: number[][] = [];

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        points.push([c * 200 + 100, r * 200 + 100]);
        const idx = r * COLS + c;
        // Grzbiet górski na c=7..8 (wysokie szczyty h=85)
        let h = 25; // nizinny ląd bazowy
        if (c <= 1) h = 10; // Ocean na zachodzie
        else if (c === 7 || c === 8) h = 85; // Grzbiet górski

        heights[idx] = h;

        const nb: number[] = [];
        if (r > 0) nb.push((r - 1) * COLS + c);
        if (r < ROWS - 1) nb.push((r + 1) * COLS + c);
        if (c > 0) nb.push(r * COLS + (c - 1));
        if (c < COLS - 1) nb.push(r * COLS + (c + 1));
        neighbors.push(nb);
      }
    }

    const gridRef = new Uint32Array(N);
    for (let i = 0; i < N; i++) gridRef[i] = i;

    (globalThis as any).grid = {
      cells: {
        i: Array.from({ length: N }, (_, i) => i),
        h: heights,
        c: neighbors,
        temp: new Int8Array(N),
        prec: new Uint8Array(N),
        pressure: new Float32Array(N),
        windU: new Float32Array(N),
        windV: new Float32Array(N),
        windSpeed: new Float32Array(N)
      },
      points,
      spacing: 200,
      cellsX: COLS,
      cellsY: ROWS
    };

    (globalThis as any).pack = {
      cells: {
        i: Array.from({ length: N }, (_, i) => i),
        h: heights,
        c: neighbors,
        g: gridRef,
        fl: new Uint16Array(N),
        r: new Uint16Array(N),
        biome: new Uint8Array(N)
      },
      biomes: Biomes.getDefault()
    };

    (globalThis as any).options = {
      temperatureEquator: 27,
      temperatureNorthPole: -12,
      temperatureSouthPole: -15,
      winds: [225, 90, 45, 315, 135, 315], // Westerlies wiejące na wschód
      prec: 100
    };

    (globalThis as any).mapCoordinates = {
      latN: 52.0,
      latS: 44.0,
      latT: 8.0,
      lonW: 5.0,
      lonE: 25.0,
      lonT: 20.0
    };
    (globalThis as any).graphHeight = 2000;
    (globalThis as any).graphWidth = 3200;

    AeroHydro.generate();

    const prec = (globalThis as any).grid.cells.prec;
    const midRow = 5;
    const windwardCell = midRow * COLS + 6; // stok nawietrzny tuż przed granią
    const peakCell = midRow * COLS + 7; // szczyt
    const leewardCell = midRow * COLS + 9; // cień zawietrzny tuż za granią

    // 1. Szczyt i stok nawietrzny otrzymują intensywny opad orograficzny
    const maxWindwardPrec = Math.max(prec[windwardCell], prec[peakCell]);
    expect(maxWindwardPrec).toBeGreaterThanOrEqual(10);

    // 2. Stok zawietrzny (Rain Shadow) ma wyraźnie obniżony opad względem szczytu/nawietrznej
    expect(prec[leewardCell]).toBeLessThan(maxWindwardPrec);
  });

  it("verifies stable continental precipitation scaling without sudden desert collapse", () => {
    const COLS = 10;
    const ROWS = 10;
    const N = COLS * ROWS;
    const points: [number, number][] = [];
    const heights = new Uint8Array(N).fill(25); // Płaski ląd nizinny
    const neighbors: number[][] = [];

    // Brzeg oceaniczny na zachodzie (c=0)
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        points.push([c * 200 + 100, r * 200 + 100]);
        const idx = r * COLS + c;
        if (c === 0) heights[idx] = 10;

        const nb: number[] = [];
        if (r > 0) nb.push((r - 1) * COLS + c);
        if (r < ROWS - 1) nb.push((r + 1) * COLS + c);
        if (c > 0) nb.push(r * COLS + (c - 1));
        if (c < COLS - 1) nb.push(r * COLS + (c + 1));
        neighbors.push(nb);
      }
    }

    const gridRef = new Uint32Array(N);
    for (let i = 0; i < N; i++) gridRef[i] = i;

    (globalThis as any).grid = {
      cells: {
        i: Array.from({ length: N }, (_, i) => i),
        h: heights,
        c: neighbors,
        temp: new Int8Array(N),
        prec: new Uint8Array(N),
        pressure: new Float32Array(N),
        windU: new Float32Array(N),
        windV: new Float32Array(N),
        windSpeed: new Float32Array(N)
      },
      points,
      spacing: 200,
      cellsX: COLS,
      cellsY: ROWS
    };

    (globalThis as any).pack = {
      cells: {
        i: Array.from({ length: N }, (_, i) => i),
        h: heights,
        c: neighbors,
        g: gridRef,
        fl: new Uint16Array(N),
        r: new Uint16Array(N),
        biome: new Uint8Array(N)
      },
      biomes: Biomes.getDefault()
    };

    // Umiarkowana szerokość geograficzna 50°N przy obniżonym opadzie (prec = 65%)
    (globalThis as any).options = {
      temperatureEquator: 27,
      temperatureNorthPole: -12,
      temperatureSouthPole: -15,
      winds: [225, 90, 45, 315, 135, 315],
      prec: 65
    };

    (globalThis as any).mapCoordinates = {
      latN: 54.0,
      latS: 46.0,
      latT: 8.0,
      lonW: 10.0,
      lonE: 30.0,
      lonT: 20.0
    };
    (globalThis as any).graphHeight = 2000;
    (globalThis as any).graphWidth = 2000;

    AeroHydro.generate();
    Biomes.define();

    const biome = (globalThis as any).pack.cells.biome;
    const inlandCell = 5 * COLS + 7; // środek lądu

    // Przy prec=65% na 50°N środek kontynentu powinien być trawami/stepem/zadrzewieniem (18..27),
    // a NIE pustynią (2..9)!
    expect(biome[inlandCell]).toBeGreaterThanOrEqual(10);
    expect([2, 3, 4, 5, 6, 7, 8, 9].includes(biome[inlandCell])).toBe(false);
  });
});
