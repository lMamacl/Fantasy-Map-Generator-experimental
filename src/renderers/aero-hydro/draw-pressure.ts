/**
 * Renderer warstwy pola ciśnienia atmosferycznego (izobary, gradienty i centra baryczne).
 *
 * @module renderers/aero-hydro/draw-pressure
 */

import {
  color,
  curveBasisClosed,
  interpolateSpectral,
  leastIndex,
  line,
  max,
  min,
  range,
  scaleSequential,
  select
} from "d3";
import type { BaricCenter } from "@/types/aero-hydro";
import { connectVertices, round } from "@/utils";

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

export function drawPressure(): void {
  const group = getOrCreateGroup("pressure");
  if (!group) return;

  const g = select(group);
  g.selectAll("*").remove();

  const grid = (globalThis as any).grid;
  if (!grid?.cells?.i) return;

  const { cells, vertices } = grid;
  const n = cells.i.length;

  const graphWidth = (globalThis as any).graphWidth || 1000;
  const graphHeight = (globalThis as any).graphHeight || 1000;

  // Pole ciśnienia w hPa
  let pressureField: Float32Array = cells.pressureHPa;
  if (!pressureField || pressureField.length !== n) {
    pressureField = new Float32Array(n);
    for (let i = 0; i < n; i++) pressureField[i] = 1013;
  }

  const pMin = Math.floor(Number(min(pressureField)) || 980);
  const pMax = Math.ceil(Number(max(pressureField)) || 1035);
  const step = Math.max(Math.round((pMax - pMin) / 8), 4);

  const isolines = range(pMin + step, pMax, step);
  const checkedCells = new Uint8Array(n);
  const addToChecked = (cellId: number) => {
    checkedCells[cellId] = 1;
  };

  const lineGen = line<[number, number]>().curve(curveBasisClosed);
  // Spektrum: niże (niebieski/fiolet) -> wyże (czerwony/pomarańcz)
  const scheme = scaleSequential(interpolateSpectral);

  const chains: [number, [number, number][]][] = [];
  const labels: [number, number, number][] = [];

  for (const cellId of cells.i) {
    const p = pressureField[cellId];
    if (checkedCells[cellId] || !isolines.some(iso => Math.abs(iso - p) < step * 0.5)) continue;

    const targetIso = isolines.reduce((prev, curr) => (Math.abs(curr - p) < Math.abs(prev - p) ? curr : prev));
    const startingVertex = findStart(cellId, targetIso);
    if (!startingVertex) continue;
    checkedCells[cellId] = 1;

    const ofSameType = (id: number) => pressureField[id] >= targetIso;
    const chain = connectVertices({
      vertices,
      startingVertex,
      ofSameType,
      addToChecked
    });

    const relaxed = chain.filter((v: number, i: number) => i % 4 === 0 || vertices.c[v].some((c: number) => c >= n));
    if (relaxed.length < 6) continue;

    const points: [number, number][] = relaxed.map((v: number) => vertices.p[v]);
    chains.push([targetIso, points]);
    addLabel(points, targetIso);
  }

  // Tło bazowe
  g.append("path")
    .attr("d", `M0,0 h${graphWidth} v${graphHeight} h${-graphWidth} Z`)
    .attr("fill", scheme(1 - (pMin - 960) / 90))
    .attr("opacity", 0.45)
    .attr("stroke", "none");

  // Wypełnienia izobar
  for (const iso of isolines) {
    const path = chains
      .filter(c => c[0] === iso)
      .map(c => round(lineGen(c[1]) || ""))
      .join("");
    if (!path) continue;

    const fill = scheme(1 - (iso - 960) / 90);
    const strokeColor = color(fill)!.darker(0.3).toString();

    g.append("path")
      .attr("d", path)
      .attr("fill", fill)
      .attr("fill-opacity", 0.45)
      .attr("stroke", strokeColor)
      .attr("stroke-width", 1.2)
      .attr("stroke-dasharray", iso === 1013 ? "none" : "3 3");
  }

  // Etykiety izobar (np. 1020 hPa)
  const labelsGroup = g.append("g").attr("id", "pressureLabels").attr("fill-opacity", 0.9);
  labelsGroup
    .selectAll("text")
    .data(labels)
    .enter()
    .append("text")
    .attr("x", d => d[0])
    .attr("y", d => d[1])
    .attr("text-anchor", "middle")
    .attr("font-family", "Arial, sans-serif")
    .attr("font-size", "11px")
    .attr("font-weight", "bold")
    .attr("fill", "#334155")
    .attr("stroke", "#ffffff")
    .attr("stroke-width", 2)
    .attr("paint-order", "stroke fill")
    .text(d => `${Math.round(d[2])} hPa`);

  // Znaczniki wyżów (H) i niżów (L)
  const options = (globalThis as any).options;
  const centers: BaricCenter[] = options?.atmosphere?.baricCenters || [];
  if (centers.length > 0) {
    const centersGroup = g.append("g").attr("id", "pressureCentersMarkers");

    for (let i = 0; i < centers.length; i++) {
      const c = centers[i];
      const isHigh = c.pressureHPa >= 1013;
      const label = isHigh ? "H" : "L";
      const badgeColor = isHigh ? "#dc2626" : "#2563eb";

      // Kółko
      centersGroup
        .append("circle")
        .attr("cx", c.x)
        .attr("cy", c.y)
        .attr("r", 15)
        .attr("fill", badgeColor)
        .attr("fill-opacity", 0.9)
        .attr("stroke", "#ffffff")
        .attr("stroke-width", 2);

      // Litera
      centersGroup
        .append("text")
        .attr("x", c.x)
        .attr("y", c.y + 5)
        .attr("text-anchor", "middle")
        .attr("font-family", "Arial, sans-serif")
        .attr("font-size", "15px")
        .attr("font-weight", "bold")
        .attr("fill", "#ffffff")
        .text(label);

      // Wartość ciśnienia pod literą
      centersGroup
        .append("text")
        .attr("x", c.x)
        .attr("y", c.y + 26)
        .attr("text-anchor", "middle")
        .attr("font-family", "Arial, sans-serif")
        .attr("font-size", "12px")
        .attr("font-weight", "bold")
        .attr("fill", badgeColor)
        .attr("stroke", "#ffffff")
        .attr("stroke-width", 2.5)
        .attr("paint-order", "stroke fill")
        .text(`${Math.round(c.pressureHPa)} hPa`);
    }
  }

  function findStart(i: number, iso: number): number | undefined {
    if (cells.b[i]) return cells.v[i].find((v: number) => vertices.c[v].some((c: number) => c >= n));
    return cells.v[i][cells.c[i].findIndex((c: number) => pressureField[c] < iso || !pressureField[c])];
  }

  function addLabel(points: [number, number][], iso: number): void {
    const xCenter = graphWidth / 2;
    const tcIndex = leastIndex(
      points,
      (a: [number, number], b: [number, number]) =>
        a[1] - b[1] + (Math.abs(a[0] - xCenter) - Math.abs(b[0] - xCenter)) / 2
    );
    if (tcIndex !== undefined && points[tcIndex]) {
      const tc = points[tcIndex];
      labels.push([tc[0], tc[1], iso]);
    }
  }
}

export function removePressure(): void {
  select("#pressure").selectAll("*").remove();
}
