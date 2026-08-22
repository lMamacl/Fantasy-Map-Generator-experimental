/**
 * Kontroler edytora klimatu, wiatrów i hydrologii Aero-Hydro 2.0.
 *
 * Umożliwia:
 *   - Interaktywną edycję ośrodków barycznych (wyże, niże, położenie, ciśnienie, promień).
 *   - Konfigurację parametrów fizycznych atmosfery, cyrkulacji oceanicznej i wilgoci.
 *   - Sterowanie animacją cząstek i wizualizacją wstęg przepływu.
 *   - Natychmiastowe przeliczanie modelu Aero-Hydro 2.0.
 *
 * @module controllers/aero-hydro-editor
 */

import { AeroHydro } from "@/generators/aero-hydro";
import { ParticleAnimator } from "@/renderers/aero-hydro/canvas-particle-animator";
import { StreamlineRenderer } from "@/renderers/aero-hydro/streamline-renderer";
import type { BaricCenter } from "@/types/aero-hydro";
import { ensureEl } from "../utils";

function showTip(text: string): void {
  const g = globalThis as any;
  if (typeof g.tip === "function") g.tip(text);
}

function closeDialog(id: string): void {
  const g = globalThis as any;
  if (typeof g.$ === "function") {
    const el = g.$(`#${id}`);
    if (el.length && el.dialog) el.dialog("destroy");
  }
  const domEl = document.getElementById(id);
  if (domEl) domEl.remove();
}

