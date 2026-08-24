/**
 * Kontroler edytora klimatu, wiatrów i hydrologii Aero-Hydro 2.0.
 *
 * Umożliwia:
 *   - Edycję parametrów ośrodków barycznych (wyże, niże, położenie, ciśnienie, promień)
 *     z automatyczną klasyfikacją typu na podstawie wartości ciśnienia.
 *   - Automatyczną generację spójnego układu centrów barycznych (⚡ Auto-Generate Centers).
 *   - Przełączanie widoczności żetonów na mapie oraz regulację prędkości animacji.
 *   - Konfigurację parametrów fizycznych atmosfery, cyrkulacji oceanicznej i wilgoci.
 *
 * @module controllers/aero-hydro-editor
 */

import { AeroHydro } from "@/generators/aero-hydro";
import { AtmosphereEngine } from "@/generators/aero-hydro/atmosphere-engine";
import { ParticleAnimator } from "@/renderers/aero-hydro/canvas-particle-animator";
import {
  drawFlowAnimation,
  drawOceanCurrents,
  drawWinds,
  removeFlowAnimation,
  removeOceanCurrents,
  removeWinds
} from "@/renderers/aero-hydro/draw-aero-hydro";
import { drawPressure, removePressure } from "@/renderers/aero-hydro/draw-pressure";
import type { BaricCenter } from "@/types/aero-hydro";
import { ensureEl } from "../utils";

let isWindsActive = true;
let isPressureActive = false;
let isOceanActive = false;
let isParticlesActive = false;

function showTip(text: string): void {
  const g = globalThis as any;
  if (typeof g.tip === "function") g.tip(text);
}

function closeDialog(id: string): void {
  removeWinds();
  removePressure();
  removeOceanCurrents();
  removeFlowAnimation();
  isWindsActive = false;
  isPressureActive = false;
  isOceanActive = false;
  isParticlesActive = false;

  const g = globalThis as any;
  if (typeof g.$ === "function") {
    const el = g.$(`#${id}`);
    if (el.length && el.dialog) el.dialog("destroy");
  }
  const domEl = document.getElementById(id);
  if (domEl) domEl.remove();
}

function open(): void {
  isWindsActive = true;
  isPressureActive = false;
  isOceanActive = false;
  isParticlesActive = false;

  renderDialog();
  updateInputValues();

  drawWinds();

  const g = globalThis as any;
  if (typeof g.$ === "function") {
    g.$("#aeroHydroEditor").dialog({
      title: "Aero-Hydro Climate & Hydrology Editor",
      resizable: false,
      width: "minmax(48em, 90vw)",
      buttons: {
        "Recalculate Climate": () => {
          applyChanges();
          AeroHydro.generate();
          if (isWindsActive) drawWinds();
          if (isPressureActive) drawPressure();
          if (isOceanActive) drawOceanCurrents();
        },
        Close: () => closeDialog("aeroHydroEditor")
      },
      open: function (this: HTMLElement) {
        const button = this.parentElement?.querySelector(".ui-dialog-buttonset > button");
        button?.addEventListener("mousemove", () =>
          showTip("Recalculate complete atmospheric, oceanic and hydrologic simulation")
        );
      },
      close: () => closeDialog("aeroHydroEditor")
    });
  }
}

function renderDialog(): void {
  closeDialog("aeroHydroEditor");
  ensureEl("dialogs").insertAdjacentHTML("beforeend", createDialogHtml());
  addListeners();
}

