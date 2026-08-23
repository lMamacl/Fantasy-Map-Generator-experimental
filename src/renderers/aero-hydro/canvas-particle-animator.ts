/**
 * Silnik animacji cząstek Canvas 2D (Aero-Hydro 2.0).
 *
 * Zoptymalizowany pod kątem wydajności O(1) i estetyki:
 *   - 3200 aktywnych cząstek z przezroczystym motion blur (bez czarnego tła)
 *   - Zrównoważona prędkość dryfu (1.5 px/ramkę) dla majestatycznego przepływu
 *   - Kolorystyka i grubość linii zależna od prędkości przepływu |V|
 *
 * @module renderers/aero-hydro/canvas-particle-animator
 */

import { findClosestCellFast } from "@/utils/grid-math";
import { getSpeedColor } from "./draw-aero-hydro";

export interface Particle {
  x: number;
  y: number;
  oldX: number;
  oldY: number;
  age: number;
  maxAge: number;
  speed: number;
}

export interface ParticleAnimatorConfig {
  numParticles: number;
  particleSpeedMultiplier: number;
  trailAlpha: number;
  particleColor: string;
  minSpeed: number;
  type: "wind" | "ocean";
}

export const DEFAULT_PARTICLE_CONFIG: ParticleAnimatorConfig = {
  numParticles: 3200,
  particleSpeedMultiplier: 1.5,
  trailAlpha: 0.08,
  particleColor: "rgba(220, 240, 255, 0.8)",
  minSpeed: 0.2,
  type: "wind"
};

export class CanvasParticleAnimator {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private particles: Particle[] = [];
  private isRunning = false;
  private animFrameId: number | null = null;
  private config: ParticleAnimatorConfig = { ...DEFAULT_PARTICLE_CONFIG };

  /**
   * Inicjalizuje animator z elementem Canvas i konfiguracją.
   */
  init(canvas: HTMLCanvasElement, customConfig?: Partial<ParticleAnimatorConfig>): void {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.config = { ...DEFAULT_PARTICLE_CONFIG, ...(customConfig || {}) };

    this.initParticles();
  }

  /**
   * Inicjalizuje pulę cząstek.
   */
  private initParticles(): void {
    const graphWidth = (globalThis as any).graphWidth || 1000;
    const graphHeight = (globalThis as any).graphHeight || 1000;

    this.particles = [];
    for (let i = 0; i < this.config.numParticles; i++) {
      const p = this.createParticle(graphWidth, graphHeight);
      p.age = Math.floor(Math.random() * p.maxAge);
      this.particles.push(p);
    }
  }

  /**
   * Tworzy pojedynczą cząstkę.
   */
  private createParticle(width: number, height: number): Particle {
    const x = Math.random() * width;
    const y = Math.random() * height;
    return {
      x,
      y,
      oldX: x,
      oldY: y,
      age: 0,
      maxAge: 35 + Math.floor(Math.random() * 70), // 35–105 klatek
      speed: 0
    };
  }

  /**
   * Uruchamia pętlę renderowania 60 FPS.
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.loop();
  }

  /**
   * Zatrzymuje animację i czyści canvas.
   */
  stop(): void {
    this.isRunning = false;
    if (this.animFrameId !== null && typeof cancelAnimationFrame !== "undefined") {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (this.ctx && typeof this.ctx.clearRect === "function" && this.canvas) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  /**
   * Główna pętla klatki animacji.
   */
  private loop = (): void => {
    if (!this.isRunning) return;

    this.update();
    this.draw();

    if (typeof requestAnimationFrame !== "undefined") {
      this.animFrameId = requestAnimationFrame(this.loop);
    }
  };

  /**
   * Aktualizuje pozycje cząstek na podstawie siatki w czasie O(1).
   */
  update(): void {
    const grid = (globalThis as any).grid;
    if (!grid?.cells?.i) return;

    const graphWidth = (globalThis as any).graphWidth || 1000;
    const graphHeight = (globalThis as any).graphHeight || 1000;

    const uField: Float32Array = this.config.type === "wind" ? grid.cells.windU : grid.cells.oceanU;
    const vField: Float32Array = this.config.type === "wind" ? grid.cells.windV : grid.cells.oceanV;

    if (!uField || !vField) return;

    const points = grid.points;
    const cells = grid.cells;

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.oldX = p.x;
      p.oldY = p.y;
      p.age++;

      if (p.age > p.maxAge || p.x < 0 || p.x > graphWidth || p.y < 0 || p.y > graphHeight) {
        this.resetParticle(p, graphWidth, graphHeight);
        continue;
      }

      const cellIdx = findClosestCellFast(p.x, p.y, points);

      // Zatrzymanie cząstek oceanu przed lądem
      const onLand = this.config.type === "ocean" && cells.h[cellIdx] >= 20;
      if (onLand) {
        this.resetParticle(p, graphWidth, graphHeight);
        continue;
      }

      const u = uField[cellIdx] || 0;
      const v = vField[cellIdx] || 0;
      const speed = Math.hypot(u, v);
      p.speed = speed;

      if (speed < this.config.minSpeed) {
        this.resetParticle(p, graphWidth, graphHeight);
        continue;
      }

      p.x += (u / (speed + 0.6)) * this.config.particleSpeedMultiplier;
      p.y += (v / (speed + 0.6)) * this.config.particleSpeedMultiplier;
    }
  }

  /**
   * Rysuje cząstki na przezroczystym Canvasie.
   */
  draw(): void {
    if (!this.canvas || !this.ctx) return;

    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;

    // Przezroczyste wygaszanie smug (brak czarnego tła!)
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = `rgba(0, 0, 0, ${this.config.trailAlpha})`;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();

    // Transformacja D3 Zoom & Pan
    const viewX = (globalThis as any).viewX || 0;
    const viewY = (globalThis as any).viewY || 0;
    const scale = (globalThis as any).scale || 1;

    ctx.save();
    if (typeof ctx.setTransform === "function") {
      ctx.setTransform(scale, 0, 0, scale, viewX, viewY);
    }
    ctx.lineCap = "round";

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (p.age <= 1) continue;

      const color = getSpeedColor(p.speed);
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.min(p.speed * 0.35, 2.4);

      ctx.beginPath();
      ctx.moveTo(p.oldX, p.oldY);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Resetuje cząstkę po śmierci.
   */
  private resetParticle(p: Particle, width: number, height: number): void {
    p.x = Math.random() * width;
    p.y = Math.random() * height;
    p.oldX = p.x;
    p.oldY = p.y;
    p.age = 0;
    p.maxAge = 35 + Math.floor(Math.random() * 70);
    p.speed = 0;
  }

  /**
   * Zwraca aktualną liczbę aktywnych cząstek.
   */
  getParticleCount(): number {
    return this.particles.length;
  }
}

export const ParticleAnimator = new CanvasParticleAnimator();
