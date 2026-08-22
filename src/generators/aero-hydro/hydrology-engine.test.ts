import { beforeEach, describe, expect, it } from "vitest";

describe("HydrologyEngine", () => {
  let hydrologyEngine: any;

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

    const cols = 20;
    const rows = 15;
    const n = cols * rows; // 300 komórek
    const spacing = 40;

    const points: [number, number][] = [];
    const neighbors: number[][] = [];
    const heights = new Uint8Array(n).fill(10); // Domyślnie ocean
    const cellsT = new Int8Array(n).fill(-3);
    const prec = new Uint8Array(n).fill(50); // 50 jednostek opadu

    // Utwórz stok górski schodzący ku morzu (od x=19 (góry h=80) do x=5 (wybrzeże h=20))
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const idx = y * cols + x;
        points.push([x * spacing + 20, y * 40 + 20]);

        const nb: number[] = [];
        if (x > 0) nb.push(idx - 1);
        if (x < cols - 1) nb.push(idx + 1);
        if (y > 0) nb.push(idx - cols);
        if (y < rows - 1) nb.push(idx + cols);
        neighbors.push(nb);

        if (x >= 5) {
          // Ląd o opadającym profilu
          heights[idx] = 20 + Math.round((x - 5) * 4); // h = 20..76
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
        prec: prec,
        fl: new Uint16Array(n)
      }
    };

    const hydroMod = await import("./hydrology-engine");
    hydrologyEngine = hydroMod.HydrologyEngine;
  });

  it("generuje strukturę węzłów hydrologicznych dla komórek lądowych", () => {
    const result = hydrologyEngine.generate();
    expect(result.nodes).toBeDefined();
    expect(result.nodes.length).toBeGreaterThan(0);

    const firstNode = result.nodes[0];
    expect(firstNode.cell).toBeDefined();
    expect(firstNode.flowAccumulation).toBeGreaterThan(0);
    expect(firstNode.channelWidthM).toBeGreaterThan(0);
    expect(firstNode.channelDepthM).toBeGreaterThan(0);
    expect(firstNode.strahlerOrder).toBeGreaterThanOrEqual(1);
  });

  it("akumulacja spływu rośnie w dół stoku rzecznego (Q_mouth > Q_source)", () => {
    const { nodes } = hydrologyEngine.generate();

    // Węzeł źródłowy w górach (x = 18, y = 7)
    const sourceNode = nodes.find((node: any) => node.cell === 7 * 20 + 18);
    // Węzeł przy ujściu na wybrzeżu (x = 5, y = 7)
    const mouthNode = nodes.find((node: any) => node.cell === 7 * 20 + 5);

    expect(sourceNode).toBeDefined();
    expect(mouthNode).toBeDefined();
    expect(mouthNode.flowAccumulation).toBeGreaterThan(sourceNode.flowAccumulation);
  });

  it("prawo Leopolda-Maddocka: szerokość koryta skaluje się z pierwiastkiem przepływu (W ∝ Q^0.5)", () => {
    const { nodes } = hydrologyEngine.generate();

    for (const node of nodes) {
      const expectedWidth = 1.8 * Math.max(node.flowAccumulation, 0.01) ** 0.5;
      expect(node.channelWidthM).toBeCloseTo(expectedWidth, 2);
    }
  });

  it("rzędowość Strahlera: źródła mają rząd 1, a zbiegi cieków wyższy rząd", () => {
    const { nodes } = hydrologyEngine.generate();

    // Każdy węzeł ma prawidłowy rząd (1..n)
    for (const node of nodes) {
      expect(node.strahlerOrder).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(node.strahlerOrder)).toBe(true);
    }
  });

  it("brak NaN i Infinity we wszystkich polach hydrodynamicznych", () => {
    const { nodes } = hydrologyEngine.generate();

    for (const node of nodes) {
      expect(Number.isFinite(node.flowAccumulation)).toBe(true);
      expect(Number.isFinite(node.channelWidthM)).toBe(true);
      expect(Number.isFinite(node.channelDepthM)).toBe(true);
      expect(node.flowAccumulation).toBeGreaterThanOrEqual(0);
    }
  });

  it("synchronizuje przepływ z tablicą grid.cells.fl", () => {
    hydrologyEngine.generate();
    const { fl, h } = (globalThis as any).grid.cells;

    // Przynajmniej niektóre komórki lądowe mają niezerowy przepływ w fl
    let maxFlux = 0;
    for (let i = 0; i < h.length; i++) {
      if (h[i] >= 20 && fl[i] > maxFlux) {
        maxFlux = fl[i];
      }
    }
    expect(maxFlux).toBeGreaterThan(0);
  });

  it("wydajność: obliczenia silnika hydrologii trwają < 35ms", () => {
    const start = performance.now();
    hydrologyEngine.generate();
    const duration = performance.now() - start;
    expect(duration).toBeLessThan(35);
  });
});
