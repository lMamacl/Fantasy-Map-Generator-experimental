// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

describe("AeroHydroEditor", () => {
  let aeroHydroEditor: any;

  beforeEach(async () => {
    (globalThis as any).options = {
      atmosphere: {
        baricCenters: [
          {
            x: 250,
            y: 300,
            type: "high",
            pressureHPa: 1030,
            radiusKm: 2000,
            thermalOrigin: false
          }
        ]
      },
      oceanCurrents: {
        windStressFactor: 0.035,
        ekmanAngle: 35,
        westernIntensification: 2.4
      },
      moisture: {
        orographicCondensationRate: 0.75,
        foehnHeatingRate: 0.6
      }
    };

    document.body.innerHTML = `
      <div id="dialogs"></div>
      <input id="oceanWindStressInput" value="0.04" />
      <input id="ekmanAngleInput" value="40" />
      <input id="westernIntensificationInput" value="2.5" />
      <input id="orographicCondensationInput" value="0.8" />
      <input id="foehnHeatingInput" value="0.7" />
      <div id="baricCentersList"></div>
    `;

    const mod = await import("./aero-hydro-editor");
    aeroHydroEditor = mod.AeroHydroEditor;
  });

  it("generuje strukturę HTML dialogu edytora", () => {
    const html = aeroHydroEditor.createDialogHtml();
    expect(html).toContain('id="aeroHydroEditor"');
    expect(html).toContain("Baric Centers");
    expect(html).toContain("Ocean Wind Stress");
    expect(html).toContain("Orographic Condensation");
  });

  it("applyChanges() poprawnie zapisuje wartości do globalThis.options", () => {
    aeroHydroEditor.applyChanges();

    const options = (globalThis as any).options;
    expect(options.oceanCurrents.windStressFactor).toBe(0.04);
    expect(options.oceanCurrents.ekmanAngle).toBe(40);
    expect(options.oceanCurrents.westernIntensification).toBe(2.5);
    expect(options.moisture.orographicCondensationRate).toBe(0.8);
    expect(options.moisture.foehnHeatingRate).toBe(0.7);
  });
});