function open(): void {
  renderDialog();
  updateInputValues();

  const g = globalThis as any;
  if (typeof g.$ === "function") {
    g.$("#aeroHydroEditor").dialog({
      title: "Aero-Hydro Climate & Hydrology Editor",
      resizable: false,
      width: "minmax(42em, 85vw)",
      buttons: {
        "Recalculate Climate": () => {
          applyChanges();
          AeroHydro.generate();
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
  return /* html */ `<div id="aeroHydroEditor" class="dialog stable">
    <div style="display: flex; gap: 1.5em; flex-wrap: wrap;">
      
      <!-- Kolumna 1: Centra baryczne -->
      <div style="flex: 1; min-width: 20em;">
        <fieldset>
          <legend><b>Baric Centers (High / Low Pressure)</b></legend>
          <div id="baricCentersList" style="max-height: 15em; overflow-y: auto; margin-bottom: 0.5em;"></div>
          <div style="display: flex; gap: 0.5em;">
            <button id="addHighCenterBtn" class="btn btn-sm" data-tip="Add High Pressure Center (Anticyclone)">+ Add High (H)</button>
            <button id="addLowCenterBtn" class="btn btn-sm" data-tip="Add Low Pressure Center (Cyclone)">+ Add Low (L)</button>
          </div>
        </fieldset>

        <fieldset style="margin-top: 1em;">
          <legend><b>Flow Visualization & Animation</b></legend>
          <div style="display: flex; gap: 0.5em; margin-bottom: 0.5em;">
            <button id="toggleParticlesBtn" class="btn btn-sm" data-tip="Start/Stop 60 FPS Canvas particle animation">Toggle Particles</button>
            <button id="rebuildStreamlinesBtn" class="btn btn-sm" data-tip="Rebuild SVG streamlines and vectors">Rebuild Streamlines</button>
          </div>
        </fieldset>
      </div>

      <!-- Kolumna 2: Parametry fizyczne -->
      <div style="flex: 1; min-width: 20em;">
        <fieldset>
          <legend><b>Atmosphere & Ocean Physics</b></legend>
          <div style="display: flex; flex-direction: column; gap: 0.4em;">
            <label data-tip="Wind stress coupling factor to ocean surface">
              <i>Ocean Wind Stress:</i>
              <input id="oceanWindStressInput" type="number" step="0.005" min="0.01" max="0.1" style="width: 5em;" />
            </label>
            <label data-tip="Ekman deflection angle (degrees)">
              <i>Ekman Deflection Angle:</i>
              <input id="ekmanAngleInput" type="number" step="1" min="0" max="45" style="width: 5em;" />°
            </label>
            <label data-tip="Western boundary current intensification multiplier">
              <i>Western Boundary Intensification:</i>
              <input id="westernIntensificationInput" type="number" step="0.1" min="1.0" max="4.0" style="width: 5em;" />×
            </label>
            <label data-tip="Orographic rainout condensation rate on mountain slopes">
              <i>Orographic Condensation:</i>
              <input id="orographicCondensationInput" type="number" step="0.1" min="0.1" max="2.0" style="width: 5em;" />
            </label>
            <label data-tip="Foehn adiabatic warming rate in rain shadow">
              <i>Foehn Effect Heating:</i>
              <input id="foehnHeatingInput" type="number" step="0.1" min="0.1" max="2.0" style="width: 5em;" />
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
      "<div style='font-style: italic; color: #888;'>No baric centers defined. Zonal base state active.</div>";
    return;
  }

  let html = "<table style='width: 100%; border-collapse: collapse; font-size: 0.9em;'>";
  html += "<thead><tr><th>Type</th><th>X, Y</th><th>p (hPa)</th><th>R (km)</th><th></th></tr></thead><tbody>";

  for (let i = 0; i < centers.length; i++) {
    const c = centers[i];
    const badgeColor = c.type === "high" ? "#d9534f" : "#0275d8";
    const typeLabel = c.type === "high" ? "H (High)" : "L (Low)";

    html += `<tr>
      <td><span style="background: ${badgeColor}; color: white; padding: 2px 6px; border-radius: 3px; font-weight: bold;">${typeLabel}</span></td>
      <td>${Math.round(c.x)}, ${Math.round(c.y)}</td>
      <td>${Math.round(c.pressureHPa)}</td>
      <td>${Math.round(c.radiusKm)}</td>
      <td><button class="removeCenterBtn btn btn-sm" data-index="${i}" style="color: red; cursor: pointer;">✕</button></td>
    </tr>`;
  }

  html += "</tbody></table>";
  listEl.innerHTML = html;

  // Podepnij usuwanie
  const removeButtons = listEl.querySelectorAll(".removeCenterBtn");
  removeButtons.forEach(btn => {
    btn.addEventListener("click", e => {
      const idx = Number((e.currentTarget as HTMLElement).getAttribute("data-index"));
      centers.splice(idx, 1);
      renderBaricCentersList();
    });
  });
}

function addListeners(): void {
  const addHighBtn = document.getElementById("addHighCenterBtn");
  addHighBtn?.addEventListener("click", () => {
    addCenter("high");
  });

  const addLowBtn = document.getElementById("addLowCenterBtn");
  addLowBtn?.addEventListener("click", () => {
    addCenter("low");
  });

  const toggleParticlesBtn = document.getElementById("toggleParticlesBtn");
  toggleParticlesBtn?.addEventListener("click", () => {
    const isRunning = (ParticleAnimator as any).isRunning;
    if (isRunning) {
      ParticleAnimator.stop();
    } else {
      let canvas = document.getElementById("aeroHydroParticleCanvas") as HTMLCanvasElement;
      if (!canvas) {
        canvas = document.createElement("canvas");
        canvas.id = "aeroHydroParticleCanvas";
        canvas.width = (globalThis as any).graphWidth || 1000;
        canvas.height = (globalThis as any).graphHeight || 1000;
        canvas.style.position = "absolute";
        canvas.style.top = "0";
        canvas.style.left = "0";
        canvas.style.pointerEvents = "none";
        canvas.style.zIndex = "10";
        document.body.appendChild(canvas);
      }
      ParticleAnimator.init(canvas);
      ParticleAnimator.start();
    }
  });

  const rebuildStreamlinesBtn = document.getElementById("rebuildStreamlinesBtn");
  rebuildStreamlinesBtn?.addEventListener("click", () => {
    StreamlineRenderer.generateStreamlines("wind");
    StreamlineRenderer.generateStreamlines("ocean");
  });
}

function addCenter(type: "high" | "low"): void {
  const g = globalThis as any;
  if (!g.options) g.options = {};
  const options = g.options;
  options.atmosphere = options.atmosphere || {};
  options.atmosphere.baricCenters = options.atmosphere.baricCenters || [];

  const graphWidth = (globalThis as any).graphWidth || 1000;
  const graphHeight = (globalThis as any).graphHeight || 1000;

  const newCenter: BaricCenter = {
    x: Math.round(graphWidth * (0.3 + Math.random() * 0.4)),
    y: Math.round(graphHeight * (0.3 + Math.random() * 0.4)),
    type,
    pressureHPa: type === "high" ? 1032 : 985,
    radiusKm: 2500,
    thermalOrigin: false
  };

  options.atmosphere.baricCenters.push(newCenter);
  renderBaricCentersList();
}

function applyChanges(): void {
  const g = globalThis as any;
  if (!g.options) g.options = {};
  const options = g.options;
  options.oceanCurrents = options.oceanCurrents || {};
  options.moisture = options.moisture || {};

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
  renderDialog,
  createDialogHtml,
  updateInputValues,
  applyChanges
};
