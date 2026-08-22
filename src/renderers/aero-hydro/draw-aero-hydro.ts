/**
 * Renderer warstw Aero-Hydro 2.0 dla mapy SVG i nakładki Canvas 2D.
 *
 * Odpowiada za:
 *   - Rysowanie wektorowych wstęg wiatru i centrów barycznych (High/Low) na warstwie `winds`.
 *   - Rysowanie prądów morskich na warstwie `oceanCurrents`.
 *   - Renderowanie i sterowanie dynamiczną animacją cząstek 60 FPS.
 *
 * @module renderers/aero-hydro/draw-aero-hydro
 */

import type { Layer } from "@/components/layers";
import { ParticleAnimator } from "@/renderers/aero-hydro/canvas-particle-animator";
import { StreamlineRenderer } from "@/renderers/aero-hydro/streamline-renderer";
import type { BaricCenter } from "@/types/aero-hydro";
import { findEl } from "@/utils/nodeUtils";

/**
 * Dobiera kolor wstęgi na podstawie średniej prędkości przepływu [m/s].
 * Paleta: 0-2.5 m/s (błękit) -> 2.5-7.0 m/s (szmaragd) -> 7.0-15+ m/s (złoto/cynober).
 */
export function getSpeedColor(speed: number): string {
  if (speed < 2.5) return "#0284c7"; // głęboki błękit
  if (speed < 5.0) return "#06b6d4"; // cyjan
  if (speed < 8.0) return "#10b981"; // szmaragdowa zieleń
  if (speed < 12.0) return "#f59e0b"; // ciepłe złoto
  return "#ef4444"; // cynober / czerwony
}

/**
 * Rysuje wektorowe wstęgi wiatru oraz znaczniki centrów barycznych na warstwie SVG.
 */
export function drawWinds(layer?: Layer): void {
  const g = layer ? layer.getEl() : findEl<SVGGElement>("winds");
  if (!g) return;

  g.replaceChildren();

  // 1. Wygeneruj wstęgi wiatru
  const streamlines = StreamlineRenderer.generateStreamlines("wind");
  const linesGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
  linesGroup.setAttribute("id", "windStreamlines");

  for (let i = 0; i < streamlines.length; i++) {
    const line = streamlines[i];
    const color = getSpeedColor(line.avgSpeed);
    const strokeWidth = Math.min(Math.max(line.avgSpeed * 0.35 + 1.0, 1.2), 3.5);

    const pathEl = document.createElementNS("http://www.w3.org/2000/svg", "path");
    pathEl.setAttribute("d", line.svgPath);
    pathEl.setAttribute("fill", "none");
    pathEl.setAttribute("stroke", color);
    pathEl.setAttribute("stroke-width", strokeWidth.toFixed(1));
    pathEl.setAttribute("stroke-linecap", "round");
    pathEl.setAttribute("stroke-opacity", "0.75");
    linesGroup.appendChild(pathEl);

    // Grot strzałki
    if (line.arrowHead) {
      const { x, y, angleRad } = line.arrowHead;
      const headLen = 6 + strokeWidth;
      const headAngle = Math.PI / 6;

      const x1 = x - headLen * Math.cos(angleRad - headAngle);
      const y1 = y - headLen * Math.sin(angleRad - headAngle);
      const x2 = x - headLen * Math.cos(angleRad + headAngle);
      const y2 = y - headLen * Math.sin(angleRad + headAngle);

      const arrowEl = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      arrowEl.setAttribute(
        "points",
        `${x.toFixed(1)},${y.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`
      );
      arrowEl.setAttribute("fill", color);
      arrowEl.setAttribute("opacity", "0.85");
      linesGroup.appendChild(arrowEl);
    }
  }
  g.appendChild(linesGroup);

  // 2. Rysuj znaczniki centrów barycznych
  const options = (globalThis as any).options;
  const centers: BaricCenter[] = options?.atmosphere?.baricCenters || [];
  if (centers.length > 0) {
    const centersGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    centersGroup.setAttribute("id", "baricCentersMarkers");

    for (let i = 0; i < centers.length; i++) {
      const c = centers[i];
      const isHigh = c.pressureHPa >= 1013;
      const label = isHigh ? "H" : "L";
      const color = isHigh ? "#dc2626" : "#2563eb";

      // Kółko tła
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", String(c.x));
      circle.setAttribute("cy", String(c.y));
      circle.setAttribute("r", "16");
      circle.setAttribute("fill", color);
      circle.setAttribute("fill-opacity", "0.85");
      circle.setAttribute("stroke", "#ffffff");
      circle.setAttribute("stroke-width", "2");
      circle.style.cursor = "pointer";
      centersGroup.appendChild(circle);

      // Litera H / L
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", String(c.x));
      text.setAttribute("y", String(c.y + 5));
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("font-family", "Arial, sans-serif");
      text.setAttribute("font-size", "14px");
      text.setAttribute("font-weight", "bold");
      text.setAttribute("fill", "#ffffff");
      text.setAttribute("pointer-events", "none");
      text.textContent = label;
      centersGroup.appendChild(text);

      // Podpis ciśnienia (hPa)
      const pText = document.createElementNS("http://www.w3.org/2000/svg", "text");
      pText.setAttribute("x", String(c.x));
      pText.setAttribute("y", String(c.y + 26));
      pText.setAttribute("text-anchor", "middle");
      pText.setAttribute("font-family", "Arial, sans-serif");
      pText.setAttribute("font-size", "11px");
      pText.setAttribute("font-weight", "bold");
      pText.setAttribute("fill", color);
      pText.setAttribute("stroke", "#ffffff");
      pText.setAttribute("stroke-width", "2");
      pText.setAttribute("paint-order", "stroke fill");
      pText.setAttribute("pointer-events", "none");
      pText.textContent = `${Math.round(c.pressureHPa)} hPa`;
      centersGroup.appendChild(pText);
    }
    g.appendChild(centersGroup);
  }
}

