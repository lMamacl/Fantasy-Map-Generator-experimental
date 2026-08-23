/**
 * Renderer warstwy pola ciśnienia atmosferycznego (kolorowa nakładka granat → zieleń → złoto oraz interaktywne żetony H/L).
 *
 * @module renderers/aero-hydro/draw-pressure
 */

import { drag, select } from "d3";
import { AtmosphereEngine } from "@/generators/aero-hydro/atmosphere-engine";
import type { BaricCenter } from "@/types/aero-hydro";

export function getPressureColor(p: number): string {
  // Paleta: Niż (ciemny granat) → Normalne (zieleń/szmaragd) → Wyż (złoto/bursztyn)
  if (p < 990) return "#0b1a30"; // ciemny granat
  if (p < 998) return "#1e3a8a"; // głęboki szafir
  if (p < 1006) return "#0284c7"; // błękit
  if (p < 1013) return "#06b6d4"; // cyjan
  if (p < 1018) return "#059669"; // szmaragd
  if (p < 1024) return "#10b981"; // soczysta zieleń
  if (p < 1028) return "#eab308"; // złoto
  if (p < 1034) return "#f59e0b"; // bursztyn
  return "#ea580c"; // ciepły cynober
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

export function drawPressure(): void {
  const group = getOrCreateGroup("pressure");
  if (!group) return;

  const g = select(group);
  g.selectAll("*").remove();

  const grid = (globalThis as any).grid;
  if (!grid?.cells?.i) return;

  const { cells, vertices, points } = grid;
  const n = cells.i.length;

  // Pobierz pole ciśnienia
  let pressureField: Float32Array = cells.pressure || cells.pressureHPa;
  if (!pressureField || pressureField.length !== n) {
    AtmosphereEngine.generate();
    pressureField = cells.pressure || cells.pressureHPa;
  }
  if (!pressureField) return;

  // 1. Kolorowa nakładka komórek Voronoi (błyskawiczny render O(N) bez zamrażania UI)
  const cellsGroup = g.append("g").attr("id", "pressureHeatmap").attr("opacity", 0.45);

  for (let i = 0; i < n; i++) {
    const p = pressureField[i];
    const vList = cells.v[i];
    if (!vList || vList.length < 3) continue;

    const firstPt = vertices?.p?.[vList[0]];
    if (!firstPt) continue;

    let d = `M ${firstPt[0].toFixed(1)} ${firstPt[1].toFixed(1)}`;
    for (let j = 1; j < vList.length; j++) {
      const pt = vertices.p[vList[j]];
      if (pt) d += ` L ${pt[0].toFixed(1)} ${pt[1].toFixed(1)}`;
    }
    d += " Z";

    const fill = getPressureColor(p);
    cellsGroup.append("path").attr("d", d).attr("fill", fill).attr("stroke", "none");
  }

  // 2. Delikatne znaczniki izobar (punkty co 4 hPa)
  const isobarsGroup = g.append("g").attr("id", "isobarsDots");
  for (let i = 0; i < n; i++) {
    const p = Math.round(pressureField[i]);
    if (p % 4 === 0) {
      const [px, py] = points[i];
      isobarsGroup
        .append("circle")
        .attr("cx", px.toFixed(1))
        .attr("cy", py.toFixed(1))
        .attr("r", 1.8)
        .attr("fill", "rgba(255, 255, 255, 0.45)");
    }
  }

  // 3. Interaktywne Żetony Centrów Barycznych (H/L) z obsługą przeciągania myszką (Drag & Drop)
  const options = (globalThis as any).options;
  const centers: BaricCenter[] = options?.atmosphere?.baricCenters || [];
  if (centers.length > 0) {
    const centersGroup = g.append("g").attr("id", "pressureCentersMarkers");

    const dragBehavior = drag<SVGGElement, BaricCenter>()
      .on("start", function () {
        select(this).raise().style("cursor", "grabbing");
      })
      .on("drag", function (event, d) {
        d.x = event.x;
        d.y = event.y;
        select(this).attr("transform", `translate(${d.x}, ${d.y})`);

        // Dynamiczne przeliczenie fizyki i odświeżenie mapy na żywo
        AtmosphereEngine.generate();
        updatePressureColorsOnly();
        import("./draw-aero-hydro").then(m => m.drawWinds());
      })
      .on("end", function () {
        select(this).style("cursor", "grab");
        drawPressure();
      });

    for (let i = 0; i < centers.length; i++) {
      const c = centers[i];
      const isHigh = c.type === "high" || c.pressureHPa >= 1013;
      const label = isHigh ? "H" : "L";
      const badgeColor = isHigh ? "#3b82f6" : "#ef4444";

      const tokenG = centersGroup
        .append("g")
        .datum(c)
        .attr("class", "baric-center-token")
        .attr("transform", `translate(${c.x}, ${c.y})`)
        .style("cursor", "grab")
        .call(dragBehavior as any);

      // Pulsujący pierścień zewnętrzny
      tokenG
        .append("circle")
        .attr("r", 22)
        .attr("fill", "none")
        .attr("stroke", badgeColor)
        .attr("stroke-width", 1.5)
        .attr("stroke-dasharray", "4 3")
        .attr("opacity", 0.75);

      // Główny dysk żetonu
      tokenG
        .append("circle")
        .attr("r", 17)
        .attr("fill", badgeColor)
        .attr("stroke", "#ffffff")
        .attr("stroke-width", 2.2);

      // Litera H / L
      tokenG
        .append("text")
        .attr("y", 6)
        .attr("text-anchor", "middle")
        .attr("font-family", "Outfit, Arial, sans-serif")
        .attr("font-size", "17px")
        .attr("font-weight", "bold")
        .attr("fill", "#ffffff")
        .attr("pointer-events", "none")
        .text(label);

      // Etykieta z wartością ciśnienia pod żetonem
      tokenG
        .append("text")
        .attr("y", 34)
        .attr("text-anchor", "middle")
        .attr("font-family", "JetBrains Mono, monospace")
        .attr("font-size", "11px")
        .attr("font-weight", "bold")
        .attr("fill", "#f8fafc")
        .attr("stroke", "#0f172a")
        .attr("stroke-width", 3)
        .attr("paint-order", "stroke fill")
        .attr("pointer-events", "none")
        .text(`${Math.round(c.pressureHPa)} hPa`);
    }
  }

  function updatePressureColorsOnly(): void {
    const paths = cellsGroup.selectAll("path").nodes() as SVGPathElement[];
    const curPressure: Float32Array = cells.pressure || cells.pressureHPa;
    for (let i = 0; i < paths.length && i < curPressure.length; i++) {
      paths[i].setAttribute("fill", getPressureColor(curPressure[i]));
    }
  }
}

export function removePressure(): void {
  select("#pressure").selectAll("*").remove();
}