function createDialogHtml(): string {
  const windsPressed = isWindsActive ? "pressed" : "";
  const pressurePressed = isPressureActive ? "pressed" : "";
  const oceanPressed = isOceanActive ? "pressed" : "";
  const particlesPressed = isParticlesActive ? "pressed" : "";

  const options = (globalThis as any).options || {};
  const showTokens = options.atmosphere?.showTokens !== false;

  return /* html */ `<div id="aeroHydroEditor" class="dialog stable">
    <div style="display: flex; gap: 1.5em; flex-wrap: wrap;">
      
      <!-- Kolumna 1: Ciśnienie i Centra baryczne -->
      <div style="flex: 1.3; min-width: 24em;">
        <fieldset>
          <legend><b>🌀 Atmospheric Pressure & Baric Centers</b></legend>
          <div id="baricCentersList" style="max-height: 15em; overflow-y: auto; margin-bottom: 0.6em;"></div>
          
          <div style="display: flex; gap: 0.6em; align-items: center; flex-wrap: wrap; margin-bottom: 0.6em;">
            <button id="addBaricCenterBtn" class="btn btn-sm" data-tip="Add a new atmospheric pressure center (auto High/Low based on p)">+ Add Baric Center</button>
            <button id="autoBaricCentersBtn" class="btn btn-sm" data-tip="Auto-generate 3-4 realistic High/Low centers based on latitude and landmass">⚡ Auto-Generate</button>
            <label style="display: flex; align-items: center; gap: 0.3em; cursor: pointer; font-size: 0.88em;" data-tip="Show or hide interactive draggable H/L tokens on map">
              <input type="checkbox" id="showTokensCheckbox" ${showTokens ? "checked" : ""} />
              <span>Show Tokens on Map</span>
            </label>
          </div>
        </fieldset>

        <fieldset style="margin-top: 1em;">
          <legend><b>👁️ Map Layers & Animation</b></legend>
          <div style="display: flex; flex-direction: column; gap: 0.6em;">
            <div style="display: flex; gap: 0.4em; flex-wrap: wrap;">
              <button id="toggleWindsLayerBtn" class="btn btn-sm ${windsPressed}" data-tip="Toggle 2D Wind Streamlines (SVG)">Wind & Pressure (SVG)</button>
              <button id="togglePressureLayerBtn" class="btn btn-sm ${pressurePressed}" data-tip="Toggle Pressure Heatmap (Granat → Zieleń → Złoto)">Pressure Heatmap</button>
              <button id="toggleOceanLayerBtn" class="btn btn-sm ${oceanPressed}" data-tip="Toggle Ocean Current Streamlines">Ocean Currents (SVG)</button>
              <button id="toggleParticlesLayerBtn" class="btn btn-sm ${particlesPressed}" data-tip="Toggle 60 FPS animated flow particles">Flow Particles (Canvas)</button>
            </div>

            <div style="display: flex; align-items: center; gap: 0.8em; font-size: 0.88em;">
              <span>Particle Speed:</span>
              <input id="particleSpeedSlider" type="range" min="0.5" max="3.0" step="0.1" value="1.5" style="flex: 1;" data-tip="Adjust particle flow animation speed" />
              <span id="particleSpeedLabel">1.5×</span>
            </div>
          </div>
        </fieldset>
      </div>

      <!-- Kolumna 2: Parametry fizyczne -->
      <div style="flex: 1; min-width: 19em;">
        <fieldset>
          <legend><b>💨 Physics & Orography</b></legend>
          <div style="display: flex; flex-direction: column; gap: 0.45em;">
            <label data-tip="Wind stress coupling factor to ocean surface (0.01 - 0.08)">
              <i>Ocean Wind Stress:</i>
              <input id="oceanWindStressInput" type="number" step="0.005" min="0.01" max="0.1" style="width: 5.5em;" />
            </label>
            <label data-tip="Ekman surface layer deflection angle (degrees)">
              <i>Ekman Deflection Angle:</i>
              <input id="ekmanAngleInput" type="number" step="1" min="0" max="45" style="width: 5.5em;" />°
            </label>
            <label data-tip="Western boundary current intensification multiplier (1.0 - 4.0)">
              <i>Western Boundary Intensification:</i>
              <input id="westernIntensificationInput" type="number" step="0.1" min="1.0" max="4.0" style="width: 5.5em;" />×
            </label>
            <label data-tip="Orographic rainout condensation rate on mountain slopes">
              <i>Orographic Condensation:</i>
              <input id="orographicCondensationInput" type="number" step="0.1" min="0.1" max="2.0" style="width: 5.5em;" />
            </label>
            <label data-tip="Foehn adiabatic warming rate in rain shadow">
              <i>Foehn Effect Heating:</i>
              <input id="foehnHeatingInput" type="number" step="0.1" min="0.1" max="2.0" style="width: 5.5em;" />
            </label>
          </div>
        </fieldset>
      </div>

    </div>
  </div>`;
}

