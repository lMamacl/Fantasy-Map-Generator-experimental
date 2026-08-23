/**
 * Silnik animacji cząstek Canvas 2D (Aero-Hydro 2.0).
 *
 * Zapewnia ultra-płynne renderowanie 60 FPS dla:
 *   - Cząstek wiatru (Wind Stream Particles)
 *   - Cząstek prądów morskich (Ocean Current Particles)
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
  numParticles: 2500,
  particleSpeedMultiplier: 3.8,
  trailAlpha: 0.12,
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
   * Inicjalizuje pulę cząstek o losowych pozycjach i czasach życia.
   */
  private initParticles(): void {
    const width = this.canvas?.width || 1000;
    const height = this.canvas?.height || 1000;

    this.particles = [];
    for (let i = 0; i < this.config.numParticles; i++) {
      const p = this.createParticle(width, height);
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
   * Zatrzymuje animację.
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
   * Aktualizuje pozycje cząstek na podstawie wektorów siatki.
   */
  update(): void {
    const grid = (globalThis as any).grid;
    if (!grid?.cells?.i || !this.canvas) return;

    const width = this.canvas.width || 1000;
    const height = this.canvas.height || 1000;

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

      // Znajdź najbliższą komórkę siatki w czasie O(1)
      const cellIdx = this.findClosestCell(p.x, p.y, points);

      // Jeśli cząstka oceanu trafi na ląd lub skończy się czas życia
      const onLand = this.config.type === "ocean" && cells.h[cellIdx] >= 20;
      if (p.age >= p.maxAge || onLand) {
        this.resetParticle(p, width, height);
        continue;
      }

      const u = uField[cellIdx] || 0;
      const v = vField[cellIdx] || 0;
      const speed = Math.hypot(u, v);
      p.speed = speed;

      if (speed < this.config.minSpeed) {
        this.resetParticle(p, width, height);
        continue;
      }

      // Płynne znormalizowane przemieszczenie z prędkością
      p.x += (u / (speed + 0.6)) * this.config.particleSpeedMultiplier;
      p.y += (v / (speed + 0.6)) * this.config.particleSpeedMultiplier;

      // Granice canvasu
      if (p.x < 0 || p.x > width || p.y < 0 || p.y > height) {
        this.resetParticle(p, width, height);
      }
    }
  }

  /**
   * Rysuje cząstki i smugi na Canvasie.
   */
  draw(): void {
    if (!this.ctx || !this.canvas) return;

    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;

    // Półprzezroczysty trail fade dla aksamitnego ogona wiatru
    ctx.save();
    ctx.fillStyle = `rgba(4, 7, 17, ${this.config.trailAlpha})`;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();

    ctx.save();
    ctx.lineCap = "round";

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (p.age <= 1) continue;

      const color = getSpeedColor(p.speed);
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.min(p.speed * 0.35 + 0.8, 2.4);

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
   * Znajduje najbliższą komórkę siatki w czasie O(1).
   */
  private findClosestCell(x: number, y: number, points: [number, number][]): number {
    return findClosestCellFast(x, y, points);
  }

  /**
   * Zwraca aktualną liczbę aktywnych cząstek.
   */
  getParticleCount(): number {
    return this.particles.length;
  }
}

export const ParticleAnimator = new CanvasParticleAnimator();
