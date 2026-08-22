/**
 * Kontroler edytora klimatu, wiatrów i hydrologii Aero-Hydro 2.0.
 *
 * Umożliwia:
 *   - Edycję parametrów ośrodków barycznych (wyże, niże, położenie, ciśnienie, promień)
 *     z automatyczną klasyfikacją typu na podstawie wartości ciśnienia (p >= 1013 hPa -> High, p < 1013 hPa -> Low).
 *   - Konfigurację parametrów fizycznych atmosfery, cyrkulacji oceanicznej i wilgoci.
 *   - Przełączanie warstw widoku (Wiatry SVG, Prądy morskie SVG, Animacja cząstek Canvas 60 FPS).
 *   - Automatyczną aktywację podglądu przy wejściu do edytora.
 *
 * @module controllers/aero-hydro-editor
 */

import { Layers } from "@/components/layers";
import { AeroHydro } from "@/generators/aero-hydro";
import { ParticleAnimator } from "@/renderers/aero-hydro/canvas-particle-animator";
import { drawOceanCurrents, drawWinds, removeOceanCurrents, removeWinds } from "@/renderers/aero-hydro/draw-aero-hydro";
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

  // Automatycznie włącz warstwę wiatrów po wejściu do edytora
  try {
    if (Layers?.show) {
      Layers.show("winds");
    } else {
      drawWinds();
    }
  } catch (_e) {
    drawWinds();
  }

  const g = globalThis as any;
  if (typeof g.$ === "function") {
    g.$("#aeroHydroEditor").dialog({
      title: "Aero-Hydro Climate & Hydrology Editor",
      resizable: false,
      width: "minmax(46em, 88vw)",
      buttons: {
        "Recalculate Climate": () => {
          applyChanges();
          AeroHydro.generate();
          drawWinds();
          drawOceanCurrents();
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
      <div style="flex: 1.2; min-width: 22em;">
        <fieldset>
          <legend><b>Baric Centers (Atmospheric Pressure)</b></legend>
          <div id="baricCentersList" style="max-height: 16em; overflow-y: auto; margin-bottom: 0.6em;"></div>
          <div style="display: flex; gap: 0.5em;">
            <button id="addBaricCenterBtn" class="btn btn-sm" data-tip="Add a new atmospheric pressure center (auto High/Low based on p)">+ Add Baric Center</button>
          </div>
        </fieldset>

        <fieldset style="margin-top: 1em;">
          <legend><b>Visualization & Map Layers</b></legend>
          <div style="display: flex; flex-direction: column; gap: 0.4em;">
            <div style="display: flex; gap: 0.5em; flex-wrap: wrap;">
              <button id="toggleWindsLayerBtn" class="btn btn-sm" data-tip="Toggle 2D Wind Streamlines & Baric Center Markers on map">Wind & Pressure (SVG)</button>
              <button id="toggleOceanLayerBtn" class="btn btn-sm" data-tip="Toggle Ocean Current Streamlines on map">Ocean Currents (SVG)</button>
              <button id="toggleParticlesLayerBtn" class="btn btn-sm" data-tip="Toggle 60 FPS animated flow particles overlay (Canvas 2D)">Flow Particles (Canvas)</button>
            </div>
          </div>
        </fieldset>
      </div>

      <!-- Kolumna 2: Parametry fizyczne -->
      <div style="flex: 1; min-width: 19em;">
        <fieldset>
          <legend><b>Atmosphere & Ocean Physics</b></legend>
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
      "<div style='font-style: italic; color: #888; padding: 0.5em;'>No baric centers defined. Standard zonal base state active.</div>";
    return;
  }

  let html = "<table style='width: 100%; border-collapse: collapse; font-size: 0.88em;'>";
  html +=
    "<thead><tr><th style='text-align: left;'>Type</th><th>p (hPa)</th><th>R (km)</th><th>X, Y</th><th></th></tr></thead><tbody>";

  for (let i = 0; i < centers.length; i++) {
    const c = centers[i];
    // Automatyczna klasyfikacja na podstawie wartości ciśnienia (>= 1013 -> High, < 1013 -> Low)
    const isHigh = c.pressureHPa >= 1013;
    c.type = isHigh ? "high" : "low";
    const badgeColor = isHigh ? "#dc2626" : "#2563eb";
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

  // Podepnij live edycję pól ciśnienia, promienia i pozycji
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
        badge.style.background = isHigh ? "#dc2626" : "#2563eb";
      }
      drawWinds();
    });
  });

  const radiusInputs = listEl.querySelectorAll<HTMLInputElement>(".centerRadiusInput");
  radiusInputs.forEach(inp => {
    inp.addEventListener("input", e => {
      const idx = Number((e.currentTarget as HTMLElement).getAttribute("data-index"));
      const val = Number((e.currentTarget as HTMLInputElement).value) || 2000;
      centers[idx].radiusKm = val;
    });
  });

  const xInputs = listEl.querySelectorAll<HTMLInputElement>(".centerXInput");
  xInputs.forEach(inp => {
    inp.addEventListener("input", e => {
      const idx = Number((e.currentTarget as HTMLElement).getAttribute("data-index"));
      const val = Number((e.currentTarget as HTMLInputElement).value) || 0;
      centers[idx].x = val;
      drawWinds();
    });
  });

  const yInputs = listEl.querySelectorAll<HTMLInputElement>(".centerYInput");
  yInputs.forEach(inp => {
    inp.addEventListener("input", e => {
      const idx = Number((e.currentTarget as HTMLElement).getAttribute("data-index"));
      const val = Number((e.currentTarget as HTMLInputElement).value) || 0;
      centers[idx].y = val;
      drawWinds();
    });
  });

  // Podepnij usuwanie
  const removeButtons = listEl.querySelectorAll(".removeCenterBtn");
  removeButtons.forEach(btn => {
    btn.addEventListener("click", e => {
      const idx = Number((e.currentTarget as HTMLElement).getAttribute("data-index"));
      centers.splice(idx, 1);
      renderBaricCentersList();
      drawWinds();
    });
  });
}