function updateInputValues(): void {
  const options = (globalThis as any).options;
  const ocean = options?.oceanCurrents || {};
  const moisture = options?.moisture || {};

  const windStressEl = document.getElementById("oceanWindStressInput") as HTMLInputElement;
  if (windStressEl) windStressEl.value = String(ocean.windStressFactor ?? 0.03);

  const ekmanEl = document.getElementById("ekmanAngleInput") as HTMLInputElement;
  if (ekmanEl) ekmanEl.value = String(ocean.ekmanAngle ?? 30);

  const westEl = document.getElementById("westernIntensificationInput") as HTMLInputElement;
  if (westEl) westEl.value = String(ocean.westernIntensification ?? 2.2);

  const oroEl = document.getElementById("orographicCondensationInput") as HTMLInputElement;
  if (oroEl) oroEl.value = String(moisture.orographicCondensationRate ?? 0.6);

  const foehnEl = document.getElementById("foehnHeatingInput") as HTMLInputElement;
  if (foehnEl) foehnEl.value = String(moisture.foehnHeatingRate ?? 0.5);

  renderBaricCentersList();
}

function renderBaricCentersList(): void {
  const listEl = document.getElementById("baricCentersList");
  if (!listEl) return;

  const options = (globalThis as any).options;
  const centers: BaricCenter[] = options?.atmosphere?.baricCenters || [];

  if (centers.length === 0) {
    listEl.innerHTML =
      "<div style='font-style: italic; color: #888; padding: 0.5em;'>No baric centers defined. Click Auto-Generate or + Add Center.</div>";
    return;
  }

  let html = "<table style='width: 100%; border-collapse: collapse; font-size: 0.88em;'>";
  html +=
    "<thead><tr><th style='text-align: left;'>Type</th><th>p (hPa)</th><th>R (km)</th><th>X, Y</th><th></th></tr></thead><tbody>";

  for (let i = 0; i < centers.length; i++) {
    const c = centers[i];
    const isHigh = c.pressureHPa >= 1013;
    c.type = isHigh ? "high" : "low";
    const badgeColor = isHigh ? "#3b82f6" : "#ef4444";
    const typeLabel = isHigh ? "H (High)" : "L (Low)";

    html += `<tr style="border-bottom: 1px solid #eee;">
      <td style="padding: 4px 2px;"><span id="badge_type_${i}" style="background: ${badgeColor}; color: white; padding: 2px 6px; border-radius: 3px; font-weight: bold;">${typeLabel}</span></td>
      <td style="padding: 4px 2px;"><input type="number" class="centerPressureInput" data-index="${i}" value="${Math.round(c.pressureHPa)}" min="940" max="1060" step="1" style="width: 4.8em;" /></td>
      <td style="padding: 4px 2px;"><input type="number" class="centerRadiusInput" data-index="${i}" value="${Math.round(c.radiusKm)}" min="300" max="6000" step="100" style="width: 4.5em;" /></td>
      <td style="padding: 4px 2px; white-space: nowrap;">
        <input type="number" class="centerXInput" data-index="${i}" value="${Math.round(c.x)}" style="width: 3.6em;" />
        <input type="number" class="centerYInput" data-index="${i}" value="${Math.round(c.y)}" style="width: 3.6em;" />
      </td>
      <td style="padding: 4px 2px;"><button class="removeCenterBtn btn btn-sm" data-index="${i}" style="color: red; cursor: pointer; padding: 2px 6px;">✕</button></td>
    </tr>`;
  }

  html += "</tbody></table>";
  listEl.innerHTML = html;

  // Live edycja pól
  const pressureInputs = listEl.querySelectorAll<HTMLInputElement>(".centerPressureInput");
  pressureInputs.forEach(inp => {
    inp.addEventListener("input", e => {
      const idx = Number((e.currentTarget as HTMLElement).getAttribute("data-index"));
      const val = Number((e.currentTarget as HTMLInputElement).value) || 1013;
      centers[idx].pressureHPa = val;
      const isHigh = val >= 1013;
      centers[idx].type = isHigh ? "high" : "low";

      const badge = document.getElementById(`badge_type_${idx}`);
      if (badge) {
        badge.textContent = isHigh ? "H (High)" : "L (Low)";
        badge.style.background = isHigh ? "#3b82f6" : "#ef4444";
      }

      AtmosphereEngine.generate();
      if (isWindsActive) drawWinds();
      if (isPressureActive) drawPressure();
    });
  });

  const radiusInputs = listEl.querySelectorAll<HTMLInputElement>(".centerRadiusInput");
  radiusInputs.forEach(inp => {
    inp.addEventListener("input", e => {
      const idx = Number((e.currentTarget as HTMLElement).getAttribute("data-index"));
      const val = Number((e.currentTarget as HTMLInputElement).value) || 2000;
      centers[idx].radiusKm = val;
      AtmosphereEngine.generate();
      if (isWindsActive) drawWinds();
      if (isPressureActive) drawPressure();
    });
  });

  const xInputs = listEl.querySelectorAll<HTMLInputElement>(".centerXInput");
  xInputs.forEach(inp => {
    inp.addEventListener("input", e => {
      const idx = Number((e.currentTarget as HTMLElement).getAttribute("data-index"));
      const val = Number((e.currentTarget as HTMLInputElement).value) || 0;
      centers[idx].x = val;
      AtmosphereEngine.generate();
      if (isWindsActive) drawWinds();
      if (isPressureActive) drawPressure();
    });
  });

  const yInputs = listEl.querySelectorAll<HTMLInputElement>(".centerYInput");
  yInputs.forEach(inp => {
    inp.addEventListener("input", e => {
      const idx = Number((e.currentTarget as HTMLElement).getAttribute("data-index"));
      const val = Number((e.currentTarget as HTMLInputElement).value) || 0;
      centers[idx].y = val;
      AtmosphereEngine.generate();
      if (isWindsActive) drawWinds();
      if (isPressureActive) drawPressure();
    });
  });

  // Usuwanie
  const removeButtons = listEl.querySelectorAll(".removeCenterBtn");
  removeButtons.forEach(btn => {
    btn.addEventListener("click", e => {
      const idx = Number((e.currentTarget as HTMLElement).getAttribute("data-index"));
      centers.splice(idx, 1);
      renderBaricCentersList();
      AtmosphereEngine.generate();
      if (isWindsActive) drawWinds();
      if (isPressureActive) drawPressure();
    });
  });
}

