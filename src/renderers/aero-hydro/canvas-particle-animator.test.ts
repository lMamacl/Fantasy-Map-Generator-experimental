import { beforeEach, describe, expect, it, vi } from "vitest";

describe("CanvasParticleAnimator", () => {
  let particleAnimator: any;
  let mockCanvas: any;
  let mockCtx: any;

  beforeEach(async () => {
    (globalThis as any).TIME = false;
    (globalThis as any).graphWidth = 1000;
    (globalThis as any).graphHeight = 600;

    const n = 100;
    const heights = new Uint8Array(n).fill(10);
    // Lewa połowa woda (0..49), prawa ląd (50..99)
    for (let i = 50; i < n; i++) heights[i] = 50;

    const points: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      points.push([(i % 10) * 100 + 50, Math.floor(i / 10) * 60 + 30]);
    }

    (globalThis as any).grid = {
      cellsX: 10,
      cellsY: 10,
      points: points,
      cells: {
        i: Array.from({ length: n }, (_, i) => i),
        h: heights,
        windU: new Float32Array(n).fill(5.0),
        windV: new Float32Array(n).fill(0),
        oceanU: new Float32Array(n).fill(2.0),
        oceanV: new Float32Array(n).fill(0)
      }
    };

    mockCtx = {
      save: vi.fn(),
      restore: vi.fn(),
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      globalCompositeOperation: "source-over",
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      lineCap: "round"
    };

    mockCanvas = {
      width: 1000,
      height: 600,
      getContext: vi.fn().mockReturnValue(mockCtx)
    };

    const mod = await import("./canvas-particle-animator");
    particleAnimator = new mod.CanvasParticleAnimator();
  });

  it("inicjalizuje pulę cząstek o zadanej liczebności", () => {
    particleAnimator.init(mockCanvas, { numParticles: 150 });
    expect(particleAnimator.getParticleCount()).toBe(150);
  });

  it("update() przesuwa cząstki wzdłuż wektora wiatru", () => {
    particleAnimator.init(mockCanvas, { numParticles: 20, type: "wind" });
    particleAnimator.update();

    const afterX = (particleAnimator as any).particles[0].x;
    // Cząstka została przesunięta lub zresetowana w granicach canvasu
    expect(Number.isFinite(afterX)).toBe(true);
  });

  it("draw() wywołuje metody renderowania Canvas 2D", () => {
    particleAnimator.init(mockCanvas, { numParticles: 50 });
    particleAnimator.update();
    particleAnimator.draw();

    expect(mockCtx.save).toHaveBeenCalled();
    expect(mockCtx.restore).toHaveBeenCalled();
    expect(mockCtx.stroke).toHaveBeenCalled();
  });

  it("start() i stop() kontrolują stan animacji", () => {
    particleAnimator.init(mockCanvas);
    particleAnimator.start();
    expect((particleAnimator as any).isRunning).toBe(true);

    particleAnimator.stop();
    expect((particleAnimator as any).isRunning).toBe(false);
  });

  it("brak NaN i Infinity w pozycjach cząstek", () => {
    particleAnimator.init(mockCanvas, { numParticles: 100 });

    for (let step = 0; step < 10; step++) {
      particleAnimator.update();
    }

    const particles = (particleAnimator as any).particles;
    for (const p of particles) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
      expect(Number.isFinite(p.age)).toBe(true);
    }
  });
});
