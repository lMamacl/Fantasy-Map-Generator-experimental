/**
 * Główny moduł renderowania warstw fizycznych Aero-Hydro 2.0.
 *
 * Oferuje renderowanie:
 *   - Pola ciśnienia i izobar (`drawPressure`, `removePressure`)
 *   - Wektorowych wstęg wiatru z poświatą (`drawWinds`, `removeWinds`)
 *   - Podwójnych wstęg cyrkulacji oceanicznej (`drawOceanCurrents`, `removeOceanCurrents`)
 *   - Dynamicznej animacji cząstek 60 FPS (`drawFlowAnimation`, `removeFlowAnimation`)
 *
 * @module renderers/aero-hydro/draw-aero-hydro
 */

import { ParticleAnimator } from "@/renderers/aero-hydro/canvas-particle-animator";
import { drawPressure, removePressure } from "@/renderers/aero-hydro/draw-pressure";
import { StreamlineRenderer } from "@/renderers/aero-hydro/streamline-renderer";

export { drawPressure, removePressure };

export function getSpeedColor(speed: number): string {
  if (speed < 3.5) return "#0284c7"; // błękit
  if (speed < 7.5) return "#06b6d4"; // cyjan
  if (speed < 12.0) return "#10b981"; // szmaragd
  if (speed < 18.0) return "#facc15"; // złoto
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

function ensureFilters(): void {
  const defs = ensureDefs();
  if (!defs || defs.querySelector("#aero-glow-filter")) return;

  const filter = document.createElementNS("http://www.w3.org/2000/svg", "filter");
  filter.setAttribute("id", "aero-glow-filter");
  filter.setAttribute("x", "-20%");
  filter.setAttribute("y", "-20%");
  filter.setAttribute("width", "140%");
  filter.setAttribute("height", "140%");

  const blur = document.createElementNS("http://www.w3.org/2000/svg", "feGaussianBlur");
  blur.setAttribute("stdDeviation", "2.2");
  blur.setAttribute("result", "blur");
  filter.appendChild(blur);

  const comp = document.createElementNS("http://www.w3.org/2000/svg", "feComposite");
  comp.setAttribute("in", "SourceGraphic");
  comp.setAttribute("in2", "blur");
  comp.setAttribute("operator", "over");
  filter.appendChild(comp);

  defs.appendChild(filter);
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
 * Rysuje wektorowe wstęgi wiatru 2D z poświatą.
 */
export function drawWinds(): void {
  ensureFilters();
  const g = getOrCreateGroup("winds");
  if (!g) return;

  g.replaceChildren();

  const streamlines = StreamlineRenderer.generateStreamlines("wind");
  const linesGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
  linesGroup.setAttribute("id", "windStreamlines");

  for (let i = 0; i < streamlines.length; i++) {
    const line = streamlines[i];
    const color = getSpeedColor(line.avgSpeed);

    const pathEl = document.createElementNS("http://www.w3.org/2000/svg", "path");
    pathEl.setAttribute("d", line.svgPath);
    pathEl.setAttribute("fill", "none");
    pathEl.setAttribute("stroke", color);
    pathEl.setAttribute("stroke-width", "2.4");
    pathEl.setAttribute("stroke-linecap", "round");
    pathEl.setAttribute("opacity", "0.78");
    pathEl.setAttribute("filter", "url(#aero-glow-filter)");
    linesGroup.appendChild(pathEl);
  }

  g.appendChild(linesGroup);
}

export function removeWinds(): void {
  const g = document.getElementById("winds");
  if (g) g.replaceChildren();
}

/**
 * Rysuje podwójne wstęgi cyrkulacji oceanicznej (złoty rdzeń + błękitna poświata).
 */
export function drawOceanCurrents(): void {
  const g = getOrCreateGroup("oceanCurrents");
  if (!g) return;

  g.replaceChildren();

  const streamlines = StreamlineRenderer.generateStreamlines("ocean");
  const currentsGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
  currentsGroup.setAttribute("id", "oceanCurrentStreamlines");

  for (let i = 0; i < streamlines.length; i++) {
    const line = streamlines[i];

    // Szeroka zewnętrzna poświata
    const haloEl = document.createElementNS("http://www.w3.org/2000/svg", "path");
    haloEl.setAttribute("d", line.svgPath);
    haloEl.setAttribute("fill", "none");
    haloEl.setAttribute("stroke", "#0284c7");
    haloEl.setAttribute("stroke-width", "7.5");
    haloEl.setAttribute("stroke-linecap", "round");
    haloEl.setAttribute("opacity", "0.4");
    currentsGroup.appendChild(haloEl);

    // Wyrazisty rdzeń
    const coreEl = document.createElementNS("http://www.w3.org/2000/svg", "path");
    coreEl.setAttribute("d", line.svgPath);
    coreEl.setAttribute("fill", "none");
    coreEl.setAttribute("stroke", "#facc15");
    coreEl.setAttribute("stroke-width", "3.4");
    coreEl.setAttribute("stroke-linecap", "round");
    coreEl.setAttribute("opacity", "0.9");
    currentsGroup.appendChild(coreEl);
  }

  g.appendChild(currentsGroup);
}

export function removeOceanCurrents(): void {
  const g = document.getElementById("oceanCurrents");
  if (g) g.replaceChildren();
}

/**
 * Uruchamia animację cząstek Canvas 2D 60 FPS nałożoną na widok mapy.
 */
export function drawFlowAnimation(): void {
  let canvas = document.getElementById("aeroHydroParticleCanvas") as HTMLCanvasElement;
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.id = "aeroHydroParticleCanvas";
    canvas.style.position = "fixed";
    canvas.style.top = "0";
    canvas.style.left = "0";
    canvas.style.width = "100vw";
    canvas.style.height = "100vh";
    canvas.style.pointerEvents = "none";

    const optionsContainer = document.getElementById("optionsContainer");
    if (optionsContainer && optionsContainer.parentNode) {
      optionsContainer.parentNode.insertBefore(canvas, optionsContainer);
    } else {
      document.body.appendChild(canvas);
    }
  }

  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
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