function addListeners(): void {
  const addCenterBtn = document.getElementById("addBaricCenterBtn");
  addCenterBtn?.addEventListener("click", () => {
    addCenter();
  });

  const autoCentersBtn = document.getElementById("autoBaricCentersBtn");
  autoCentersBtn?.addEventListener("click", () => {
    AtmosphereEngine.autoGenerateBaricCenters();
    AtmosphereEngine.generate();
    renderBaricCentersList();
    if (isWindsActive) drawWinds();
    if (isPressureActive) drawPressure();
  });

  const showTokensCheckbox = document.getElementById("showTokensCheckbox") as HTMLInputElement;
  showTokensCheckbox?.addEventListener("change", () => {
    let options = (globalThis as any).options;
    if (!options) {
      options = {};
      (globalThis as any).options = options;
    }
    if (!options.atmosphere) options.atmosphere = {};
    options.atmosphere.showTokens = showTokensCheckbox.checked;
    drawPressure();
  });

  const speedSlider = document.getElementById("particleSpeedSlider") as HTMLInputElement;
  const speedLabel = document.getElementById("particleSpeedLabel");
  speedSlider?.addEventListener("input", () => {
    const val = Number(speedSlider.value) || 1.5;
    if (speedLabel) speedLabel.textContent = `${val.toFixed(1)}×`;
    const canvas = document.getElementById("aeroHydroParticleCanvas") as HTMLCanvasElement;
    if (canvas) {
      ParticleAnimator.init(canvas, { particleSpeedMultiplier: val });
    }
  });

  const toggleWindsBtn = document.getElementById("toggleWindsLayerBtn");
  toggleWindsBtn?.addEventListener("click", () => {
    isWindsActive = !isWindsActive;
    if (isWindsActive) {
      toggleWindsBtn.classList.add("pressed");
      drawWinds();
    } else {
      toggleWindsBtn.classList.remove("pressed");
      removeWinds();
    }
  });

  const togglePressureBtn = document.getElementById("togglePressureLayerBtn");
  togglePressureBtn?.addEventListener("click", () => {
    isPressureActive = !isPressureActive;
    if (isPressureActive) {
      togglePressureBtn.classList.add("pressed");
      drawPressure();
    } else {
      togglePressureBtn.classList.remove("pressed");
      removePressure();
    }
  });

  const toggleOceanBtn = document.getElementById("toggleOceanLayerBtn");
  toggleOceanBtn?.addEventListener("click", () => {
    isOceanActive = !isOceanActive;
    if (isOceanActive) {
      toggleOceanBtn.classList.add("pressed");
      drawOceanCurrents();
    } else {
      toggleOceanBtn.classList.remove("pressed");
      removeOceanCurrents();
    }
  });

  const toggleParticlesBtn = document.getElementById("toggleParticlesLayerBtn");
  toggleParticlesBtn?.addEventListener("click", () => {
    isParticlesActive = !isParticlesActive;
    if (isParticlesActive) {
      toggleParticlesBtn.classList.add("pressed");
      drawFlowAnimation();
    } else {
      toggleParticlesBtn.classList.remove("pressed");
      removeFlowAnimation();
    }
  });
}