export function removeWinds(layer?: Layer): void {
  const g = layer ? layer.getEl() : findEl<SVGGElement>("winds");
  if (g) g.replaceChildren();
}

/**
 * Rysuje wstęgi cyrkulacji oceanicznej na warstwie SVG.
 */
export function drawOceanCurrents(layer?: Layer): void {
  const g = layer ? layer.getEl() : findEl<SVGGElement>("oceanCurrents");
  if (!g) return;

  g.replaceChildren();

  const streamlines = StreamlineRenderer.generateStreamlines("ocean");
  const currentsGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
  currentsGroup.setAttribute("id", "oceanCurrentStreamlines");

  for (let i = 0; i < streamlines.length; i++) {
    const line = streamlines[i];
    const color = getSpeedColor(line.avgSpeed);
    const strokeWidth = Math.min(Math.max(line.avgSpeed * 0.5 + 1.2, 1.5), 4.0);

    const pathEl = document.createElementNS("http://www.w3.org/2000/svg", "path");
    pathEl.setAttribute("d", line.svgPath);
    pathEl.setAttribute("fill", "none");
    pathEl.setAttribute("stroke", color);
    pathEl.setAttribute("stroke-width", strokeWidth.toFixed(1));
    pathEl.setAttribute("stroke-linecap", "round");
    pathEl.setAttribute("stroke-opacity", "0.8");
    currentsGroup.appendChild(pathEl);

    if (line.arrowHead) {
      const { x, y, angleRad } = line.arrowHead;
      const headLen = 7 + strokeWidth;
      const headAngle = Math.PI / 6;

      const x1 = x - headLen * Math.cos(angleRad - headAngle);
      const y1 = y - headLen * Math.sin(angleRad - headAngle);
      const x2 = x - headLen * Math.cos(angleRad + headAngle);
      const y2 = y - headLen * Math.sin(angleRad + headAngle);

      const arrowEl = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      arrowEl.setAttribute(
        "points",
        `${x.toFixed(1)},${y.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`
      );
      arrowEl.setAttribute("fill", color);
      arrowEl.setAttribute("opacity", "0.9");
      currentsGroup.appendChild(arrowEl);
    }
  }
  g.appendChild(currentsGroup);
}

export function removeOceanCurrents(layer?: Layer): void {
  const g = layer ? layer.getEl() : findEl<SVGGElement>("oceanCurrents");
  if (g) g.replaceChildren();
}

/**
 * Uruchamia animowaną nakładkę cząstek wiatru i prądów (Canvas 2D 60 FPS).
 */
export function drawFlowAnimation(): void {
  let canvas = document.getElementById("aeroHydroParticleCanvas") as HTMLCanvasElement;
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.id = "aeroHydroParticleCanvas";
    const graphWidth = (globalThis as any).graphWidth || 1000;
    const graphHeight = (globalThis as any).graphHeight || 1000;
    canvas.width = graphWidth;
    canvas.height = graphHeight;
    canvas.style.position = "absolute";
    canvas.style.top = "0";
    canvas.style.left = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.pointerEvents = "none";
    canvas.style.zIndex = "10";

    const container = document.getElementById("map") || document.body;
    container.appendChild(canvas);
  }

  canvas.style.display = "block";
  ParticleAnimator.init(canvas);
  ParticleAnimator.start();
}

/**
 * Zatrzymuje i ukrywa animowaną nakładkę cząstek.
 */
export function removeFlowAnimation(): void {
  ParticleAnimator.stop();
  const canvas = document.getElementById("aeroHydroParticleCanvas");
  if (canvas) {
    canvas.style.display = "none";
  }
}
