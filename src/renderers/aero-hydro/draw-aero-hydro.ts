/**
 * Główny moduł renderowania warstw fizycznych Aero-Hydro 2.0.
 *
 * Oferuje renderowanie:
 *   - Pola ciśnienia i izobar (`drawPressure`, `removePressure`)
 *   - Wektorowych wstęg wiatru ze spójnymi grotami (`drawWinds`, `removeWinds`)
 *   - Wstęg cyrkulacji oceanicznej (`drawOceanCurrents`, `removeOceanCurrents`)
 *   - Dynamicznej animacji cząstek 60 FPS (`drawFlowAnimation`, `removeFlowAnimation`)
 *
 * @module renderers/aero-hydro/draw-aero-hydro
 */

import { ParticleAnimator } from "@/renderers/aero-hydro/canvas-particle-animator";
import { drawPressure, removePressure } from "@/renderers/aero-hydro/draw-pressure";
import { StreamlineRenderer } from "@/renderers/aero-hydro/streamline-renderer";

export { drawPressure, removePressure };

export function getSpeedColor(speed: number): string {
  if (speed < 2.5) return "#0284c7"; // błękit
  if (speed < 5.0) return "#06b6d4"; // cyjan
  if (speed < 8.0) return "#10b981"; // szmaragd
  if (speed < 12.0) return "#f59e0b"; // złoto
  return "#ef4444"; // cynober
}

function ensureDefs(): SVGDefsElement | null {
  const svg = document.getElementById("viewbox") || document.querySelector("svg");
  if (!svg) return null;
  let defs = svg.querySelector("defs");
  if (!defs) {
    defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    svg.insertBefore(defs, svg.firstChild);
  }
  return defs;
}

function ensureMarkers(): void {
  const defs = ensureDefs();
  if (!defs || defs.querySelector("#aero-wind-arrow")) return;

  const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
  marker.setAttribute("id", "aero-wind-arrow");
  marker.setAttribute("viewBox", "0 0 10 10");
  marker.setAttribute("refX", "6");
  marker.setAttribute("refY", "5");
  marker.setAttribute("markerWidth", "6");
  marker.setAttribute("markerHeight", "6");
  marker.setAttribute("orient", "auto-start-reverse");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M 0 1.5 L 8 5 L 0 8.5 z");
  path.setAttribute("fill", "context-stroke");
  marker.appendChild(path);

  defs.appendChild(marker);
}

function getOrCreateGroup(id: string): SVGGElement | null {
  let g = document.getElementById(id) as SVGGElement | null;
  if (!g) {
    const parent = document.getElementById("viewbox") || document.getElementById("map");
    if (parent) {
      g = document.createElementNS("http://www.w3.org/2000/svg", "g") as SVGGElement;
      g.id = id;
      parent.appendChild(g);
    }
  }
  return g;
}

/**
 * Rysuje wektorowe wstęgi wiatru 2D.
 */
export function drawWinds(): void {
  ensureMarkers();
  const g = getOrCreateGroup("winds");
  if (!g) return;

  g.replaceChildren();

  const streamlines = StreamlineRenderer.generateStreamlines("wind");
  const linesGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
  linesGroup.setAttribute("id", "windStreamlines");

  for (let i = 0; i < streamlines.length; i++) {
    const line = streamlines[i];
    const color = getSpeedColor(line.avgSpeed);
    const strokeWidth = Math.min(Math.max(line.avgSpeed * 0.35 + 1.2, 1.4), 3.8);

    const pathEl = document.createElementNS("http://www.w3.org/2000/svg", "path");
    pathEl.setAttribute("d", line.svgPath);
    pathEl.setAttribute("fill", "none");
    pathEl.setAttribute("stroke", color);
    pathEl.setAttribute("stroke-width", strokeWidth.toFixed(1));
    pathEl.setAttribute("stroke-linecap", "round");
    pathEl.setAttribute("stroke-opacity", "0.85");
    pathEl.setAttribute("marker-end", "url(#aero-wind-arrow)");
    linesGroup.appendChild(pathEl);
  }

  g.appendChild(linesGroup);
}

export function removeWinds(): void {
  const g = document.getElementById("winds");
  if (g) g.replaceChildren();
}

/**
 * Rysuje wstęgi cyrkulacji oceanicznej.
 */
export function drawOceanCurrents(): void {
  ensureMarkers();
  const g = getOrCreateGroup("oceanCurrents");
  if (!g) return;

  g.replaceChildren();

  const streamlines = StreamlineRenderer.generateStreamlines("ocean");
  const currentsGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
  currentsGroup.setAttribute("id", "oceanCurrentStreamlines");

  for (let i = 0; i < streamlines.length; i++) {
    const line = streamlines[i];
    const color = getSpeedColor(line.avgSpeed);
    const strokeWidth = Math.min(Math.max(line.avgSpeed * 0.5 + 1.4, 1.8), 4.2);

    const pathEl = document.createElementNS("http://www.w3.org/2000/svg", "path");
    pathEl.setAttribute("d", line.svgPath);
    pathEl.setAttribute("fill", "none");
    pathEl.setAttribute("stroke", color);
    pathEl.setAttribute("stroke-width", strokeWidth.toFixed(1));
    pathEl.setAttribute("stroke-linecap", "round");
    pathEl.setAttribute("stroke-opacity", "0.9");
    pathEl.setAttribute("marker-end", "url(#aero-wind-arrow)");
    currentsGroup.appendChild(pathEl);
  }

  g.appendChild(currentsGroup);
}

export function removeOceanCurrents(): void {
  const g = document.getElementById("oceanCurrents");
  if (g) g.replaceChildren();
}

/**
 * Uruchamia animację cząstek Canvas 2D 60 FPS.
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

export function removeFlowAnimation(): void {
  ParticleAnimator.stop();
  const canvas = document.getElementById("aeroHydroParticleCanvas");
  if (canvas) {
    canvas.style.display = "none";
  }
}