function addCenter(): void {
  let options = (globalThis as any).options;
  if (!options) {
    options = {};
    (globalThis as any).options = options;
  }
  if (!options.atmosphere) options.atmosphere = {};
  if (!options.atmosphere.baricCenters) options.atmosphere.baricCenters = [];

  const graphWidth = (globalThis as any).graphWidth || 1000;
  const graphHeight = (globalThis as any).graphHeight || 1000;

  const newCenter: BaricCenter = {
    x: Math.round(graphWidth * 0.5 + (Math.random() * 200 - 100)),
    y: Math.round(graphHeight * 0.5 + (Math.random() * 200 - 100)),
    type: "high",
    pressureHPa: 1025,
    radiusKm: 1600,
    thermalOrigin: false
  };

  options.atmosphere.baricCenters.push(newCenter);
  renderBaricCentersList();
  AtmosphereEngine.generate();
  if (isWindsActive) drawWinds();
  if (isPressureActive) drawPressure();
}

function applyChanges(): void {
  let options = (globalThis as any).options;
  if (!options) {
    options = {};
    (globalThis as any).options = options;
  }
  if (!options.oceanCurrents) options.oceanCurrents = {};
  if (!options.moisture) options.moisture = {};

  const windStressEl = document.getElementById("oceanWindStressInput") as HTMLInputElement;
  if (windStressEl) options.oceanCurrents.windStressFactor = Number(windStressEl.value);

  const ekmanEl = document.getElementById("ekmanAngleInput") as HTMLInputElement;
  if (ekmanEl) options.oceanCurrents.ekmanAngle = Number(ekmanEl.value);

  const westEl = document.getElementById("westernIntensificationInput") as HTMLInputElement;
  if (westEl) options.oceanCurrents.westernIntensification = Number(westEl.value);

  const oroEl = document.getElementById("orographicCondensationInput") as HTMLInputElement;
  if (oroEl) options.moisture.orographicCondensationRate = Number(oroEl.value);

  const foehnEl = document.getElementById("foehnHeatingInput") as HTMLInputElement;
  if (foehnEl) options.moisture.foehnHeatingRate = Number(foehnEl.value);
}

export const AeroHydroEditor = {
  open,
  close: () => closeDialog("aeroHydroEditor"),
  createDialogHtml,
  renderBaricCentersList,
  applyChanges
};
