// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

describe("draw-aero-hydro", () => {
  let drawAeroHydro: any;

  beforeEach(async () => {
    (globalThis as any).TIME = false;
    (globalThis as any).graphWidth = 1000;
    (globalThis as any).graphHeight = 1000;

    const n = 100;
    const points: [number, number][] = [];
    const neighbors: number[][] = [];
    const heights = new Uint8Array(n).fill(10);
    const pressureHPa = new Float32Array(n).fill(1013);

    for (let i = 0; i < n; i++) {
      points.push([(i % 10) * 100 + 50, Math.floor(i / 10) * 100 + 50]);
      neighbors.push([]);
    }

    (globalThis as any).grid = {
      cellsX: 10,
      cellsY: 10,
      points: points,
      vertices: {
        p: points,
        c: Array.from({ length: n }, () => [0, 1, 2]),
        v: Array.from({ length: n }, () => [0, 1, 2])
      },
      cells: {
        i: Array.from({ length: n }, (_, i) => i),
        h: heights,
        b: new Uint8Array(n).fill(0),
        v: Array.from({ length: n }, () => [0, 1, 2]),
        windU: new Float32Array(n).fill(5.0),
        windV: new Float32Array(n).fill(0),
        oceanU: new Float32Array(n).fill(2.0),
        oceanV: new Float32Array(n).fill(0),
        pressureHPa: pressureHPa,
        c: neighbors
      }
    };

    (globalThis as any).options = {
      atmosphere: {
        baricCenters: [
          {
            x: 300,
            y: 300,
            type: "high",
            pressureHPa: 1032,
            radiusKm: 2500,
            thermalOrigin: false
          }
        ]
      }
    };

    document.body.innerHTML = `
      <svg id="viewbox">
        <g id="pressure"></g>
        <g id="winds"></g>
        <g id="oceanCurrents"></g>
      </svg>
      <div id="map"></div>
    `;

    drawAeroHydro = await import("./draw-aero-hydro");
  });

  it("getSpeedColor() poprawnie mapuje prędkość na paletę barw", () => {
    expect(drawAeroHydro.getSpeedColor(1.0)).toBe("#0284c7");
    expect(drawAeroHydro.getSpeedColor(3.5)).toBe("#06b6d4");
    expect(drawAeroHydro.getSpeedColor(6.0)).toBe("#10b981");
    expect(drawAeroHydro.getSpeedColor(10.0)).toBe("#f59e0b");
    expect(drawAeroHydro.getSpeedColor(15.0)).toBe("#ef4444");
  });

  it("drawPressure() i removePressure() renderują i usuwają izobary oraz centra baryczne", () => {
    drawAeroHydro.drawPressure();

    const pressureG = document.getElementById("pressure");
    expect(pressureG?.querySelector("#pressureCentersMarkers")).not.toBeNull();

    drawAeroHydro.removePressure();
    expect(pressureG?.children.length).toBe(0);
  });

  it("drawWinds() i removeWinds() renderują i usuwają elementy SVG wstęg wiatru", () => {
    drawAeroHydro.drawWinds();

    const windsG = document.getElementById("winds");
    expect(windsG?.querySelector("#windStreamlines")).not.toBeNull();

    drawAeroHydro.removeWinds();
    expect(windsG?.children.length).toBe(0);
  });

  it("drawOceanCurrents() i removeOceanCurrents() renderują i usuwają wstęgi prądów oceanicznych", () => {
    drawAeroHydro.drawOceanCurrents();

    const oceanG = document.getElementById("oceanCurrents");
    expect(oceanG?.querySelector("#oceanCurrentStreamlines")).not.toBeNull();

    drawAeroHydro.removeOceanCurrents();
    expect(oceanG?.children.length).toBe(0);
  });

  it("drawFlowAnimation() i removeFlowAnimation() zarządzają płótnem Canvas 2D", () => {
    drawAeroHydro.drawFlowAnimation();
    const canvas = document.getElementById("aeroHydroParticleCanvas") as HTMLCanvasElement;
    expect(canvas).not.toBeNull();
    expect(canvas.style.display).toBe("block");

    drawAeroHydro.removeFlowAnimation();
    expect(canvas.style.display).toBe("none");
  });
});