function addListeners(): void {
  const addCenterBtn = document.getElementById("addBaricCenterBtn");
  addCenterBtn?.addEventListener("click", () => {
    addCenter();
  });

  const toggleWindsBtn = document.getElementById("toggleWindsLayerBtn");
  toggleWindsBtn?.addEventListener("click", () => {
    if (Layers?.toggle) {
      Layers.toggle("winds");
    } else {
      const g = document.getElementById("winds");
      if (g && g.children.length > 0) {
        removeWinds();
      } else {
        drawWinds();
      }
    }
  });

  const toggleOceanBtn = document.getElementById("toggleOceanLayerBtn");
  toggleOceanBtn?.addEventListener("click", () => {
    if (Layers?.toggle) {
      Layers.toggle("oceanCurrents");
    } else {
      const g = document.getElementById("oceanCurrents");
      if (g && g.children.length > 0) {
        removeOceanCurrents();
      } else {
        drawOceanCurrents();
      }
    }
  });

  const toggleParticlesBtn = document.getElementById("toggleParticlesLayerBtn");
  toggleParticlesBtn?.addEventListener("click", () => {
    if (Layers?.toggle) {
      Layers.toggle("flowAnimation");
    } else {
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
    }
  });
}

function addCenter(): void {
  const g = globalThis as any;
  if (!g.options) g.options = {};
  const options = g.options;
  options.atmosphere = options.atmosphere || {};
  options.atmosphere.baricCenters = options.atmosphere.baricCenters || [];

  const graphWidth = (globalThis as any).graphWidth || 1000;
  const graphHeight = (globalThis as any).graphHeight || 1000;

  // Domyślnie utwórz antycyklon o p = 1030 hPa, użytkownik może edytować p w tabeli co automatycznie zmieni typ
  const newCenter: BaricCenter = {
    x: Math.round(graphWidth * (0.3 + Math.random() * 0.4)),
    y: Math.round(graphHeight * (0.3 + Math.random() * 0.4)),
    type: "high",
    pressureHPa: 1030,
    radiusKm: 2500,
    thermalOrigin: false
  };

  options.atmosphere.baricCenters.push(newCenter);
  renderBaricCentersList();
  drawWinds();
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
  renderBaricCentersList,
  addCenter,
  applyChanges
};
