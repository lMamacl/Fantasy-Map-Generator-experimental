.
├── combinedSRC.md
├── components
│   ├── layers.ts
│   └── tools.ts
├── controllers
│   ├── heightmap-editor.ts
│   └── world-configurator.ts
├── generators
│   ├── biomes-generator.ts
│   ├── features.ts
│   ├── ice-generator.ts
│   ├── lakes.ts
│   ├── ocean-generator.ts
│   ├── resample.ts
│   ├── river-generator.test.ts
│   └── river-generator.ts
├── renderers
│   ├── draw-lakes.ts
│   ├── draw-ocean.ts
│   ├── draw-precipitation.ts
│   ├── draw-rivers.ts
│   └── draw-temperature.ts
├── services
│   └── io
│       ├── auto-update.ts
│       ├── load.ts
│       └── save.ts
└── types
    ├── global.ts
    └── PackedGraph.ts

8 directories, 23 files


========================================
FILE: ./services/io/save.ts
========================================

// Save the whole .map project to storage, machine or cloud

import { closeDialogs } from "@/components/dialog/dialog-helpers";
import { Layers } from "@/components/layers";
import { tip } from "@/components/tooltips";
import { Services } from "@/services";
import { getUsedFonts } from "@/services/fonts";
import { VERSION } from "@/services/versioning";
import { downloadFile, ensureEl, getFileName, link, parseError, rn } from "@/utils";

type SaveMethod = "storage" | "machine" | "dropbox";

async function saveMap(method: SaveMethod): Promise<void> {
  if (customization) return tip("Map cannot be saved in EDIT mode, please complete the edit and retry", false, "error");
  closeDialogs("#alert");

  try {
    const mapData = prepareMapData();
    const filename = `${getFileName()}.map`;

    if (method === "storage") await saveToStorage(mapData, true);
    if (method === "machine") saveToMachine(mapData, filename);
    if (method === "dropbox") await saveToDropbox(mapData, filename);
  } catch (error) {
    ERROR && console.error(error);
    alertMessage.innerHTML = /* html */ `An error occurred while saving the map. If the issue persists, please copy the message below and report it on ${link(
      "https://github.com/Azgaar/Fantasy-Map-Generator/issues",
      "GitHub"
    )}. <p id="errorBox">${parseError(error as Error)}</p>`;

    $("#alert").dialog({
      resizable: false,
      title: "Saving error",
      width: "28em",
      buttons: {
        Retry: function (this: HTMLElement) {
          $(this).dialog("close");
          saveMap(method);
        },
        Close: function (this: HTMLElement) {
          $(this).dialog("close");
        }
      },
      position: { my: "center", at: "center", of: "svg" }
    });
  }
}

function prepareMapData(): string {
  const date = new Date();
  const dateString = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  const license = "File can be loaded in azgaar.github.io/Fantasy-Map-Generator";
  const params = [VERSION, license, dateString, seed, graphWidth, graphHeight, mapId].join("|");
  const settings = [
    distanceUnitInput.value,
    distanceScale,
    areaUnit.value,
    heightUnit.value,
    heightExponentInput.value,
    temperatureScale.value,
    "", // previously used for barSize.value
    "", // previously used for barLabel.value
    "", // previously used for barBackColor.value
    "", // previously used for barBackColor.value
    "", // previously used for barPosX.value
    "", // previously used for barPosY.value
    populationRate,
    urbanization,
    "", // previously used for mapSizeOutput.value, part of options now
    "", // previously used for latitudeOutput.value, part of options now
    "", // previously used for temperatureEquatorOutput.value
    "", // previously used for tempNorthOutput.value
    "", // previously used for precOutput.value, part of options now
    JSON.stringify(options),
    mapName.value,
    "", // previously used for hideLabels
    stylePreset.value,
    "", // previously used for rescaleLabels
    urbanDensity,
    "", // previously used for longitudeOutput.value, part of options now
    ensureEl<HTMLInputElement>("growthRate").value
  ].join("|");
  const coords = JSON.stringify(mapCoordinates);
  const notesData = JSON.stringify(notes);
  const measurers = JSON.stringify(pack.measurers ?? []);
  const fonts = JSON.stringify(getUsedFonts(ensureEl("map") as Element as SVGSVGElement));
  const layers = JSON.stringify(Layers.state);

  // save svg
  const cloneEl = ensureEl("map").cloneNode(true) as SVGSVGElement;

  // reset transform values to default
  cloneEl.setAttribute("width", String(graphWidth));
  cloneEl.setAttribute("height", String(graphHeight));
  cloneEl.querySelector("#viewbox")?.removeAttribute("transform");

  // relief icons are stored in pack.relief, the layer holds only the currently visible ones
  const cloneTerrain = cloneEl.querySelector("#terrain");
  if (cloneTerrain) cloneTerrain.innerHTML = "";

  const cloneRuler = cloneEl.querySelector("#ruler");
  if (cloneRuler) cloneRuler.innerHTML = ""; // always remove rulers
  const cloneTradeAnimation = cloneEl.querySelector("#tradeAnimation");
  if (cloneTradeAnimation) cloneTradeAnimation.innerHTML = ""; // always remove transient trade animations

  const serializedSVG = new XMLSerializer().serializeToString(cloneEl);

  const { spacing, cellsX, cellsY, boundary, points, features, cellsDesired } = grid;
  const gridGeneral = JSON.stringify({ spacing, cellsX, cellsY, boundary, points, features, cellsDesired });
  const packFeatures = JSON.stringify(pack.features);
  const biomes = JSON.stringify(pack.biomes);
  const cultures = JSON.stringify(pack.cultures);
  const states = JSON.stringify(pack.states);
  const burgs = JSON.stringify(pack.burgs);
  const religions = JSON.stringify(pack.religions);
  const provinces = JSON.stringify(pack.provinces);
  const rivers = JSON.stringify(pack.rivers);
  const relief = JSON.stringify(pack.relief || []);
  const markers = JSON.stringify(pack.markers);
  const cellRoutes = JSON.stringify(pack.cells.routes);
  const routes = JSON.stringify(pack.routes);
  const zones = JSON.stringify(pack.zones);
  const ice = JSON.stringify(pack.ice);
  const goods = JSON.stringify(pack.goods);
  const markets = JSON.stringify(pack.markets || []);
  const deals = JSON.stringify(pack.deals || []);
  const labels = JSON.stringify(pack.addedLabels || []);
  const styleData = JSON.stringify(style);
  const flowFeatures = JSON.stringify(pack.flowFeatures || []);

  // store custom good icons
  const goodIconsEl = ensureEl("good-icons");
  const customGoodIcons = Array.from(goodIconsEl.querySelectorAll('[id^="good-custom-"]') || [])
    .map(el => el.outerHTML)
    .join("")
    .replace(/[\r\n]+/g, " "); // map data is split by CRLF on load

  // store name array only if not the same as default
  const defaultNameBases = Names.getNameBases();
  const namesData = Names.nameBases
    .map((b, i) => {
      const names = defaultNameBases[i] && defaultNameBases[i].b === b.b ? "" : b.b;
      return `${b.name}|${b.min}|${b.max}|${b.d}|${b.m}|${names}`;
    })
    .join("/");

  // round population to save space
  const pop = Array.from(pack.cells.pop).map(p => rn(p, 4));

  // data format as below
  const mapData = [
    params,
    settings,
    coords,
    biomes,
    notesData,
    serializedSVG,
    gridGeneral,
    grid.cells.h,
    grid.cells.prec,
    grid.cells.f,
    grid.cells.t,
    grid.cells.temp,
    packFeatures,
    cultures,
    states,
    burgs,
    pack.cells.biome,
    pack.cells.burg,
    pack.cells.conf,
    pack.cells.culture,
    pack.cells.fl,
    pop,
    pack.cells.r,
    [], // deprecated pack.cells.road
    pack.cells.s,
    pack.cells.state,
    pack.cells.religion,
    pack.cells.province,
    [], // deprecated pack.cells.crossroad
    religions,
    provinces,
    namesData,
    rivers,
    "", // rulers are deprecated, use pack.measurers instead
    fonts,
    markers,
    cellRoutes,
    routes,
    zones,
    ice,
    pack.cells.good,
    goods,
    markets,
    deals,
    pack.cells.market,
    customGoodIcons,
    measurers,
    labels,
    styleData,
    relief,
    layers,
    flowFeatures
  ].join("\r\n");
  return mapData;
}

// save map file to indexedDB
async function saveToStorage(mapData: string, showTip = false): Promise<void> {
  const blob = new Blob([mapData], { type: "text/plain" });
  await ldb.set("lastMap", blob);
  showTip && tip("Map is saved to the browser storage", false, "success");
}

// download map file
function saveToMachine(mapData: string, filename: string): void {
  downloadFile(mapData, filename);
  tip('Map is saved to the "Downloads" folder (CTRL + J to open)', true, "success", 8000);
}

async function saveToDropbox(mapData: string, filename: string): Promise<void> {
  await Services.Cloud.save(filename, mapData);
  tip("Map is saved to your Dropbox", true, "success", 8000);
}

export const Save = { saveMap, prepareMapData, saveToStorage };


========================================
FILE: ./services/io/auto-update.ts
========================================

// Update an old map file to the current version
import { color, min, select } from "d3";
import { type LayerId, Layers, type LayersState } from "@/components/layers";
import { RELIEF_SETS } from "@/data/relief-icons";
import { defaultOptions } from "@/data/view-3d-options";
import type { Label, LabelNameMode } from "@/generators/labels-generator";
import type { Measurer, MeasurerType } from "@/generators/measurers-generator";
import type { Point } from "@/generators/voronoi";
import { getGroupStyle } from "@/renderers/labels/label-groups";
import { unfog } from "@/renderers/overlays/fogging";
import { compareVersions } from "@/services/versioning";
import type { ReliefSet } from "@/types/relief";
import type { LabelGroupStyle } from "@/types/style";
import { ensureEl, findEl, P, parseTransform, rand, rn, rw, safeParseJSON, unique } from "@/utils";
import { parsePathPoints } from "@/utils/pathUtils";

export function resolveVersionConflicts(mapVersion: string, data: string[]): void {
  const isOlderThan = (tagVersion: string) => compareVersions(mapVersion, tagVersion).isOlder;

  if (isOlderThan("1.139.0")) {
    // v1.139.0 moved biomes data from the legacy pipe-delimited format to pack.biomes.
    // This must run before older migrations that consume biome data.
    const [colorData = "", habitabilityData = "", nameData = ""] = data[3].split("|");
    const colors = colorData.split(",");
    const habitability = habitabilityData.split(",").map(Number);
    const names = nameData.split(",");
    const defaults = Biomes.getDefault();
    const biomesCount = Math.max(defaults.length, colors.length, habitability.length, names.length);

    pack.biomes = Array.from({ length: biomesCount }, (_, i) => {
      const defaultBiome = defaults[i];
      const name = names[i] || defaultBiome?.name || "Custom";
      return {
        i,
        name,
        color: colors[i] || defaultBiome?.color || "#999999",
        habitability: habitability[i] ?? defaultBiome?.habitability ?? 50,
        iconsDensity: defaultBiome?.iconsDensity ?? 0,
        icons: defaultBiome?.icons ?? [],
        cost: defaultBiome?.cost ?? 50,
        ...(name === "removed" && { removed: true })
      };
    });
  }

  if (isOlderThan("1.142.0")) {
    // v1.142 still has issue with missing shoreline
    for (const f of pack.features) {
      if (f?.type === "lake" && !f.shoreline) f.shoreline = Lakes.defineShoreline(f);
    }
  }

  if (isOlderThan("1.0.0")) {
    // v1.0 added a new religions layer
    select("#viewbox").insert("g", "#terrain").attr("id", "relig");
    Religions.generate();

    // v1.0 added a legend box
    select("#map").append("g").attr("id", "legend");
    select("#legend")
      .attr("font-family", "Almendra SC")
      .attr("font-size", 13)
      .attr("data-size", 13)
      .attr("data-x", 99)
      .attr("data-y", 93)
      .attr("stroke-width", 2.5)
      .attr("stroke", "#812929")
      .attr("stroke-dasharray", "0 4 10 4")
      .attr("stroke-linecap", "round");

    // v1.0 separated drawBorders fron drawStates()
    select("#borders").append("g").attr("id", "stateBorders");
    select("#borders").append("g").attr("id", "provinceBorders");
    select("#borders")
      .attr("opacity", null)
      .attr("stroke", null)
      .attr("stroke-width", null)
      .attr("stroke-dasharray", null)
      .attr("stroke-linecap", null)
      .attr("filter", null);
    select("#stateBorders")
      .attr("opacity", 0.8)
      .attr("stroke", "#56566d")
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", "2")
      .attr("stroke-linecap", "butt");
    select("#provinceBorders")
      .attr("opacity", 0.8)
      .attr("stroke", "#56566d")
      .attr("stroke-width", 0.5)
      .attr("stroke-dasharray", "1")
      .attr("stroke-linecap", "butt");

    // v1.0 added state relations, provinces, forms and full names
    select("#viewbox").insert("g", "#borders").attr("id", "provs").attr("opacity", 0.6);
    States.collectStatistics();
    States.generateCampaigns();
    States.generateDiplomacy();
    States.defineStateForms();
    Provinces.generate();
    Provinces.getPoles();

    // v1.0 added zones layer
    select("#viewbox").insert("g", "#borders").attr("id", "zones").attr("display", "none");
    select("#zones")
      .attr("opacity", 0.6)
      .attr("stroke", null)
      .attr("stroke-width", 0)
      .attr("stroke-dasharray", null)
      .attr("stroke-linecap", "butt");
    Zones.generate();
    if (!select("#markers").selectAll("*").size()) Markers.generate();

    // v1.0 add fogging layer (state focus)
    select("#viewbox")
      .insert("g", "#ruler")
      .attr("id", "fogging-cont")
      .attr("mask", "url(#fog)")
      .append("g")
      .attr("id", "fogging")
      .style("display", "none");
    select("#fogging").append("rect").attr("x", 0).attr("y", 0).attr("width", "100%").attr("height", "100%");
    select("#deftemp")
      .append("mask")
      .attr("id", "fog")
      .append("rect")
      .attr("x", 0)
      .attr("y", 0)
      .attr("width", "100%")
      .attr("height", "100%")
      .attr("fill", "white");

    // v1.0 changes states opacity bask to regions level
    if (select("#statesBody").attr("opacity")) {
      select("#regions").attr("opacity", select("#statesBody").attr("opacity"));
      select("#statesBody").attr("opacity", null);
    }

    // v1.0 changed labels to multi-lined
    select("#labels")
      .selectAll<SVGTextPathElement, unknown>("textPath")
      .each(function () {
        const text = this.textContent;
        const shift = this.getComputedTextLength() / -1.5;
        this.innerHTML = /* html */ `<tspan x="${shift}">${text}</tspan>`;
      });
  }

  if (isOlderThan("1.1.0")) {
    // v1.0 code had a bug with religion layer id
    if (!select("#relig").size()) select("#viewbox").insert("g", "#terrain").attr("id", "relig");

    // v1.0 had Sympathy status then relaced with Friendly
    for (const s of pack.states) {
      if (!s.diplomacy) continue;
      s.diplomacy = s.diplomacy.map(r => (r === "Sympathy" ? "Friendly" : r));
    }

    // labels should be toggled via style attribute, so remove display attribute
    select("#labels").attr("display", null);

    // v1.0 added religions heirarchy tree
    if (pack.religions[1] && !pack.religions[1].code) {
      pack.religions
        .filter(r => r.i)
        .forEach(r => {
          (r as typeof r & { origin?: number }).origin = 0;
          r.code = r.name.slice(0, 2);
        });
    }

    if (!document.getElementById("freshwater")) {
      select("#lakes").append("g").attr("id", "freshwater");
      select("#lakes")
        .select("#freshwater")
        .attr("opacity", 0.5)
        .attr("fill", "#a6c1fd")
        .attr("stroke", "#5f799d")
        .attr("stroke-width", 0.7)
        .attr("filter", null);
    }

    if (!document.getElementById("salt")) {
      select("#lakes").append("g").attr("id", "salt");
      select("#lakes")
        .select("#salt")
        .attr("opacity", 0.5)
        .attr("fill", "#409b8a")
        .attr("stroke", "#388985")
        .attr("stroke-width", 0.7)
        .attr("filter", null);
    }

    // v1.1 added new lake and coast groups
    if (!document.getElementById("sinkhole")) {
      select("#lakes").append("g").attr("id", "sinkhole");
      select("#lakes").append("g").attr("id", "frozen");
      select("#lakes").append("g").attr("id", "lava");
      select("#lakes")
        .select("#sinkhole")
        .attr("opacity", 1)
        .attr("fill", "#5bc9fd")
        .attr("stroke", "#53a3b0")
        .attr("stroke-width", 0.7)
        .attr("filter", null);
      select("#lakes")
        .select("#frozen")
        .attr("opacity", 0.95)
        .attr("fill", "#cdd4e7")
        .attr("stroke", "#cfe0eb")
        .attr("stroke-width", 0)
        .attr("filter", null);
      select("#lakes")
        .select("#lava")
        .attr("opacity", 0.7)
        .attr("fill", "#90270d")
        .attr("stroke", "#f93e0c")
        .attr("stroke-width", 2)
        .attr("filter", "url(#crumpled)");

      select("#coastline").append("g").attr("id", "sea_island");
      select("#coastline").append("g").attr("id", "lake_island");
      select("#coastline")
        .select("#sea_island")
        .attr("opacity", 0.5)
        .attr("stroke", "#1f3846")
        .attr("stroke-width", 0.7)
        .attr("filter", null);
      select("#coastline")
        .select("#lake_island")
        .attr("opacity", 1)
        .attr("stroke", "#7c8eaf")
        .attr("stroke-width", 0.35)
        .attr("filter", null);
    }

    // v1.1 features stores more data
    select("#deftemp").select("#land").selectAll("path").remove();
    select("#deftemp").select("#water").selectAll("path").remove();
    select("#coastline").selectAll("path").remove();
    select("#lakes").selectAll("path").remove();

    Features.markupPack();
    Measurers.createDefaultRuler();
  }

  if (isOlderThan("1.11.0")) {
    // v1.11 added new attributes
    select("#terrs").attr("scheme", "bright").attr("terracing", 0).attr("skip", 5).attr("relax", 0).attr("curve", 0);
    select("#map").select("#oceanic > *").attr("id", "oceanicPattern");
    select("#oceanLayers").attr("layers", "-6,-3,-1");
    select("#gridOverlay").attr("type", "pointyHex").attr("size", 10);

    // v1.11 added cultures heirarchy tree
    if (pack.cultures[1] && !pack.cultures[1].code) {
      pack.cultures
        .filter(c => c.i)
        .forEach(c => {
          (c as typeof c & { origin?: number }).origin = 0;
          c.code = c.name.slice(0, 2);
        });
    }

    // v1.11 had an issue with fogging being displayed on load
    select("#fog").selectAll("path").remove();

    // v1.2 added new terrain attributes
    const terrain = select("#terrain");
    if (!terrain.attr("set")) terrain.attr("set", "simple");
    if (!terrain.attr("size")) terrain.attr("size", 1);
    if (!terrain.attr("density")) terrain.attr("density", 0.4);
  }

  if (isOlderThan("1.21.0")) {
    // v1.11 replaced "display" attribute by "display" style
    select("#viewbox")
      .selectAll<SVGGElement, unknown>("g")
      .each(function () {
        if (this.hasAttribute("display")) {
          this.removeAttribute("display");
          this.style.display = "none";
        }
      });

    // v1.21 added rivers data to pack
    pack.rivers = []; // rivers data
    select("#rivers")
      .selectAll<SVGPathElement, unknown>("path")
      .each(function () {
        const i = +this.id.slice(5);
        const length = this.getTotalLength() / 2;
        if (!length) return;

        const s = this.getPointAtLength(length);
        const e = this.getPointAtLength(0);
        const source = findCell(s.x, s.y)!;
        const mouth = findCell(e.x, e.y)!;
        const name = Rivers.getName(mouth);
        const type = length < 25 ? rw({ Creek: 9, River: 3, Brook: 3, Stream: 1 }) : "River";
        pack.rivers.push({ i, parent: 0, length, source, mouth, basin: i, name, type } as (typeof pack.rivers)[number]);
      });
  }

  if (isOlderThan("1.22.0")) {
    // v1.22 changed state neighbors from Set object to array
    States.collectStatistics();
  }

  if (isOlderThan("1.3.0")) {
    // v1.3 added global options object
    const winds = (options as unknown as number[]).slice(); // previostly wind was saved in settings[19]
    const year = rand(100, 2000);
    const era = `${Names.getBaseShort(P(0.7) ? 1 : rand(Names.nameBases.length))} Era`;
    const eraShort = `${era[0]}E`;
    const military = Military.getDefaultOptions();
    options = { winds, year, era, eraShort, military } as typeof options;

    // v1.3 added campaings data for all states
    States.generateCampaigns();

    // v1.3 added militry layer
    select("#viewbox")
      .insert("g", "#icons")
      .attr("id", "armies")
      .attr("opacity", 1)
      .attr("fill-opacity", 1)
      .attr("font-size", 6)
      .attr("box-size", 3)
      .attr("stroke", "#000")
      .attr("stroke-width", 0.3);
    Military.generate();
  }

  if (isOlderThan("1.4.0")) {
    // v1.35 added dry lakes
    if (!select("#lakes").select("#dry").size()) {
      select("#lakes").append("g").attr("id", "dry");
      select("#lakes")
        .select("#dry")
        .attr("opacity", 1)
        .attr("fill", "#c9bfa7")
        .attr("stroke", "#8e816f")
        .attr("stroke-width", 0.7)
        .attr("filter", null);
    }

    // v1.4 added ice layer
    select("#viewbox").insert("g", "#coastline").attr("id", "ice").style("display", "none");
    select("#ice")
      .attr("opacity", null)
      .attr("fill", "#e8f0f6")
      .attr("stroke", "#e8f0f6")
      .attr("stroke-width", 1)
      .attr("filter", "url(#dropShadow05)");

    // v1.4 added icon and power attributes for units
    for (const unit of options.military) {
      if (!unit.icon) unit.icon = getUnitIcon(unit.type);
      if (!unit.power) unit.power = unit.crew;
    }

    function getUnitIcon(type: string) {
      if (type === "naval") return "🌊";
      if (type === "ranged") return "🏹";
      if (type === "mounted") return "🐴";
      if (type === "machinery") return "💣";
      if (type === "armored") return "🐢";
      if (type === "aviation") return "🦅";
      if (type === "magical") return "🔮";
      else return "⚔️";
    }

    // v1.4 added state reference for regiments
    pack.states
      .filter(s => s.military)
      .forEach(s => {
        s.military!.forEach(r => {
          r.state = s.i;
        });
      });
  }

  if (isOlderThan("1.5.0")) {
    // not need to store default styles from v 1.5
    localStorage.removeItem("styleClean");
    localStorage.removeItem("styleGloom");
    localStorage.removeItem("styleAncient");
    localStorage.removeItem("styleMonochrome");

    // v1.5 cultures has shield attribute
    pack.cultures.forEach(culture => {
      if (culture.removed) return;
      culture.shield = Cultures.getRandomShield();
    });

    // v1.5 added burg type value
    pack.burgs.forEach(burg => {
      if (!burg.i || burg.removed) return;
      burg.type = Burgs.getType(burg.cell, burg.port);
    });

    // v1.5 added emblems
    select("#deftemp").append("g").attr("id", "defs-emblems");
    select("#viewbox").insert("g", "#population").attr("id", "emblems").style("display", "none");
    select("#emblems").append("g").attr("id", "burgEmblems");
    select("#emblems").append("g").attr("id", "provinceEmblems");
    select("#emblems").append("g").attr("id", "stateEmblems");
    COA.regenerate();
    ensureEl("emblems").style.display = "";

    // v1.5 changed releif icons data
    select("#terrain")
      .selectAll<SVGUseElement, unknown>("use")
      .each(function () {
        const type = this.getAttribute("data-type") || this.getAttribute("xlink:href");
        this.removeAttribute("xlink:href");
        this.removeAttribute("data-type");
        this.removeAttribute("data-size");
        if (type) this.setAttribute("href", type);
      });
  }

  if (isOlderThan("1.6.0")) {
    // v1.6 changed rivers data
    for (const river of pack.rivers) {
      const el = document.getElementById(`river${river.i}`);
      if (el) {
        river.widthFactor = +el.getAttribute("data-width")!;
        el.removeAttribute("data-width");
        el.removeAttribute("data-increment");
        river.discharge = pack.cells.fl[river.mouth] || 1;
        river.width = rn(river.length / 100, 2);
        river.sourceWidth = 0.1;
      } else {
        Rivers.remove(river.i);
      }
    }

    // v1.6 changed lakes data
    for (const f of pack.features) {
      if (f.type !== "lake") continue;
      if (f.evaporation) continue;

      f.flux = f.flux || f.cells * 3;
      f.temp = grid.cells.temp[pack.cells.g[f.firstCell]];
      const heights = pack.cells.c[f.firstCell].map(c => pack.cells.h[c]).filter(h => h >= 20);
      f.height = f.height || min(heights) || 0;
      const height = (f.height - 18) ** heightExponentInput.valueAsNumber;
      const evaporation = ((700 * (f.temp + 0.006 * height)) / 50 + 75) / (80 - f.temp);
      f.evaporation = rn(evaporation * f.cells);
      if (!f.shoreline) f.shoreline = Lakes.defineShoreline(f);
      f.name = f.name || Lakes.getName(f);
      delete f.river;
    }
  }

  if (isOlderThan("1.61.0")) {
    // v1.61 changed rulers data
    select("#ruler").style("display", null);
    pack.measurers = [];

    select("#ruler")
      .selectAll<SVGLineElement, unknown>(".ruler > .white")
      .each(function () {
        const x1 = +this.getAttribute("x1")!;
        const y1 = +this.getAttribute("y1")!;
        const x2 = +this.getAttribute("x2")!;
        const y2 = +this.getAttribute("y2")!;
        if (Number.isNaN(x1) || Number.isNaN(y1) || Number.isNaN(x2) || Number.isNaN(y2)) return;
        const points: Point[] = [
          [x1, y1],
          [x2, y2]
        ];
        pack.measurers.push({ type: "Ruler", points });
      });

    select("#ruler")
      .selectAll<SVGGElement, unknown>("g.opisometer")
      .each(function () {
        const pointsString = this.dataset.points;
        if (!pointsString) return;
        const points = JSON.parse(pointsString);
        pack.measurers.push({ type: "Opisometer", points });
      });

    select("#ruler")
      .selectAll<SVGPathElement, unknown>("path.planimeter")
      .each(function () {
        const length = this.getTotalLength();
        if (length < 30) return;

        const step = length > 1000 ? 40 : length > 400 ? 20 : 10;
        const increment = length / Math.ceil(length / step);
        const points: Point[] = [];
        for (let i = 0; i <= length; i += increment) {
          const point = this.getPointAtLength(i);
          points.push([point.x | 0, point.y | 0]);
        }

        pack.measurers.push({ type: "Planimeter", points });
      });

    select("#ruler").selectAll("*").remove();

    // the measurers are redrawn by the load routine once the layer state is restored
    const ruler = findEl("ruler");
    if (ruler) ruler.style.display = pack.measurers.length ? "" : "none";

    // 1.61 changed oceanicPattern from rect to image
    const pattern = document.getElementById("oceanic")!;
    const filter = pattern.firstElementChild!.getAttribute("filter");
    const href = filter ? `./images/${filter.replace("url(#", "").replace(")", "")}.png` : "";
    pattern.innerHTML = /* html */ `<image id="oceanicPattern" href=${href} width="100" height="100" opacity="0.2"></image>`;
  }

  if (isOlderThan("1.62.0")) {
    // v1.62 changed grid data
    select("#gridOverlay").attr("size", null);
  }

  if (isOlderThan("1.63.0")) {
    // v1.63 changed ocean pattern opacity element
    const oceanPattern = document.getElementById("oceanPattern");
    if (oceanPattern) oceanPattern.removeAttribute("opacity");
    const oceanicPattern = document.getElementById("oceanicPattern");
    if (oceanicPattern && !oceanicPattern.getAttribute("opacity")) oceanicPattern.setAttribute("opacity", "0.2");
  }

  if (isOlderThan("1.64.0")) {
    // v1.64 change states style
    const opacity = select("#regions").attr("opacity");
    const filter = select("#regions").attr("filter");
    select("#statesBody").attr("opacity", opacity).attr("filter", filter);
    select("#statesHalo").attr("opacity", opacity).attr("filter", "blur(5px)");
    select("#regions").attr("opacity", null).attr("filter", null);
  }

  if (isOlderThan("1.65.0")) {
    // v1.65 changed rivers data
    select("#rivers").attr("style", null); // remove style to unhide layer
    const { cells, rivers } = pack;
    const defaultWidthFactor = rn(1 / (Number(pointsInput.dataset.cells) / 10000) ** 0.25, 2);

    for (const river of rivers) {
      const node = document.getElementById(`river${river.i}`) as unknown as SVGPathElement | null;
      if (node && !river.cells) {
        const riverCells = [];
        const riverPoints: [number, number][] = [];

        const length = node.getTotalLength() / 2;
        if (!length) continue;
        const segments = Math.ceil(length / 6);
        const increment = length / segments;

        for (let i = 0; i <= segments; i++) {
          const shift = increment * i;
          const { x: x1, y: y1 } = node.getPointAtLength(length + shift);
          const { x: x2, y: y2 } = node.getPointAtLength(length - shift);
          const x = rn((x1 + x2) / 2, 1);
          const y = rn((y1 + y2) / 2, 1);

          const cell = findCell(x, y);
          riverPoints.push([x, y]);
          riverCells.push(cell);
        }

        river.cells = riverCells as number[];
        river.points = riverPoints;
      }

      river.widthFactor = defaultWidthFactor;

      cells.i.forEach(i => {
        const riverInWater = cells.r[i] && cells.h[i] < 20;
        if (riverInWater) cells.r[i] = 0;
      });
    }
  }

  if (isOlderThan("1.652.0")) {
    // remove style to unhide layers
    select("#rivers").attr("style", null);
    select("#borders").attr("style", null);
  }

  if (isOlderThan("1.7.0")) {
    // v1.7 changed markers data
    const defs = document.getElementById("defs-markers");
    const markersGroup = document.getElementById("markers");

    if (defs && markersGroup) {
      const markerElements = markersGroup.querySelectorAll<SVGUseElement>("use");
      const rescale = +markersGroup.getAttribute("rescale")!;

      pack.markers = Array.from(markerElements).map((el, i) => {
        const id = el.getAttribute("id");
        const note = notes.find(note => note.id === id);
        if (note) note.id = `marker${i}`;

        let x = +el.dataset.x!;
        let y = +el.dataset.y!;

        const transform = el.getAttribute("transform");
        if (transform) {
          const [dx, dy] = parseTransform(transform);
          if (dx) x += +dx;
          if (dy) y += +dy;
        }
        const cell = findCell(x, y);
        const size = rn(rescale ? +el.dataset.size! * 30 : +el.getAttribute("width")!, 1);

        const href = el.href.baseVal;
        const type = href.replace("#marker_", "");
        const symbol = defs?.querySelector(`symbol${href}`);
        const text = symbol?.querySelector("text");
        const circle = symbol?.querySelector("circle");

        const icon = text?.innerHTML;
        const px = text ? Number(text.getAttribute("font-size")?.replace("px", "")) : NaN;
        const dx = text ? Number(text.getAttribute("x")?.replace("%", "")) : NaN;
        const dy = text ? Number(text.getAttribute("y")?.replace("%", "")) : NaN;
        const fill = circle?.getAttribute("fill");
        const stroke = circle?.getAttribute("stroke");

        const marker: Record<string, unknown> = { i, icon, type, x, y, size, cell };
        if (size && size !== 30) marker.size = size;
        if (!Number.isNaN(px) && px !== 12) marker.px = px;
        if (!Number.isNaN(dx) && dx !== 50) marker.dx = dx;
        if (!Number.isNaN(dy) && dy !== 50) marker.dy = dy;
        if (fill && fill !== "#ffffff") marker.fill = fill;
        if (stroke && stroke !== "#000000") marker.stroke = stroke;
        if (circle?.getAttribute("opacity") === "0") marker.pin = "no";

        return marker;
      }) as unknown as typeof pack.markers;

      (markersGroup as HTMLElement).style.display = "";
      defs?.remove();
      markerElements.forEach(el => {
        el.remove();
      });
    }
  }

  if (isOlderThan("1.72.0")) {
    // v1.72 renamed custom style presets
    const storedStyles = Object.keys(localStorage).filter(key => key.startsWith("style"));
    storedStyles.forEach(styleName => {
      const style = localStorage.getItem(styleName)!;
      const newStyleName = styleName.replace(/^style/, customPresetPrefix);
      localStorage.setItem(newStyleName, style);
      localStorage.removeItem(styleName);
    });
  }

  if (isOlderThan("1.73.0")) {
    // v1.73 moved the hatching patterns out of the user's SVG
    document.getElementById("hatching")?.remove();

    // v1.73 added zone type to UI, ensure type is populated
    const zones = Array.from(document.querySelectorAll<SVGGElement>("#zones > g"));
    zones.forEach(zone => {
      if (!zone.dataset.type) zone.dataset.type = "Unknown";
    });
  }

  if (isOlderThan("1.84.0")) {
    // v1.84.0 added grid.cellsDesired to stored data
    if (!grid.cellsDesired) grid.cellsDesired = rn((graphWidth * graphHeight) / grid.spacing ** 2, -3);
  }

  if (isOlderThan("1.85.0")) {
    // v1.84.0 moved intial screen out of maon svg
    select("#map").select("#initial").remove();
  }

  if (isOlderThan("1.86.0")) {
    // v1.86.0 added multi-origin culture and religion hierarchy trees
    for (const culture of pack.cultures) {
      const c = culture as typeof culture & { origin?: number };
      culture.origins = [c.origin as number];
      delete c.origin;
    }

    for (const religion of pack.religions) {
      const r = religion as typeof religion & { origin?: number };
      religion.origins = [r.origin as number];
      delete r.origin;
    }
  }

  if (isOlderThan("1.88.0")) {
    // v1.87 may have incorrect shield for some reason
    pack.states.forEach(({ coa }) => {
      if (coa && typeof coa === "object" && coa.shield === "state") delete coa.shield;
    });
  }

  if (isOlderThan("1.91.0")) {
    // from 1.91.00 custom coa is moved to coa object
    pack.states.forEach(state => {
      if ((state.coa as unknown) === "custom") state.coa = { custom: true } as typeof state.coa;
    });
    pack.provinces.forEach(province => {
      if ((province.coa as unknown) === "custom") province.coa = { custom: true } as typeof province.coa;
    });
    pack.burgs.forEach(burg => {
      if ((burg.coa as unknown) === "custom") burg.coa = { custom: true } as typeof burg.coa;
    });

    // from 1.91.00 emblems don't have transform attribute
    select("#emblems")
      .selectAll<SVGUseElement, unknown>("use")
      .each(function () {
        const transform = this.getAttribute("transform");
        if (!transform) return;

        const [dx, dy] = parseTransform(transform);
        const x = Number(this.getAttribute("x")) + Number(dx);
        const y = Number(this.getAttribute("y")) + Number(dy);

        this.setAttribute("x", String(x));
        this.setAttribute("y", String(y));
        this.removeAttribute("transform");
      });

    // from 1.91.00 coaSize is moved to coa object
    pack.states.forEach(state => {
      const s = state as typeof state & { coaSize?: number };
      if (s.coaSize && s.coa) {
        s.coa.size = s.coaSize;
        delete s.coaSize;
      }
    });

    pack.provinces.forEach(province => {
      const p = province as typeof province & { coaSize?: number };
      if (p.coaSize && p.coa) {
        p.coa.size = p.coaSize;
        delete p.coaSize;
      }
    });

    pack.burgs.forEach(burg => {
      const b = burg as typeof burg & { coaSize?: number };
      if (b.coaSize && b.coa) {
        b.coa.size = b.coaSize;
        delete b.coaSize;
      }
    });
  }

  if (isOlderThan("1.92.0")) {
    // v1.92 change labels text-anchor from 'start' to 'middle'
    select("#labels")
      .selectAll<SVGTSpanElement, unknown>("tspan")
      .each(function () {
        this.setAttribute("x", "0");
      });
  }

  if (isOlderThan("1.94.0")) {
    // from v1.94.00 texture image is removed when layer is off
    select("#texture").style("display", null);

    const textureImage = select("#texture").select<SVGImageElement>("image");
    if (textureImage.size()) {
      // restore parameters
      const x = Number(textureImage.attr("x") || 0);
      const y = Number(textureImage.attr("y") || 0);
      const href = textureImage.attr("xlink:href") || textureImage.attr("href") || textureImage.attr("src");
      // save parameters to parent element
      select("#texture").attr("data-href", href).attr("data-x", x).attr("data-y", y);
    }
  }

  if (isOlderThan("1.95.0")) {
    // v1.95.00 added vignette visual layer
    const mask = select("#deftemp").append("mask").attr("id", "vignette-mask");
    mask.append("rect").attr("fill", "white").attr("x", 0).attr("y", 0).attr("width", "100%").attr("height", "100%");
    mask
      .append("rect")
      .attr("id", "vignette-rect")
      .attr("fill", "black")
      .attr("x", "0.3%")
      .attr("y", "0.4%")
      .attr("width", "99.4%")
      .attr("height", "99.2%")
      .attr("rx", "5%")
      .attr("ry", "5%")
      .attr("filter", "blur(20px)");

    const vignette = select("#map")
      .append("g")
      .attr("id", "vignette")
      .attr("mask", "url(#vignette-mask)")
      .attr("opacity", 0.3)
      .attr("fill", "#000000")
      .style("display", "none");
    vignette.append("rect").attr("x", 0).attr("y", 0).attr("width", "100%").attr("height", "100%");
  }

  if (isOlderThan("1.96.0")) {
    // v1.96 added ocean rendering for heightmap
    select("#terrs").selectAll("*").remove();

    const opacity = select("#terrs").attr("opacity");
    const filter = select("#terrs").attr("filter");
    const scheme = select("#terrs").attr("scheme") || "bright";
    const terracing = select("#terrs").attr("terracing");
    const skip = select("#terrs").attr("skip");
    const relax = select("#terrs").attr("relax");

    const curveTypes: Record<number, string> = { 0: "curveBasisClosed", 1: "curveLinear", 2: "curveStep" };
    const curve = curveTypes[+select("#terrs").attr("curve")] || "curveBasisClosed";

    select("#terrs")
      .attr("opacity", null)
      .attr("filter", null)
      .attr("mask", null)
      .attr("scheme", null)
      .attr("terracing", null)
      .attr("skip", null)
      .attr("relax", null)
      .attr("curve", null);

    select("#terrs")
      .append("g")
      .attr("id", "oceanHeights")
      .attr("data-render", 0)
      .attr("opacity", opacity)
      .attr("filter", filter)
      .attr("scheme", scheme)
      .attr("terracing", 0)
      .attr("skip", 0)
      .attr("relax", 1)
      .attr("curve", curve);

    select("#terrs")
      .append("g")
      .attr("id", "landHeights")
      .attr("opacity", opacity)
      .attr("scheme", scheme)
      .attr("filter", filter)
      .attr("terracing", terracing)
      .attr("skip", skip)
      .attr("relax", relax)
      .attr("curve", curve)
      .attr("mask", "url(#land)");

    // v1.96.00 moved scaleBar options from units editor to style
    select("#scaleBar").remove();
    select("#map")
      .insert("g", "#viewbox + *")
      .attr("id", "scaleBar")
      .attr("opacity", 1)
      .attr("fill", "#353540")
      .attr("data-bar-size", 2)
      .attr("font-size", 10)
      .attr("data-x", 99)
      .attr("data-y", 99)
      .attr("data-label", "");
    select("#scaleBar")
      .append("rect")
      .attr("id", "scaleBarBack")
      .attr("opacity", 0.2)
      .attr("fill", "#ffffff")
      .attr("stroke", "#000000")
      .attr("stroke-width", 1)
      .attr("filter", "url(#blur5)")
      .attr("data-top", 20)
      .attr("data-right", 15)
      .attr("data-bottom", 15)
      .attr("data-left", 10);

    // v1.96.00 changed coloring approach for regiments
    select("#armies")
      .selectAll<SVGGElement, unknown>(":scope > g")
      .each(function () {
        const fill = this.getAttribute("fill");
        if (!fill) return;
        const darkerColor = color(fill)!.darker().formatHex();
        this.setAttribute("color", darkerColor);
        this.querySelectorAll("g > rect:nth-child(2)").forEach(rect => {
          rect.setAttribute("fill", "currentColor");
        });
      });
  }

  if (isOlderThan("1.98.0")) {
    // v1.98.00 changed compass layer and rose element id
    const rose = select("#compass").select("use");
    rose.attr("xlink:href", "#defs-compass-rose");

    if (!select("#compass").selectAll("*").size()) {
      select("#compass").style("display", "none");
      select("#compass").append("use").attr("xlink:href", "#defs-compass-rose");
      shiftCompass();
    }
  }

  if (isOlderThan("1.99.0")) {
    // v1.99.00 changed routes generation algorithm and data format
    select("#routes").attr("display", null).attr("style", null);

    delete (select("#cells") as unknown as Record<string, unknown>).road;
    delete (select("#cells") as unknown as Record<string, unknown>).crossroad;

    pack.routes = [];
    const POINT_DISTANCE = grid.spacing * 0.75;

    for (const g of document.querySelectorAll("#viewbox > #routes > g")) {
      const group = g.id;
      if (!group) continue;

      for (const node of g.querySelectorAll<SVGPathElement>("path")) {
        const totalLength = node.getTotalLength();
        if (!totalLength) {
          ERROR && console.error("Route path has zero length", node);
          continue;
        }

        const increment = totalLength / Math.ceil(totalLength / POINT_DISTANCE);
        const points: [number, number, number | undefined][] = [];

        for (let i = 0; i <= totalLength + 0.1; i += increment) {
          const point = node.getPointAtLength(i);
          const x = rn(point.x, 2);
          const y = rn(point.y, 2);
          const cellId = findCell(x, y);
          points.push([x, y, cellId]);
        }

        if (points.length < 2) {
          ERROR && console.error("Route path has less than 2 points", node);
          continue;
        }

        const secondCellId = points[1][2];
        const feature = secondCellId === undefined ? undefined : pack.cells.f[secondCellId];

        pack.routes.push({ i: pack.routes.length, group, feature, points } as unknown as (typeof pack.routes)[number]);
      }
    }
    select("#routes").selectAll("path").remove();

    pack.cells.routes = {};
    const links = pack.cells.routes;
    for (const route of pack.routes) {
      for (let i = 0; i < route.points.length - 1; i++) {
        const cellId = route.points[i][2];
        const nextCellId = route.points[i + 1][2];

        if (cellId !== nextCellId) {
          if (!links[cellId]) links[cellId] = {};
          links[cellId][nextCellId] = route.i;

          if (!links[nextCellId]) links[nextCellId] = {};
          links[nextCellId][cellId] = route.i;
        }
      }
    }
  }

  if (isOlderThan("1.100.0")) {
    // v1.100.00 added zones to pack data
    pack.zones = [];
    select("#zones")
      .selectAll<SVGGElement, unknown>("g")
      .each(function () {
        const i = pack.zones.length;
        const name = this.dataset.description;
        const type = this.dataset.type;
        const color = this.getAttribute("fill");
        const cells = this.dataset.cells!.split(",").map(Number);
        pack.zones.push({ i, name, type, cells, color } as unknown as (typeof pack.zones)[number]);
      });
    select("#zones").style("display", null).selectAll("*").remove();
  }

  if (isOlderThan("1.104.0")) {
    // v1.104.00 separated pole of inaccessibility detection from layer rendering
    States.getPoles();
    Provinces.getPoles();
  }

  if (isOlderThan("1.105.0")) {
    // v1.104.0 introduced some bugs with layers visibility
    select("#viewbox").select("#icons").style("display", null);
    select("#viewbox").select("#ice").style("display", null);
    select("#viewbox").select("#regions").style("display", null);
    select("#viewbox").select("#armies").style("display", null);
  }

  if (isOlderThan("1.106.0")) {
    // v1.104.0 introduced bugs with coastlines. Redraw features
    select("#deftemp").select("#featurePaths").remove();
    select("#deftemp").append("g").attr("id", "featurePaths");
    select("#deftemp").select("#land").selectAll("path, use").remove();
    select("#deftemp").select("#water").selectAll("path, use").remove();
    select("#viewbox").select("#coastline").selectAll("path, use").remove();

    // v1.104.0 introduced bugs with state borders
    select("#regions")
      .attr("opacity", null)
      .attr("stroke-width", null)
      .attr("letter-spacing", null)
      .attr("fill", null)
      .attr("stroke", null);

    // pole can be missing for some states/provinces
    States.getPoles();
    Provinces.getPoles();
  }

  if (isOlderThan("1.108.0")) {
    // v1.108.0 changed features rendering method
    pack.features.forEach(f => {
      // fix lakes with missing group
      if (f?.type === "lake" && !f.group) f.group = "freshwater";
    });

    // some old maps has incorrect "heights" groups
    select("#viewbox").selectAll("#heights").remove();
  }

  if (isOlderThan("1.109.0")) {
    // v1.109.0 added customizable burg groups and icons
    options.burgs = { groups: [] };

    select("#burgIcons")
      .selectAll<SVGElement, unknown>("circle, use")
      .each(function () {
        const group = (this.parentNode as Element).id;
        const id = this.id.replace(/^burg/, "");
        const burg = pack.burgs[+id];
        if (group && burg) burg.group = group;
      });

    select("#burgIcons")
      .selectAll<SVGGElement, unknown>("g")
      .each(function (_el, index) {
        const name = this.id;
        const isDefault = name === "towns";
        options.burgs.groups.push({ name, active: true, order: index + 1, isDefault, preview: "watabou-city" });
        if (!this.dataset.icon) this.dataset.icon = "#icon-circle";

        const size = Number(this.getAttribute("size") || 2) * 2;
        this.removeAttribute("size");
        this.setAttribute("font-size", String(size));

        this.setAttribute("stroke-width", "1");
      });

    if (options.burgs.groups.filter(g => g.isDefault).length === 0) {
      options.burgs.groups[0].isDefault = true;
    }

    select("#anchors")
      .selectAll<SVGGElement, unknown>("g")
      .each(function () {
        const size = Number(this.getAttribute("size") || 1);
        this.removeAttribute("size");
        this.setAttribute("font-size", String(size));
      });

    select("#burgLabels")
      .selectAll<SVGGElement, unknown>("g")
      .each(function () {
        if (!this.dataset.dy) this.dataset.dy = "-0.4";
      });

    const anchorSymbol = ensureEl("icon-anchor");
    if (anchorSymbol) {
      anchorSymbol.outerHTML = /* html */ `<symbol id="icon-anchor" viewBox="0 0 30 30" width="1em" height="1em" overflow="visible">
        <path d="m 1.003,-9.873 c 0,-0.547 -0.453,-1 -1,-1 -0.547,0 -1,0.453 -1,1 0,0.547 0.453,1 1,1 0.547,0 1,-0.453 1,-1 z m 13,14.5 v 5.5 c 0,0.203 -0.125,0.391 -0.313,0.469 -0.063,0.016 -0.125,0.031 -0.187,0.031 -0.125,0 -0.25,-0.047 -0.359,-0.141 L 11.691,9.033 c -2.453,2.953 -6.859,4.844 -11.688,4.844 -4.829,0 -9.234,-1.891 -11.688,-4.844 l -1.453,1.453 c -0.094,0.094 -0.234,0.141 -0.359,0.141 -0.063,0 -0.125,-0.016 -0.187,-0.031 -0.187,-0.078 -0.313,-0.266 -0.313,-0.469 v -5.5 c 0,-0.281 0.219,-0.5 0.5,-0.5 h 5.5 c 0.203,0 0.391,0.125 0.469,0.313 0.078,0.188 0.031,0.391 -0.109,0.547 L -9.2,6.55 c 1.406,1.891 4.109,3.266 7.203,3.687 V 0.128 h -3 c -0.547,0 -1,-0.453 -1,-1 v -2 c 0,-0.547 0.453,-1 1,-1 h 3 v -2.547 c -1.188,-0.688 -2,-1.969 -2,-3.453 0,-2.203 1.797,-4 4,-4 2.203,0 4,1.797 4,4 0,1.484 -0.812,2.766 -2,3.453 v 2.547 h 3 c 0.547,0 1,0.453 1,1 v 2 c 0,0.547 -0.453,1 -1,1 h -3 V 10.237 C 5.097,9.815 7.8,8.44 9.206,6.55 L 7.643,4.987 C 7.502,4.831 7.456,4.628 7.534,4.44 7.612,4.252 7.8,4.127 8.003,4.127 h 5.5 c 0.281,0 0.5,0.219 0.5,0.5 z"/>
      </symbol>`;
    }

    const validBurgs = pack.burgs.filter(b => b.i && !b.removed);
    const populations = validBurgs.map(b => b.population ?? 0).sort((a, b) => a - b);
    validBurgs.forEach(burg => {
      if (!burg.group) Burgs.defineGroup(burg, populations);

      const b = burg as typeof burg & { MFCG?: number };
      if (b.MFCG) {
        burg.link = Burgs.getPreview(burg)?.link ?? undefined;
        delete b.MFCG;
      }
    });

    const opts = options as Record<string, unknown>;
    delete opts.showBurgPreview;
    delete opts.showMFCGMap;
    delete opts.villageMaxPopulation;
  }

  if (isOlderThan("1.111.0")) {
    // v1.111.0 moved ice data from SVG to data model
    // Migrate old ice SVG elements to new pack.ice structure
    if (!pack.ice.length) {
      pack.ice = [];
      let iceId = 0;

      const iceGroup = document.getElementById("ice");
      if (iceGroup) {
        // Migrate glaciers (type="iceShield")
        iceGroup.querySelectorAll<SVGPolygonElement>("polygon[type='iceShield']").forEach(polygon => {
          // Parse points string "x1,y1 x2,y2 x3,y3 ..." into array [[x1,y1], [x2,y2], ...]
          const points = [...polygon.points].map(svgPoint => [svgPoint.x, svgPoint.y]);

          const transform = polygon.getAttribute("transform");
          const iceElement: Record<string, unknown> = {
            i: iceId++,
            points,
            type: "glacier"
          };
          if (transform) {
            iceElement.offset = parseTransform(transform);
          }
          pack.ice.push(iceElement as unknown as (typeof pack.ice)[number]);
        });

        // Migrate icebergs
        iceGroup.querySelectorAll<SVGPolygonElement>("polygon:not([type])").forEach(polygon => {
          const cellId = +polygon.getAttribute("cell")!;
          const size = +polygon.getAttribute("size")!;

          // points string must exist, cell attribute must be present, and size must be non-zero
          if (polygon.getAttribute("cell") === null || !size) return;

          // Parse points string "x1,y1 x2,y2 x3,y3 ..." into array [[x1,y1], [x2,y2], ...]
          const points = [...polygon.points].map(svgPoint => [svgPoint.x, svgPoint.y]);

          const transform = polygon.getAttribute("transform");
          const iceElement: Record<string, unknown> = {
            i: iceId++,
            points,
            type: "iceberg",
            cellId,
            size
          };
          if (transform) {
            iceElement.offset = parseTransform(transform);
          }
          pack.ice.push(iceElement as unknown as (typeof pack.ice)[number]);
        });

        // Clear old SVG elements
        iceGroup.querySelectorAll("*").forEach(el => {
          el.remove();
        });
      } else {
        // If ice layer element doesn't exist, create it
        select("#viewbox").insert("g", "#coastline").attr("id", "ice");
        select("#ice")
          .attr("opacity", null)
          .attr("fill", "#e8f0f6")
          .attr("stroke", "#e8f0f6")
          .attr("stroke-width", 1)
          .attr("filter", "url(#dropShadow05)");
      }
    }
  }

  if (isOlderThan("1.113.0")) {
    // v1.113.0 fixed issue with zone.cells getting rediculously long
    pack.zones.forEach(zone => {
      zone.cells = unique(zone.cells);
    });
  }

  if (isOlderThan("1.124.0")) {
    // v1.124.0 added goods, markets, deals and trade animation data
    select("#viewbox")
      .insert("g", "#emblems")
      .attr("id", "goods")
      .style("display", "none")
      .attr("stroke-width", "0.32")
      .attr("filter", "url(#dropShadow01)");
    select("#goods").append("g").attr("id", "goodsCells");
    select("#goods").append("g").attr("id", "goodsIcons").attr("data-circle", "1");
    select("#goods").append("g").attr("id", "goodsBurgs");
    select("#viewbox").insert("g", "#emblems").attr("id", "markets").attr("fill-opacity", "0").style("display", "none");
    select("#viewbox").insert("g", "#goods").attr("id", "tradeAnimation").style("display", "none");

    options.trade = { animation: TradeAnimation.getDefaultOptions() };

    for (const state of pack.states) {
      if (!state) continue;
      if (!state.i || state.removed) {
        if (state.i === 0) {
          state.salesTax = 0;
          state.pollTax = 0;
          state.treasury = 0;
        }
        continue;
      }
      const taxes = States.defineTaxRates(state);
      state.salesTax = taxes.salesTax;
      state.pollTax = taxes.pollTax;
      state.treasury = 0;
    }

    Goods.generate();
    Markets.generate();
    Production.produce();
    States.collectTaxes();
  }

  if (isOlderThan("1.127.0")) {
    // goods visibility moved onto the good itself; default to showing the first good
    if (pack.goods?.length && !pack.goods.some(good => good.visible)) pack.goods[0].visible = true;
  }

  if (isOlderThan("1.132.0")) {
    // v1.132.0 added global 3D view options
    options.threeD = { ...defaultOptions };
  }

  if (isOlderThan("1.138.0")) {
    // v1.138.0 migrated measurers from the global rulers string (data[33]) to pack.measurers
    const MEASURER_TYPES = ["Ruler", "Opisometer", "RouteOpisometer", "Planimeter"];
    const isMeasurerType = (type: string): type is MeasurerType => MEASURER_TYPES.includes(type);

    const parse = (serialized: string): Measurer[] => {
      const measurers: Measurer[] = [];
      for (const measurerString of serialized.split("; ")) {
        const [type, pointsString] = measurerString.split(": ");
        if (!type || !pointsString || !isMeasurerType(type)) continue;

        const points = pointsString.split(" ").map(pair => {
          const [x, y] = pair.split(",");
          return [+x, +y] as Point;
        });
        measurers.push({ type, points });
      }
      return measurers;
    };

    if (data[33]) pack.measurers = parse(data[33]);
  }

  if (isOlderThan("1.139.0")) {
    // fix for old issue with heightmap getting styles on top level
    const terrs = select("#terrs");
    if (terrs.attr("opacity") !== null || terrs.attr("filter") !== null || terrs.attr("scheme") !== null) {
      terrs
        .attr("opacity", null)
        .attr("filter", null)
        .attr("scheme", null)
        .attr("terracing", null)
        .attr("skip", null)
        .attr("relax", null)
        .attr("curve", null)
        .attr("mask", null);
    }
  }

  if (isOlderThan("1.140.0")) {
    // v1.140.0 migrated label data and styles to the unified flat Label Group model

    let labels = document.querySelector<SVGGElement>("#labels");
    if (!labels) {
      labels = document.createElementNS("http://www.w3.org/2000/svg", "g");
      labels.setAttribute("id", "labels");
      document.querySelector("#viewbox")?.appendChild(labels);
    }
    labels.setAttribute("font-size", "100px");

    const hadVisibleLabels = getComputedStyle(labels).display !== "none";
    labels.style.removeProperty("display");

    const legacyStateMode = "stateLabelsMode" in options ? options.stateLabelsMode : undefined;
    const stateMode: LabelNameMode =
      legacyStateMode === "short" || legacyStateMode === "full" ? legacyStateMode : "auto";
    const settings = (data[1] || "").split("|");
    const autoVisibility = settings[21] ? Boolean(Number(settings[21])) : true;
    const resizeOnZoom = settings[23] ? Boolean(Number(settings[23])) : true;
    options.labels = { resizeOnZoom, showAll: !autoVisibility, groups: [] };
    style.labels.groups = {};

    for (const type of ["river", "route"] as const) {
      options.labels.groups.push(Labels.getFallbackGroup(type));
      style.labels.groups[type] = getGroupStyle({ name: type, type });
    }

    const burgGroups = Array.from(document.querySelectorAll<SVGGElement>("#burgLabels > g"));
    for (const burgGroup of burgGroups) {
      const name = burgGroup.id;
      const oldStyle = deriveLabelsStyle(burgGroup);
      const fontSize = Number.parseFloat(oldStyle["font-size"] as string);
      const zoom = { min: rn(12 / fontSize - 1, 1), max: rn(120 / fontSize - 1, 1) };

      options.labels.groups.push({ name, type: "burg", isDefault: name === "towns", zoom });
      style.labels.groups[name] = oldStyle;
    }

    const migratedBurgStyle = burgGroups.length ? style.labels.groups[burgGroups[0].id] : undefined;
    for (const { name } of options.burgs.groups) {
      if (options.labels.groups.some(group => group.name === name)) continue;

      const defaultGroup = Labels.getDefaultGroups().find(group => group.type === "burg" && group.name === name);
      const { zoom } = defaultGroup ?? Labels.getFallbackGroup("burg");
      options.labels.groups.push({ name, type: "burg", zoom });
      style.labels.groups[name] = migratedBurgStyle ? { ...migratedBurgStyle } : getGroupStyle({ name, type: "burg" });
    }

    if (options.labels.groups.every(group => !group.isDefault) && options.labels.groups[0])
      options.labels.groups[0].isDefault = true;

    // migrate manually shifted burg labels to pack.burgs[burgId].label
    for (const textEl of document.querySelectorAll<SVGTextElement>("#burgLabels > g > text")) {
      const burgId = +textEl.id.slice(9);
      const burg = pack.burgs[burgId];
      if (!burg) continue;

      const transform = textEl.getAttribute("transform");
      if (!transform) continue;
      const tr = parseTransform(transform);
      const dx = rn(tr[0], 1);
      const dy = rn(tr[1], 1);
      if (dx || dy) burg.label = { dx, dy };
    }

    const provs = document.querySelector<SVGGElement>("#provs");
    const provinceGroup = document.querySelector<SVGGElement>("#provs #provinceLabels");
    if (provs && provinceGroup) {
      const oldStyle = deriveLabelsStyle(provs);
      const fontSize = Number.parseFloat(oldStyle["font-size"] as string);

      options.labels.groups.push({
        name: "province",
        type: "province",
        isDefault: true,
        zoom: deriveZoomExtent(fontSize),
        layerDependency: "provinces",
        active: false
      });
      style.labels.groups.province = oldStyle;
    } else {
      options.labels.groups.push(Labels.getFallbackGroup("province"));
      style.labels.groups.province = getGroupStyle({ name: "province", type: "province" });
    }

    pack.addedLabels = [];
    const addedGroups = Array.from(labels.querySelectorAll<SVGGElement>(":scope > g:not(#states):not(#burgLabels)"));
    for (const addedGroup of addedGroups) {
      let name = addedGroup.id === "addedLabels" ? "added" : addedGroup.id;
      const isExisting = options.labels.groups.find(group => group.name === name);
      if (isExisting) name += options.labels.groups.length;

      const oldStyle = deriveLabelsStyle(addedGroup);
      const fontSize = Number.parseFloat(oldStyle["font-size"] as string);

      options.labels.groups.push({
        name,
        type: "added",
        isDefault: name === "added",
        zoom: deriveZoomExtent(fontSize)
      });
      style.labels.groups[name] = oldStyle;

      for (const textEl of addedGroup.querySelectorAll<SVGTextElement>(":scope > text")) {
        const note = notes.find(note => note.id === textEl.id);

        const pathEl = document.getElementById(`textPath_${textEl.id}`) as SVGPathElement | null;
        if (!pathEl) continue;

        const label = getPathLabel({ textEl, pathEl });
        if (label?.text && label.pathPoints?.length) {
          const [x, y] = label.pathPoints[Math.floor(label.pathPoints.length / 2)];
          const addedLabel = AddedLabels.add({ x, y, label: { ...label, group: name } });
          if (note) note.id = `addedLabel${addedLabel.i}`;
        } else {
          if (note) notes = notes.filter(n => n.id !== note.id); // remove note
        }
      }
    }

    const stateGroup = labels.querySelector<SVGGElement>(":scope > #states");
    if (stateGroup) {
      const oldStyle = deriveLabelsStyle(stateGroup);
      const fontSize = Number.parseFloat(oldStyle["font-size"] as string);

      options.labels.groups.push({
        name: "state",
        type: "state",
        isDefault: true,
        zoom: deriveZoomExtent(fontSize),
        mode: stateMode
      });
      style.labels.groups.state = oldStyle;
    } else {
      options.labels.groups.push({ ...Labels.getFallbackGroup("state"), mode: stateMode });
      style.labels.groups.state = getGroupStyle({ name: "state", type: "state" });
    }

    for (const textEl of document.querySelectorAll<SVGTextElement>("#labels #states > text")) {
      const stateId = +textEl.id.slice(10);
      const state = pack.states[stateId];
      if (!state) continue;

      const pathEl = document.getElementById(`textPath_${textEl.id}`) as SVGPathElement | null;
      if (pathEl) state.label = getPathLabel({ textEl, pathEl, names: [state.name, state.fullName] });
    }

    delete (style as any).burgLabels; // migrated to style.labels.groups
    delete (options as any).stateLabelsMode; // migrated to group settings

    function deriveLabelsStyle(groupEl: SVGGElement): LabelGroupStyle {
      return {
        opacity: groupEl.hasAttribute("opacity") ? Number(groupEl.getAttribute("opacity")) : 1,
        fill: groupEl.getAttribute("fill") || "#000000",
        stroke: groupEl.getAttribute("stroke") || "#000000",
        "stroke-width": Number(groupEl.getAttribute("stroke-width")) || 0,
        style: groupEl.getAttribute("style") || null,
        "letter-spacing": Number(groupEl.getAttribute("letter-spacing")) || 0,
        "font-size": `${Number(groupEl.dataset.size) || Number(groupEl.getAttribute("font-size")) || 18}%`,
        "font-family": groupEl.getAttribute("font-family") || "Almendra SC",
        filter: groupEl.getAttribute("filter") || null,
        "data-dx": Number(groupEl.dataset.dx) || 0,
        "data-dy": Number(groupEl.dataset.dy) || 0
      };
    }

    function deriveZoomExtent(fontSize: number) {
      return { min: rn(12 / fontSize - 1, 1), max: rn(120 / fontSize - 1, 1) };
    }

    function getPathLabel({
      textEl,
      pathEl,
      names
    }: {
      textEl: SVGTextElement;
      pathEl?: SVGPathElement;
      names?: (string | undefined)[];
    }) {
      const label: Label = {};
      const textPath = textEl.querySelector("textPath");
      const text = getMultilineText(textEl);
      if (text && !names?.includes(text)) label.text = text;

      const pathPoints = pathEl ? parsePathPoints(pathEl.getAttribute("d") || "") : null;
      if (pathPoints?.length) label.pathPoints = pathPoints;

      if (textPath) {
        const startOffset = Number.parseFloat(textPath.getAttribute("startOffset") || "");
        if (Number.isFinite(startOffset) && startOffset !== 50) label.startOffset = startOffset;
        const fontSize = Number.parseFloat(textPath.getAttribute("font-size") || "");
        if (Number.isFinite(fontSize) && fontSize !== 100) label.fontSize = fontSize;
        const letterSpacing = Number.parseFloat(textPath.getAttribute("letter-spacing") || "");
        if (letterSpacing && Number.isFinite(letterSpacing)) label.letterSpacing = letterSpacing;
      }

      const [dx, dy] = parseTransform(textEl.getAttribute("transform") || "");
      if (dx) label.dx = rn(dx, 1);
      if (dy) label.dy = rn(dy, 1);

      return Object.keys(label).length > 0 ? label : undefined;
    }

    function getMultilineText(textEl: SVGTextElement) {
      return (
        Array.from(textEl.querySelectorAll("tspan"))
          .map(tspan => tspan.textContent || "")
          .join("|") || textEl.textContent
      );
    }

    provinceGroup?.remove();
    document.getElementById("textPaths")?.replaceChildren();
    labels.replaceChildren();
    // record the state for the 1.144 migration to read: the content this wiped is redrawn by the load routine,
    // so an empty group must not be mistaken for a layer that was off
    labels.dataset.layerActive = String(hadVisibleLabels);

    // other changes
    select("#coastline > #sea_island").attr("filter", null);
  }

  if (isOlderThan("1.142.0")) {
    // v1.142.0 moved relief icons from the svg to pack.relief, rendered within the viewport only
    const terrainEl = document.getElementById("terrain");
    if (terrainEl) {
      // v1.142.0 moved the relief style from the #terrain attributes to style.relief
      const set = terrainEl.getAttribute("set");
      style.relief = {
        set: set && set in RELIEF_SETS ? (set as ReliefSet) : "simple",
        size: Number(terrainEl.getAttribute("size")) || 1,
        density: Number(terrainEl.getAttribute("density")) || 0.4
      };
      for (const attribute of ["set", "size", "density"]) terrainEl.removeAttribute(attribute);

      const iconElements = Array.from(terrainEl.querySelectorAll("use"));
      if (iconElements.length) {
        pack.relief = iconElements.map(useEl => ({
          icon: (useEl.getAttribute("href") || useEl.getAttribute("xlink:href") || "").replace("#", ""),
          x: rn(Number(useEl.getAttribute("x")), 2),
          y: rn(Number(useEl.getAttribute("y")), 2),
          s: rn(Number(useEl.getAttribute("width")), 2)
        }));
        terrainEl.replaceChildren();
      } else {
        terrainEl.style.display = "none";
      }
    }
  }

  if (isOlderThan("1.144.0")) {
    // v1.144.0 replaced the toggleLayer ids with layer ids
    const LAYER_ID_MAP: Record<string, LayerId> = {
      toggleTexture: "texture",
      toggleHeight: "heightmap",
      toggleLakes: "lakes",
      toggleBiomes: "biomes",
      toggleCells: "cells",
      toggleGrid: "grid",
      toggleCoordinates: "coordinates",
      toggleCompass: "compass",
      toggleRivers: "rivers",
      toggleRelief: "relief",
      toggleReligions: "religions",
      toggleCultures: "cultures",
      toggleStates: "states",
      toggleProvinces: "provinces",
      toggleZones: "zones",
      toggleBorders: "borders",
      toggleRoutes: "routes",
      toggleTemperature: "temperature",
      toggleIce: "ice",
      toggleGoods: "goods",
      toggleMarketsLayer: "markets",
      toggleTrade: "trade",
      togglePrecipitation: "precipitation",
      togglePopulation: "population",
      toggleEmblems: "emblems",
      toggleBurgIcons: "burgIcons",
      toggleLabels: "labels",
      toggleMilitary: "military",
      toggleMarkers: "markers",
      toggleRulers: "rulers",
      toggleScaleBar: "scaleBar",
      toggleVignette: "vignette"
    };
    for (const group of options.labels?.groups ?? []) {
      const layer = group.layerDependency && LAYER_ID_MAP[group.layerDependency];
      if (layer) group.layerDependency = layer;
    }

    const storedPresets: Record<string, string[]> | null = safeParseJSON(localStorage.getItem("presets") ?? "");
    if (storedPresets) {
      const remapped = Object.entries(storedPresets).map(([name, ids]) => [
        name,
        Array.isArray(ids) ? ids.map(id => LAYER_ID_MAP[id] ?? id) : ids
      ]);
      localStorage.setItem("presets", JSON.stringify(Object.fromEntries(remapped)));
    }

    // v1.144.0 made the compass rose a declared layer child, so it needs the id the registry looks up
    findEl("compass")?.querySelector("use")?.setAttribute("id", "compassRose");

    // v1.144.0 moved the layers state into data[50]
    data[50] = JSON.stringify(recoverLayersState());
    if (findEl("fog") && findEl("fogging")) unfog();

    // remove href from emblems, to trigger rendering on load
    select("#emblems").selectAll("use").attr("href", null);

    function recoverLayersState(): LayersState {
      const foggingContainer = findEl("fogging-cont");
      const fogging = findEl("fogging");
      if (foggingContainer) foggingContainer.replaceWith(...(fogging ? [fogging] : []));

      // legacy maps can hide layers with the `display` presentation attribute
      for (const layer of Layers.all) {
        const el = findEl<SVGGElement>(layer.elementId);
        if (el?.getAttribute("display") !== "none") continue;
        el.removeAttribute("display");
        el.style.display = "none";
      }

      const filled = (id: string) => Boolean(findEl(id)?.hasChildNodes());
      const has = (id: string, selector: string) => Boolean(findEl(id)?.querySelector(selector));
      const shown = (id: string) => findEl(id) && findEl(id)?.style.display !== "none";
      const labelsGroup = findEl("labels");
      const labelsState = labelsGroup?.dataset.layerActive;
      delete labelsGroup?.dataset.layerActive; // read once: data[50] owns the state from here on

      const active = [
        has("texture", "image") && "texture",
        filled("landHeights") && "heightmap",
        shown("lakes") && "lakes",
        filled("biomes") && "biomes",
        filled("cells") && "cells",
        filled("gridOverlay") && "grid",
        filled("coordinates") && "coordinates",
        shown("compass") && has("compass", "use") && "compass",
        filled("rivers") && "rivers",
        shown("terrain") && "relief",
        filled("relig") && "religions",
        filled("cults") && "cultures",
        filled("statesBody") && "states",
        filled("provs") && "provinces",
        shown("zones") && filled("zones") && "zones",
        shown("borders") && has("borders", "path") && "borders",
        shown("routes") && has("routes", "path") && "routes",
        filled("temperature") && "temperature",
        shown("ice") && "ice",
        shown("goods") && filled("goods") && "goods",
        shown("markets") && filled("markets") && "markets",
        shown("tradeAnimation") && "trade",
        has("prec", "circle") && "precipitation",
        has("population", "line") && "population",
        shown("emblems") && has("emblems", "use") && "emblems",
        shown("icons") && "burgIcons",
        (labelsState ? labelsState === "true" : filled("labels")) && "labels",
        shown("armies") && filled("armies") && "military",
        has("markers", "svg") && "markers",
        shown("ruler") && "rulers",
        shown("scaleBar") && "scaleBar",
        shown("vignette") && "vignette"
      ].filter(Boolean) as string[];

      const positions = new Map(
        Array.from(ensureEl("map").querySelectorAll("#viewbox > *, #map > g"), (node, index) => [node.id, index])
      );
      const order = Layers.all
        .filter(layer => positions.has(layer.elementId))
        .sort((a, b) => positions.get(a.elementId)! - positions.get(b.elementId)!)
        .map(layer => layer.id);

      return { order, active };
    }
  }
}


========================================
FILE: ./services/io/load.ts
========================================

import { select } from "d3";
import { closeDialogs } from "@/components/dialog/dialog-helpers";
import { Layers } from "@/components/layers";
import { clearMainTip, tip } from "@/components/tooltips";
import { applyDefaultViewboxEvents } from "@/components/viewbox-events";
import { clearLegend } from "@/renderers/draw-legend";
import { Services } from "@/services";
import { declareFont } from "@/services/fonts";
import { cleanupData, compareVersions, isValidVersion, parseMapVersion, VERSION } from "@/services/versioning";
import { applyOption, calculateVoronoi, ensureEl, last, link, minmax, parseError, rn } from "@/utils";

async function quickLoad(): Promise<void> {
  const blob = await ldb.get("lastMap");
  if (blob) loadMapPrompt(blob);
  else {
    tip("No map stored. Save map to browser storage first", true, "error", 2000);
    ERROR && console.error("No map stored");
  }
}

async function loadFromDropbox(): Promise<void> {
  const mapPath = ensureEl<HTMLInputElement>("loadFromDropboxSelect").value;

  console.info("Loading map from Dropbox:", mapPath);
  const blob = await Services.Cloud.load(mapPath);
  uploadMap(blob);
}

async function createSharableDropboxLink(): Promise<void> {
  const mapFile = (document.querySelector("#loadFromDropbox select") as HTMLSelectElement).value;
  const sharableLink = ensureEl("sharableLink");
  const sharableLinkContainer = ensureEl("sharableLinkContainer");

  try {
    const previewLink = await Services.Cloud.getLink(mapFile);
    const directLink = previewLink.replace("www.dropbox.com", "dl.dropboxusercontent.com"); // DL allows CORS
    const finalLink = `${location.origin}${location.pathname}?maplink=${directLink}`;

    sharableLink.innerText = `${finalLink.slice(0, 45)}...`;
    sharableLink.setAttribute("href", finalLink);
    sharableLinkContainer.style.display = "block";
  } catch (error) {
    ERROR && console.error(error);
    return tip("Dropbox API error. Can not create link.", true, "error", 2000);
  }
}

function loadMapPrompt(blob: Blob): void {
  const workingTime = (Date.now() - last(mapHistory).created) / 60000; // minutes
  if (workingTime < 5) {
    loadLastSavedMap();
    return;
  }

  alertMessage.innerHTML = /* html */ `Are you sure you want to load saved map?<br />
    All unsaved changes made to the current map will be lost`;
  $("#alert").dialog({
    resizable: false,
    title: "Load saved map",
    buttons: {
      Cancel: function (this: HTMLElement) {
        $(this).dialog("close");
      },
      Load: function (this: HTMLElement) {
        loadLastSavedMap();
        $(this).dialog("close");
      }
    }
  });

  function loadLastSavedMap() {
    WARN && console.warn("Load last saved map");
    try {
      uploadMap(blob);
    } catch (error) {
      ERROR && console.error(error);
      tip("Cannot load last saved map", true, "error", 2000);
    }
  }
}

async function loadMapFromURL(maplink: string, random?: boolean): Promise<void> {
  const controller = new AbortController();
  const TIMEOUT = 120000; // 120 seconds
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    const url = decodeURIComponent(maplink);
    const response = await fetch(url, { method: "GET", mode: "cors", signal: controller.signal });
    if (!response.ok) throw new Error("Cannot load map from URL");

    const blob = await response.blob();
    uploadMap(blob);
  } catch (error) {
    const message =
      (error as Error)?.name === "AbortError"
        ? "Cannot load map from URL: request timed out"
        : (error as Error).message;
    showUploadErrorMessage(message, maplink, random);
    if (random) generateMapOnLoad();
  } finally {
    clearTimeout(timeoutId);
  }
}

function showUploadErrorMessage(error: string, maplink: string, random?: boolean): void {
  ERROR && console.error(error);
  alertMessage.innerHTML = /* html */ `Cannot load map from the ${link(maplink, "link provided")}. ${
    random ? `A new random map is generated. ` : ""
  } Please ensure the
  linked file is reachable and CORS is allowed on server side`;
  $("#alert").dialog({
    title: "Loading error",
    width: "32em",
    buttons: {
      "Clear cache": () => cleanupData(),
      OK: function (this: HTMLElement) {
        $(this).dialog("close");
      }
    }
  });
}

let uploadTimeStart = 0;

function uploadMap(file: Blob, callback?: () => void): void {
  uploadTimeStart = performance.now();

  const fileReader = new FileReader();
  fileReader.onloadend = async fileLoadedEvent => {
    if (callback) callback();
    ensureEl("coas").innerHTML = ""; // remove auto-generated emblems

    const result = fileLoadedEvent.target!.result as ArrayBuffer;
    const { mapData, mapVersion } = await parseLoadedResult(result);

    const isInvalid = !mapData || !isValidVersion(mapVersion!) || mapData.length < 10 || !mapData[5];
    if (isInvalid) return showUploadMessage("invalid", mapData, mapVersion);

    const isUpdated = compareVersions(mapVersion!, VERSION).isEqual;
    if (isUpdated) return showUploadMessage("updated", mapData, mapVersion);

    const isAncient = compareVersions(mapVersion!, "0.70.0").isOlder;
    if (isAncient) return showUploadMessage("ancient", mapData, mapVersion);

    const isNewer = compareVersions(mapVersion!, VERSION).isNewer;
    if (isNewer) return showUploadMessage("newer", mapData, mapVersion);

    const isOutdated = compareVersions(mapVersion!, VERSION).isOlder;
    if (isOutdated) return showUploadMessage("outdated", mapData, mapVersion);
  };

  fileReader.readAsArrayBuffer(file);
}

async function uncompress(compressedData: ArrayBuffer): Promise<Uint8Array | null> {
  try {
    const uncompressedStream = new Blob([compressedData]).stream().pipeThrough(new DecompressionStream("gzip"));

    let uncompressedData: number[] = [];
    for await (const chunk of uncompressedStream) {
      uncompressedData = uncompressedData.concat(Array.from(chunk));
    }

    return new Uint8Array(uncompressedData);
  } catch (error) {
    ERROR && console.error(error);
    return null;
  }
}

async function parseLoadedResult(
  result: ArrayBuffer | Uint8Array
): Promise<{ mapData: string[] | null; mapVersion: string | null }> {
  try {
    const resultAsString = new TextDecoder().decode(result);

    // data can be in FMG internal format or base64 encoded
    const isDelimited = resultAsString.substring(0, 10).includes("|");
    let content = isDelimited ? resultAsString : decodeURIComponent(atob(resultAsString));

    // fix if svg part has CRLF line endings instead of LF
    const svgMatch = content.match(/<svg[^>]*id="map"[\s\S]*?<\/svg>/);
    const svgContent = svgMatch![0];
    const hasCrlfEndings = svgContent.includes("\r\n");
    if (hasCrlfEndings) {
      const correctedSvgContent = svgContent.replace(/\r\n/g, "\n");
      content = content.replace(svgContent, correctedSvgContent);
    }

    const mapData = content.split("\r\n"); // split by CRLF
    const mapVersion = parseMapVersion(mapData[0].split("|")[0] || mapData[0] || "");

    return { mapData, mapVersion };
  } catch (error) {
    const uncompressedData = await uncompress(result as ArrayBuffer); // file can be gzip compressed
    if (uncompressedData) return parseLoadedResult(uncompressedData);

    ERROR && console.error(error);
    return { mapData: null, mapVersion: null };
  }
}

function showUploadMessage(type: string, mapData: string[] | null, mapVersion: string | null): void {
  let message = "";
  let title = "";

  if (type === "invalid") {
    message = "The file does not look like a valid save file.<br>Please check the data format";
    title = "Invalid file";
  } else if (type === "updated") {
    parseLoadedData(mapData!, mapVersion);
    return;
  } else if (type === "ancient") {
    const archive = link("https://github.com/Azgaar/Fantasy-Map-Generator/wiki/Changelog", "archived version");
    message = `The map version you are trying to load (${mapVersion}) is too old and cannot be updated to the current version.<br>Please keep using an ${archive}`;
    title = "Ancient file";
  } else if (type === "newer") {
    message = `The map version you are trying to load (${mapVersion}) is newer than the current version.<br>Please load the file in the appropriate version`;
    title = "Newer file";
  } else if (type === "outdated") {
    INFO && console.info(`Loading map. Auto-updating from ${mapVersion} to ${VERSION}`);
    parseLoadedData(mapData!, mapVersion);
    return;
  }

  alertMessage.innerHTML = message;
  $("#alert").dialog({
    title,
    buttons: {
      "Clear cache": () => cleanupData(),
      OK: function (this: HTMLElement) {
        $(this).dialog("close");
      }
    }
  });
}

async function parseLoadedData(data: string[], mapVersion: string | null): Promise<void> {
  let loadGroupOpen = false;

  try {
    // exit customization
    if (typeof window.closeDialogs === "function") closeDialogs();
    customization = 0;
    if (ensureEl("customizationMenu").offsetParent) ensureEl("styleTab").click();

    {
      const params = data[0].split("|");
      if (params[3]) {
        seed = params[3];
        ensureEl<HTMLInputElement>("optionsSeed").value = seed;
      }
      if (INFO) {
        console.group(params[3] ? `Loaded Map ${seed}` : "Loaded Map");
        loadGroupOpen = true;
      }
      if (params[4]) graphWidth = +params[4];
      if (params[5]) graphHeight = +params[5];
      mapId = params[6] ? +params[6] : Date.now();
    }

    {
      const settings = data[1].split("|");
      if (settings[0]) applyOption(distanceUnitInput, settings[0]);
      if (settings[1]) {
        ensureEl<HTMLInputElement>("distanceScaleInput").value = settings[1];
        distanceScale = +settings[1];
      }
      if (settings[2]) areaUnit.value = settings[2];
      if (settings[3]) applyOption(heightUnit, settings[3]);
      if (settings[4]) heightExponentInput.value = settings[4];
      if (settings[5]) temperatureScale.value = settings[5];
      // setting 6-11 (scaleBar) are part of style now, kept as "" in newer versions for compatibility
      if (settings[12]) {
        ensureEl<HTMLInputElement>("populationRateInput").value = settings[12];
        populationRate = +settings[12];
      }
      if (settings[13]) {
        ensureEl<HTMLInputElement>("urbanizationInput").value = settings[13];
        urbanization = +settings[13];
      }
      if (settings[19]) options = JSON.parse(settings[19]);
      // settings 14, 15, 18, 25 (world configuration) are part of options now, only read for old maps
      if (settings[14]) options.mapSize = minmax(+settings[14], 1, 100);
      if (settings[15]) options.latitude = minmax(+settings[15], 0, 100);
      if (settings[18]) options.prec = minmax(+settings[18], 0, 500);
      options.mapSize ??= 100;
      options.latitude ??= 50;
      options.prec ??= 100;
      options.labels ??= Labels.getDefaultOptions();
      options.burgs ??= { groups: Burgs.getDefaultGroups() };
      // setting 16 and 17 (temperature) are part of options now, kept as "" in newer versions for compatibility
      if (settings[16]) options.temperatureEquator = +settings[16];
      if (settings[17]) options.temperatureNorthPole = options.temperatureSouthPole = +settings[17];
      if (settings[20]) mapName.value = settings[20];
      // if (settings[21]) hideLabels.checked = Boolean(+settings[21]); // moved to options.labels.showAll
      if (settings[22]) stylePreset.value = settings[22];
      // if (settings[23]) rescaleLabels.checked = Boolean(+settings[23]); // moved to options.labels.resizeOnZoom
      if (settings[24]) {
        ensureEl<HTMLInputElement>("urbanDensityInput").value = settings[24];
        urbanDensity = +settings[24];
      }
      if (settings[25]) options.longitude = minmax(+settings[25], 0, 100);
      options.longitude ??= 50;
      if (settings[26]) ensureEl<HTMLInputElement>("growthRate").value = settings[26];
    }
    // ensureEl<HTMLInputElement>("stateLabelsModeInput").value = options.stateLabelsMode; // moved to options.labels.groups[group].mode
    ensureEl<HTMLInputElement>("yearInput").value = String(options.year);
    ensureEl<HTMLInputElement>("eraInput").value = options.era;
    ensureEl<HTMLInputElement>("shapeRendering").value =
      select("#viewbox").attr("shape-rendering") || "geometricPrecision";
    if (data[2]) mapCoordinates = JSON.parse(data[2]);
    if (data[4]) notes = JSON.parse(data[4]);
    if (data[34]) {
      const usedFonts = JSON.parse(data[34]);
      usedFonts.forEach((usedFont: (typeof fonts)[number]) => {
        const { family: usedFamily, unicodeRange: usedRange, variant: usedVariant } = usedFont;
        const defaultFont = fonts.find(
          ({ family, unicodeRange, variant }) =>
            family === usedFamily && unicodeRange === usedRange && variant === usedVariant
        );
        if (!defaultFont) fonts.push(usedFont);
        declareFont(usedFont);
      });
    }

    select("#map").remove();
    document.body.insertAdjacentHTML("afterbegin", data[5]);

    const viewbox = select("#viewbox");
    if (!select("#texture").size()) {
      viewbox.insert("g", "#landmass").attr("id", "texture").attr("data-href", "./images/textures/plaster.jpg");
    }
    if (!select("#emblems").size()) {
      viewbox.insert("g", "#labels").attr("id", "emblems").style("display", "none");
    }

    {
      grid = JSON.parse(data[6]);
      const { cells, vertices } = calculateVoronoi(grid.points, grid.boundary);
      grid.cells = cells;
      grid.vertices = vertices;
      grid.cells.h = Uint8Array.from(data[7].split(","), Number);
      grid.cells.prec = Uint8Array.from(data[8].split(","), Number);
      grid.cells.f = Uint16Array.from(data[9].split(","), Number);
      grid.cells.t = Int8Array.from(data[10].split(","), Number);
      grid.cells.temp = Int8Array.from(data[11].split(","), Number);
    }
    reGraph();
    Features.markupPack();
    if (data[3]?.startsWith("[")) {
      type LoadedBiome = (typeof pack.biomes)[number] & {
        cells?: number;
        area?: number;
        rural?: number;
        urban?: number;
      };
      const loadedBiomes: LoadedBiome[] = JSON.parse(data[3]);
      for (const biome of loadedBiomes) {
        delete biome.cells;
        delete biome.area;
        delete biome.rural;
        delete biome.urban;
      }
      pack.biomes = loadedBiomes;
    } else {
      pack.biomes = [];
    }
    pack.features = JSON.parse(data[12]);
    pack.cultures = JSON.parse(data[13]);
    pack.states = JSON.parse(data[14]);
    pack.burgs = JSON.parse(data[15]);
    pack.religions = data[29] ? JSON.parse(data[29]) : ([{ i: 0, name: "No religion" }] as typeof pack.religions);
    pack.provinces = data[30] ? JSON.parse(data[30]) : ([0] as unknown as typeof pack.provinces);
    pack.rivers = data[32] ? JSON.parse(data[32]) : [];
    pack.markers = data[35] ? JSON.parse(data[35]) : [];
    pack.routes = data[37] ? JSON.parse(data[37]) : [];
    pack.zones = data[38] ? JSON.parse(data[38]) : [];
    pack.cells.biome = Uint8Array.from(data[16].split(","), Number);
    pack.cells.burg = Uint16Array.from(data[17].split(","), Number);
    pack.cells.conf = Uint8Array.from(data[18].split(","), Number);
    pack.cells.culture = Uint16Array.from(data[19].split(","), Number);
    pack.cells.fl = Uint16Array.from(data[20].split(","), Number);
    pack.cells.pop = Float32Array.from(data[21].split(","), Number);
    pack.cells.r = Uint16Array.from(data[22].split(","), Number);
    // data[23] had deprecated cells.road
    pack.cells.s = Uint16Array.from(data[24].split(","), Number);
    pack.cells.state = Uint16Array.from(data[25].split(","), Number);
    pack.cells.religion = data[26]
      ? Uint16Array.from(data[26].split(","), Number)
      : new Uint16Array(pack.cells.i.length);
    pack.cells.province = data[27]
      ? Uint16Array.from(data[27].split(","), Number)
      : new Uint16Array(pack.cells.i.length);
    // data[28] had deprecated cells.crossroad
    // data[33] had deprecated rulers, now replaced by pack.measurers
    pack.cells.routes = data[36] ? JSON.parse(data[36]) : {};
    pack.ice = data[39] ? JSON.parse(data[39]) : [];
    pack.cells.good = data[40] ? Uint16Array.from(data[40].split(","), Number) : new Uint16Array(pack.cells.i.length);
    pack.goods = data[41] ? JSON.parse(data[41]) : [];
    pack.markets = data[42] ? JSON.parse(data[42]) : [];
    pack.deals = data[43] ? JSON.parse(data[43]) : [];
    pack.cells.market = data[44] ? Uint16Array.from(data[44].split(","), Number) : new Uint16Array(pack.cells.i.length);
    pack.measurers = data[46] ? JSON.parse(data[46]) : [];
    pack.addedLabels = data[47] ? JSON.parse(data[47]) : [];
    pack.relief = data[49] ? JSON.parse(data[49]) : [];

    if (data[31]) {
      const namesDL = data[31].split("/");
      namesDL.forEach((d, i) => {
        const e = d.split("|");
        if (!e.length) return;
        const b = e[5].split(",").length > 2 || !Names.nameBases[i] ? e[5] : Names.nameBases[i].b;
        Names.nameBases[i] = { name: e[0], i, min: +e[1], max: +e[2], d: e[3], m: +e[4], b };
      });
    }

    // data[45]: custom good icons
    if (data[45]) {
      const goodIconsDefs = document.getElementById("good-icons");
      if (goodIconsDefs) goodIconsDefs.insertAdjacentHTML("beforeend", data[45]);
    }

    if (data[48]) style = JSON.parse(data[48]);
    pack.flowFeatures = data[51] ? JSON.parse(data[51]) : [];
    if (typeof AeroHydro !== "undefined" && AeroHydro) {
      AeroHydro.flowFeatures = pack.flowFeatures || [];
    }

    {
      const { resolveVersionConflicts } = await import("./auto-update");
      resolveVersionConflicts(mapVersion!, data);
    }

    if (data[50]) Layers.restore(JSON.parse(data[50]));

    Goods.sync();
    Markets.sync();
    Routes.sync();
    TradeAnimation.sync();

    select("#scaleBar")
      .on("mousemove", () => tip("Click to open Units Editor"))
      .on("click", () => window.Controllers.UnitsEditor.open());
    select("#legend")
      .on("mousemove", () => tip("Drag to change the position. Click to hide the legend"))
      .on("click", () => clearLegend());

    // add custom heightmap color scheme if any
    if (heightmapColorSchemes) {
      const oceanHeights = document.getElementById("oceanHeights");
      const oceanScheme = oceanHeights?.getAttribute("scheme");
      if (oceanScheme && !(oceanScheme in heightmapColorSchemes)) addCustomColorScheme(oceanScheme);
      const landHeights = document.getElementById("landHeights");
      const landScheme = landHeights?.getAttribute("scheme");
      if (landScheme && !(landScheme in heightmapColorSchemes)) addCustomColorScheme(landScheme);
    }

    {
      // add custom texture if any
      const textureHref = select("#texture").attr("data-href");
      if (textureHref) updateTextureSelectValue(textureHref);
    }

    // data integrity checks
    {
      const { cells, vertices } = pack;

      const cellsMismatch = cells.i.length !== cells.state.length;
      const featureVerticesMismatch = pack.features.some(f => f?.vertices?.some(vertex => !vertices.p[vertex]));

      if (cellsMismatch || featureVerticesMismatch) {
        const message = "[Data integrity] Striping issue detected. To fix try to edit the heightmap in ERASE mode";
        throw new Error(message);
      }

      const invalidStates = [...new Set(cells.state)].filter(s => !pack.states[s] || pack.states[s].removed);
      invalidStates.forEach(s => {
        const invalidCells = cells.i.filter(i => cells.state[i] === s);
        invalidCells.forEach(i => {
          cells.state[i] = 0;
        });
        ERROR && console.error("[Data integrity] Invalid state", s, "is assigned to cells", invalidCells);
      });

      const invalidProvinces = [...new Set(cells.province)].filter(
        p => p && (!pack.provinces[p] || (pack.provinces[p] as { removed?: boolean }).removed)
      );
      invalidProvinces.forEach(p => {
        const invalidCells = cells.i.filter(i => cells.province[i] === p);
        invalidCells.forEach(i => {
          cells.province[i] = 0;
        });
        ERROR && console.error("[Data integrity] Invalid province", p, "is assigned to cells", invalidCells);
      });

      const invalidCultures = [...new Set(cells.culture)].filter(c => !pack.cultures[c] || pack.cultures[c].removed);
      invalidCultures.forEach(c => {
        const invalidCells = cells.i.filter(i => cells.culture[i] === c);
        invalidCells.forEach(i => {
          cells.province[i] = 0;
        });
        ERROR && console.error("[Data integrity] Invalid culture", c, "is assigned to cells", invalidCells);
      });

      const invalidReligions = [...new Set(cells.religion)].filter(
        r => !pack.religions[r] || pack.religions[r].removed
      );
      invalidReligions.forEach(r => {
        const invalidCells = cells.i.filter(i => cells.religion[i] === r);
        invalidCells.forEach(i => {
          cells.religion[i] = 0;
        });
        ERROR && console.error("[Data integrity] Invalid religion", r, "is assigned to cells", invalidCells);
      });

      const invalidFeatures = [...new Set(cells.f)].filter(f => f && !pack.features[f]);
      invalidFeatures.forEach(f => {
        const invalidCells = cells.i.filter(i => cells.f[i] === f);
        // No fix as for now
        ERROR && console.error("[Data integrity] Invalid feature", f, "is assigned to cells", invalidCells);
      });

      const invalidBurgs = [...new Set(cells.burg)].filter(
        burgId => burgId && (!pack.burgs[burgId] || pack.burgs[burgId].removed)
      );
      invalidBurgs.forEach(burgId => {
        const invalidCells = cells.i.filter(i => cells.burg[i] === burgId);
        invalidCells.forEach(i => {
          cells.burg[i] = 0;
        });
        ERROR && console.error("[Data integrity] Invalid burg", burgId, "is assigned to cells", invalidCells);
      });

      const invalidRivers = [...new Set(cells.r)].filter(r => r && !pack.rivers.find(river => river.i === r));
      invalidRivers.forEach(r => {
        const invalidCells = cells.i.filter(i => cells.r[i] === r);
        invalidCells.forEach(i => {
          cells.r[i] = 0;
        });
        select("#rivers").select(`river${r}`).remove();
        ERROR && console.error("[Data integrity] Invalid river", r, "is assigned to cells", invalidCells);
      });

      pack.burgs.forEach(burg => {
        if (typeof burg.capital === "boolean") burg.capital = Number(burg.capital);

        if (!burg.i && burg.lock) {
          ERROR && console.error(`[Data integrity] Burg 0 is marked as locked, removing the status`);
          delete burg.lock;
          return;
        }

        if (burg.removed && burg.lock) {
          ERROR && console.error(`[Data integrity] Removed burg ${burg.i} is marked as locked. Unlocking the burg`);
          delete burg.lock;
          return;
        }

        if (!burg.i || burg.removed) return;

        if (burg.cell === undefined || burg.x === undefined || burg.y === undefined) {
          ERROR &&
            console.error(`[Data integrity] Burg ${burg.i} is missing cell info or coordinates. Removing the burg`);
          burg.removed = true;
        }

        if ((burg.port ?? 0) < 0) {
          ERROR && console.error("[Data integrity] Burg", burg.i, "has invalid port value", burg.port);
          burg.port = 0;
        }

        if (burg.cell >= cells.i.length) {
          ERROR && console.error("[Data integrity] Burg", burg.i, "is linked to invalid cell", burg.cell);
          burg.cell = findCell(burg.x, burg.y)!;
          cells.i
            .filter(i => cells.burg[i] === burg.i)
            .forEach(i => {
              cells.burg[i] = 0;
            });
          cells.burg[burg.cell] = burg.i;
        }

        if (burg.state && !pack.states[burg.state]) {
          ERROR && console.error("[Data integrity] Burg", burg.i, "is linked to invalid state", burg.state);
          burg.state = 0;
        }

        if (burg.state && pack.states[burg.state].removed) {
          ERROR && console.error("[Data integrity] Burg", burg.i, "is linked to removed state", burg.state);
          burg.state = 0;
        }

        if (burg.state === undefined) {
          ERROR && console.error("[Data integrity] Burg", burg.i, "has no state data");
          burg.state = 0;
        }
      });

      pack.states.forEach(state => {
        if (state.removed) return;

        const stateBurgs = pack.burgs.filter(b => b.state === state.i && !b.removed);
        const capitalBurgs = stateBurgs.filter(b => b.capital);

        if (!state.i && capitalBurgs.length) {
          ERROR &&
            console.error(
              `[Data integrity] Neutral burgs (${capitalBurgs.map(b => b.i).join(", ")}) marked as capitals`
            );

          capitalBurgs.forEach(burg => {
            burg.capital = 0;
            Burgs.changeGroup(burg, null);
          });

          return;
        }

        if (capitalBurgs.length > 1) {
          const message = `[Data integrity] State ${state.i} has multiple capitals (${capitalBurgs
            .map(b => b.i)
            .join(", ")}) assigned. Keeping the first as capital and moving others`;
          ERROR && console.error(message);

          capitalBurgs.forEach((burg, i) => {
            if (!i) return;
            burg.capital = 0;
            Burgs.changeGroup(burg, null);
          });

          return;
        }

        if (state.i && stateBurgs.length && !capitalBurgs.length) {
          ERROR && console.error(`[Data integrity] State ${state.i} has no capital. Making the first burg capital`);
          const capital = stateBurgs[0];
          capital.capital = 1;
          Burgs.changeGroup(capital, null);
        }
      });

      pack.provinces.forEach(p => {
        if (!p?.i || p?.removed) return;
        const state = pack.states[p.state];
        if (state && !state.removed) return;
        ERROR &&
          console.error(
            `[Data integrity] Province ${p.i} is linked to removed state ${p.state}. Removing the province`
          );
        p.removed = true;
      });

      pack.routes.forEach(route => {
        if (!route.points || route.points.length < 2) {
          ERROR && console.error(`[Data integrity] Route ${route.i} has less than 2 points. Removing the route`);
          Routes.remove(route);
        }
      });

      for (const from in pack.cells.routes) {
        const value = pack.cells.routes[+from];
        if (!value) continue;

        if (Object.keys(value).length === 0) {
          // remove empty object
          delete pack.cells.routes[+from];
          continue;
        }

        for (const to in value) {
          const routeId = value[+to];
          const route = pack.routes.find(r => r.i === routeId);
          if (!route) {
            ERROR &&
              console.error(`[Data integrity] Route ${routeId} from ${from} to ${to} is missing. Removing the route`);
            delete pack.cells.routes[+from][+to];
          }
        }
      }

      {
        const markerIds: boolean[] = [];
        let nextId = (last(pack.markers)?.i ?? -1) + 1 || 0;

        pack.markers.forEach(marker => {
          if (markerIds[marker.i]) {
            ERROR && console.error("[Data integrity] Marker", marker.i, "has non-unique id. Changing to", nextId);

            const domElements = document.querySelectorAll<HTMLElement>(`#marker${marker.i}`);
            if (domElements[1]) domElements[1].id = `marker${nextId}`; // rename 2nd dom element

            const noteElements = notes.filter(note => note.id === `marker${marker.i}`);
            if (noteElements[1]) noteElements[1].id = `marker${nextId}`; // rename 2nd note

            marker.i = nextId;
            nextId += 1;
          } else {
            markerIds[marker.i] = true;
          }
        });

        // sort markers by index
        pack.markers.sort((a, b) => a.i - b.i);
      }
    }

    Layers.drawAll();
    applyDefaultViewboxEvents();
    focusOn();
    invokeActiveZooming();
    fitMapToScreen();

    WARN && console.warn(`TOTAL: ${rn((performance.now() - uploadTimeStart) / 1000, 2)}s`);
    showStatistics();
    tip("Map is successfully loaded", true, "success", 7000);
  } catch (error) {
    ERROR && console.error(error);
    clearMainTip();

    alertMessage.innerHTML = /* html */ `An error occurred while loading the map. Select a different file to load, <br>generate a new random map or cancel the loading.<br>Map version: ${mapVersion}. Generator version: ${VERSION}.
      <p id="errorBox">${parseError(error as Error)}</p>`;

    $("#alert").dialog({
      resizable: false,
      title: "Loading error",
      maxWidth: "40em",
      buttons: {
        "Clear cache": () => cleanupData(),
        "Select file": function (this: HTMLElement) {
          $(this).dialog("close");
          ensureEl("mapToLoad").click();
        },
        "New map": function (this: HTMLElement) {
          $(this).dialog("close");
          regenerateMap("loading error");
        },
        Cancel: function (this: HTMLElement) {
          $(this).dialog("close");
        }
      },
      position: { my: "center", at: "center", of: "svg" }
    });
  } finally {
    if (loadGroupOpen) console.groupEnd();
  }
}

export const Load = {
  quickLoad,
  loadFromDropbox,
  createSharableDropboxLink,
  loadMapFromURL,
  showUploadErrorMessage,
  uploadMap
};


========================================
FILE: ./controllers/heightmap-editor.ts
========================================

import { drag, easeSinInOut, hsl, interpolateRound, lab, max, mean, quadtree, range, select } from "d3";
import { closeDialogs, destroyDialog, refreshEditors } from "@/components/dialog/dialog-helpers";
import { Layers } from "@/components/layers";
import { clearMainTip, showMainTip, tip } from "@/components/tooltips";
import { applyDefaultViewboxEvents } from "@/components/viewbox-events";
import { Controllers } from "@/controllers";
import { heightmapTemplates } from "@/data/heightmap-templates";
import { moveCircle, removeCircle } from "@/renderers/overlays/brush-circle";
import { downloadFile, getFileName, uploadFile } from "@/utils";
import {
  ensureEl,
  findEl,
  findGridAll,
  findGridCell,
  generateSeed,
  getGridPolygon,
  getPointer,
  last,
  lim,
  link,
  minmax,
  rn,
  unique
} from "../utils";
import type { PromptOptions } from "../utils/commonUtils";

// Legacy app prompt shadows the DOM built-in (same pattern as burg-editor / route-groups-editor). TODO: replace with dialog
declare const prompt: (text: string, options: PromptOptions, callback: (value: string | number) => void) => void;
let defaultCellTypeFilter: "all" | "land" | "water" = "all";

function open(options?: { mode?: string; tool?: string }): void {
  const { mode, tool } = options || {};
  restartHistory();
  select<SVGElement, unknown>("#viewbox").selectAll("#heights").remove();
  select<SVGElement, unknown>("#viewbox").insert("g", "#terrs").attr("id", "heights");

  if (!mode) showModeDialog(tool);
  else enterHeightmapEditMode(mode, tool);
}

addToolbarListeners();

function renderTemplateEditor(): void {
  destroyDialog("templateEditor");
  const html = /* html */ `<div id="templateEditor" class="dialog stable">
      <div id="templateTop">
        <i>Select template: </i>
        <select id="templateSelect" style="width: 16em" data-prev="templateCustom" data-tip="Select base template">
          <option value="custom" selected>Custom</option>
          <option value="volcano">Volcano</option>
          <option value="highIsland">High Island</option>
          <option value="lowIsland">Low Island</option>
          <option value="continents">Continents</option>
          <option value="archipelago">Archipelago</option>
          <option value="atoll">Atoll</option>
          <option value="mediterranean">Mediterranean</option>
          <option value="peninsula">Peninsula</option>
          <option value="pangea">Pangea</option>
          <option value="isthmus">Isthmus</option>
          <option value="shattered">Shattered</option>
          <option value="taklamakan">Taklamakan</option>
          <option value="oldWorld">Old World</option>
          <option value="fractious">Fractious</option>
        </select>
      </div>
      <div id="templateTools">
        <button data-type="Hill" data-tip="Hill: small blob">H</button>
        <button data-type="Pit" data-tip="Pit: round depression">P</button>
        <button data-type="Range" data-tip="Range: elongated elevation">R</button>
        <button data-type="Trough" data-tip="Trough: elongated depression">T</button>
        <button data-type="Strait" data-tip="Strait: centered vertical or horizontal depression">S</button>
        <button data-type="Mask" data-tip="Mask: lower cells near edges or in map center">M</button>
        <button data-type="Invert" data-tip="Invert heightmap along the axes">I</button>
        <button data-type="Add" data-tip="Add or subtract value from all heights in range">+</button>
        <button data-type="Multiply" data-tip="Multiply all heights in range by factor">*</button>
        <button
          data-type="Smooth"
          data-tip="Smooth the map replacing cell heights by an average values of its neighbors"
        >
          ~
        </button>
      </div>
      <div id="templateBody" data-changed="0" class="table" style="padding: 2px 0">
        <div data-type="Hill">
          <div class="icon-check" data-tip="Click to skip the step"></div>
          <div style="width: 4em">Hill</div>
          <i class="icon-trash-empty pointer" data-tip="Remove the step"></i>
          <i class="icon-resize-vertical" data-tip="Drag to reorder"></i>
          <span
            >y:<input class="templateY" data-tip="Y axis position in percentage (minY-maxY or Y)" value="47-53"
          /></span>
          <span
            >x:<input class="templateX" data-tip="X axis position in percentage (minX-maxX or X)" value="65-75"
          /></span>
          <span
            >h:<input
              class="templateHeight"
              data-tip="Blob maximum height, use hyphen to get a random number in range"
              value="90-100"
          /></span>
          <span
            >n:<input
              class="templateCount"
              data-tip="Blobs to add, use hyphen to get a random number in range"
              value="1"
          /></span>
        </div>
      </div>
      <div id="templateBottom">
        <button id="templateRun" data-tip="Execute the template" class="icon-play-circled2"></button>
        <button id="templateUndo" data-tip="Undo the latest action" class="icon-ccw" disabled></button>
        <button id="templateRedo" data-tip="Redo the action" class="icon-cw" disabled></button>
        <button id="templateSave" data-tip="Download the template as a text file" class="icon-download"></button>
        <button id="templateLoad" data-tip="Open previously downloaded template" class="icon-upload"></button>
        <button
          id="templateCA"
          data-tip="Find or share custom template on Cartography Assets portal"
          class="icon-drafting-compass"
          onclick="
            openURL('https://cartographyassets.com/asset-category/specific-assets/azgaars-generator/templates')
          "
        ></button>
        <button
          id="templateTutorial"
          data-tip="Open Template Editor Tutorial"
          class="icon-info"
          onclick="wiki('Heightmap-template-editor')"
        ></button>
        <label
          data-tip="Enter seed for template to generate the same heightmap each time"
        >
          Seed: <input id="templateSeed" value="" type="number" min="1" max="999999999" step="1" style="width: 8em" />
        </label>
      </div>
    </div>`;
  ensureEl("dialogs").insertAdjacentHTML("beforeend", html);

  const $body = ensureEl("templateBody");

  $("#templateBody").sortable({
    items: "> div",
    handle: ".icon-resize-vertical",
    containment: "#templateBody",
    axis: "y"
  });

  $body.addEventListener("click", (ev: Event) => {
    const el = ev.target as HTMLElement;
    if (el.classList.contains("icon-check")) {
      el.classList.remove("icon-check");
      el.classList.add("icon-check-empty");
      (el.parentElement as HTMLElement).style.opacity = "0.5";
      $body.dataset.changed = "1";
      return;
    }
    if (el.classList.contains("icon-check-empty")) {
      el.classList.add("icon-check");
      el.classList.remove("icon-check-empty");
      (el.parentElement as HTMLElement).style.opacity = "1";
      return;
    }
    if (el.classList.contains("icon-trash-empty")) {
      (el.parentElement as HTMLElement).remove();
    }
  });

  ensureEl("templateEditor").addEventListener("keypress", (event: Event) => {
    if ((event as KeyboardEvent).key === "Enter") {
      event.preventDefault();
      executeTemplate();
    }
  });

  ensureEl("templateTools").addEventListener("click", addStepOnClick);
  ensureEl("templateSelect").addEventListener("change", selectTemplate);
  ensureEl("templateRun").addEventListener("click", executeTemplate);
  ensureEl("templateUndo").addEventListener("click", () => restoreHistory(edits.n - 1));
  ensureEl("templateRedo").addEventListener("click", () => restoreHistory(edits.n + 1));
  ensureEl("templateSave").addEventListener("click", downloadTemplate);
  ensureEl("templateLoad").addEventListener("click", () => ensureEl("templateToLoad").click());

  ensureEl<HTMLInputElement>("templateToLoad").onchange = () => {
    uploadFile(ensureEl<HTMLInputElement>("templateToLoad"), uploadTemplate);
  };
}

function renderImageConverter(): void {
  destroyDialog("imageConverter");
  const editorHtml = /* html */ `<div id="imageConverter" class="dialog stable">
      <div id="convertImageButtons">
        <button id="convertImageLoad" data-tip="Load image to convert" class="icon-upload"></button>
        <button
          id="convertAutoLum"
          data-tip="Auto-assign colors based on liminosity (good for monochrome images)"
          class="icon-adjust"
        ></button>
        <button
          id="convertAutoHue"
          data-tip="Auto-assign colors based on hue (good for colored images)"
          class="icon-paint-roller"
        ></button>
        <button
          id="convertAutoFMG"
          data-tip="Auto-assign colors using generator scheme (for exported colored heightmaps)"
          class="icon-layer-group"
        ></button>
        <button id="convertColorsButton" data-tip="Set maximum number of colors" class="icon-signal"></button>
        <input id="convertColors" value="100" style="display: none" />
        <button
          id="convertCancel"
          data-tip="Cancel the conversion. Previous heightmap will be restored"
          class="icon-cancel"
        ></button>
      </div>
      <div data-tip="Set opacity of the loaded image" style="padding-top: 0.4em">
        <i>Overlay opacity:</i><br />
        <input id="convertOverlay" type="range" min="0" max="1" step=".01" value="0" style="width: 12.6em" />
        <input id="convertOverlayNumber" type="number" min="0" max="1" step=".01" value="0" style="width: 4.2em" />
      </div>
      <div data-tip="Select a color below and assign a height value for it" id="colorsSelect" style="display: none">
        <i>Set height: </i>
        <span id="colorsSelectValue"></span>
        <span>(<span id="colorsSelectFriendly">0</span>)</span><br />
        <div id="imageConverterPalette"></div>
      </div>
      <div data-tip="Select a color to re-assign the height value" id="colorsAssigned" style="display: none">
        <i>Assigned colors (<span id="colorsAssignedNumber"></span>):</i>
        <div id="colorsAssignedContainer" class="colorsContainer"></div>
      </div>
      <div data-tip="Select a color to assign a height value" id="colorsUnassigned" style="display: none">
        <i>Unassigned colors (<span id="colorsUnassignedNumber"></span>):</i>
        <div id="colorsUnassignedContainer" class="colorsContainer"></div>
      </div>
      <button
        id="convertComplete"
        data-tip="Complete the conversion. All unassigned colors will be considered as ocean"
        style="margin: 0.4em 0"
        class="glow"
      >
        Complete the conversion
      </button>
    </div>`;
  ensureEl("dialogs").insertAdjacentHTML("beforeend", editorHtml);

  // add color pallete
  select("#imageConverterPalette")
    .selectAll("div")
    .data(range(101))
    .enter()
    .append("div")
    .attr("data-color", (i: number) => i)
    .style("background-color", (i: number) => color(1 - (i < 20 ? i - 5 : i) / 100))
    .style("width", (i: number) => (i < 40 || i > 68 ? ".2em" : ".1em"))
    .on("touchmove mousemove", showPalleteHeight)
    .on("click", assignHeight);

  ensureEl("convertImageLoad").addEventListener("click", () => ensureEl("imageToLoad").click());
  // imageToLoad is a static file input outside the dialog; use property assignment
  // (idempotent, replaces rather than accumulates) so re-rendering doesn't stack listeners.
  ensureEl<HTMLInputElement>("imageToLoad").onchange = () => loadImage.call(ensureEl<HTMLInputElement>("imageToLoad"));
  ensureEl("convertAutoLum").addEventListener("click", () => autoAssing("lum"));
  ensureEl("convertAutoHue").addEventListener("click", () => autoAssing("hue"));
  ensureEl("convertAutoFMG").addEventListener("click", () => autoAssing("scheme"));
  ensureEl("convertColorsButton").addEventListener("click", setConvertColorsNumber);
  ensureEl("convertComplete").addEventListener("click", applyConversion);
  ensureEl("convertCancel").addEventListener("click", cancelConversion);
  ensureEl<HTMLInputElement>("convertOverlay").addEventListener("input", function (this: HTMLInputElement) {
    setOverlayOpacity(+this.value);
  });
  ensureEl<HTMLInputElement>("convertOverlayNumber").addEventListener("input", function (this: HTMLInputElement) {
    setOverlayOpacity(+this.value);
  });
}

let storedLayers: string[] = [];

function addToolbarListeners(): void {
  ensureEl("paintBrushes").addEventListener("click", openBrushesPanel);
  ensureEl("applyTemplate").addEventListener("click", openTemplateEditor);
  ensureEl("convertImage").addEventListener("click", openImageConverter);
  ensureEl("heightmapPreview").addEventListener("click", toggleHeightmapPreview);
  ensureEl("heightmap3DView").addEventListener("click", changeViewMode);
  ensureEl("finalizeHeightmap").addEventListener("click", finalizeHeightmap);
  ensureEl("renderOcean").addEventListener("click", mockHeightmap);
}

function showModeDialog(tool?: string): void {
  alertMessage.innerHTML = /* html */ `Heightmap is a core element on which all other data (rivers, burgs, states etc) is based. So the best edit approach is to
    <i>erase</i> the secondary data and let the system automatically regenerate it on edit completion.
    <p><i>Erase</i> mode also allows you Convert an Image into a heightmap or use Template Editor.</p>
    <p>You can <i>keep</i> the data, but you won't be able to change the coastline.</p>
    <p>Try <i>risk</i> mode to change the coastline and keep the data. The data will be restored as much as possible, but it can cause unpredictable errors.</p>
    <p>Please <span class="pseudoLink" onclick="window.Services.Save.saveMap('machine')">save the map</span> before editing the heightmap!</p>
    <p style="margin-bottom: 0">Check out ${link("https://github.com/Azgaar/Fantasy-Map-Generator/wiki/Heightmap-customization", "wiki")} for guidance.</p>`;

  $("#alert").dialog({
    resizable: false,
    title: "Edit Heightmap",
    width: "28em",
    buttons: {
      Erase: () => enterHeightmapEditMode("erase", tool),
      Keep: () => enterHeightmapEditMode("keep", tool),
      Risk: () => enterHeightmapEditMode("risk", tool),
      Cancel: function (this: HTMLElement) {
        $(this).dialog("close");
      }
    }
  });
}

function enterHeightmapEditMode(mode: string, tool?: string): void {
  storedLayers = Layers.state.active;
  Layers.set([]); // turn off all layers

  customization = 1;
  closeDialogs();
  tip('Heightmap edit mode is active. Click on "Exit Customization" to finalize the heightmap', true);

  ensureEl("options")
    .querySelectorAll<HTMLElement>(".tabcontent")
    .forEach(tabcontent => {
      tabcontent.style.display = "none";
    });
  ensureEl("options").querySelector(".tab > .active")!.classList.remove("active");
  ensureEl("customizationMenu").style.display = "block";
  ensureEl("toolsTab").classList.add("active");
  ensureEl("heightmapEditMode").innerHTML = mode;

  if (mode === "erase") {
    undraw();
    defaultCellTypeFilter = "all";
  } else if (mode === "keep") {
    Layers.get("landmass").getEl().replaceChildren();
    defaultCellTypeFilter = "land";
  } else if (mode === "risk") {
    select<SVGElement, unknown>("#deftemp").selectAll("#land, #water").selectAll("path").remove();
    select<SVGElement, unknown>("#deftemp").select("#featurePaths").selectAll("path").remove();
    select<SVGElement, unknown>("#viewbox").selectAll("#coastline use, #lakes path, #oceanLayers path").remove();
    defaultCellTypeFilter = "all";
  }
  const cellTypeFilterEl = findEl<HTMLSelectElement>("cellTypeFilter");
  if (cellTypeFilterEl) cellTypeFilterEl.value = defaultCellTypeFilter;

  // show convert and template buttons for Erase mode only
  ensureEl("applyTemplate").style.display = mode === "erase" ? "inline-block" : "none";
  ensureEl("convertImage").style.display = mode === "erase" ? "inline-block" : "none";

  // hide erosion checkbox if mode is Keep
  ensureEl("allowErosionBox").style.display = mode === "keep" ? "none" : "inline-block";

  // show finalize button
  const exitCustomization = ensureEl("exitCustomization");
  if (!sessionStorage.getItem("noExitButtonAnimation")) {
    sessionStorage.setItem("noExitButtonAnimation", "true");
    exitCustomization.style.opacity = "0";
    const width = 12 * +ensureEl<HTMLInputElement>("uiSize").value * 11;
    exitCustomization.style.right = `${(svgWidth - width) / 2}px`;
    exitCustomization.style.bottom = `${svgHeight / 2}px`;
    exitCustomization.style.transform = "scale(2)";
    exitCustomization.style.display = "block";
    select("#exitCustomization")
      .transition()
      .duration(1000)
      .style("opacity", 1)
      .transition()
      .duration(2000)
      .ease(easeSinInOut)
      .style("right", "10px")
      .style("bottom", "10px")
      .style("transform", "scale(1)");
  } else exitCustomization.style.display = "block";

  const layersPreset = ensureEl<HTMLSelectElement>("layersPreset");
  layersPreset.value = "heightmap";
  layersPreset.disabled = true;
  mockHeightmap();

  select<SVGElement, unknown>("#viewbox").on("touchmove mousemove", moveCursor);
  select<SVGSVGElement, unknown>("#map").on("dblclick.zoom", null);

  if (tool === "templateEditor") openTemplateEditor();
  else if (tool === "imageConverter") openImageConverter();
  else openBrushesPanel();
}

function moveCursor(this: SVGElement, event: any): void {
  const [x, y] = getPointer(event, this);
  const cell = findGridCell(x, y, grid);
  ensureEl("heightmapInfoX").innerHTML = String(rn(x));
  ensureEl("heightmapInfoY").innerHTML = String(rn(y));
  ensureEl("heightmapInfoCell").innerHTML = String(cell);
  ensureEl("heightmapInfoHeight").innerHTML = `${grid.cells.h[cell]} (${getFriendlyHeight(grid.cells.h[cell])})`;
  if (ensureEl("tooltip").dataset.main) showMainTip();

  // move radius circle if drag mode is active (brushes panel may not be the open tool)
  const pressed = findEl("brushesButtons")?.querySelector<HTMLElement>("button.pressed");
  if (!pressed) return;

  if (pressed.id === "brushLine") {
    select("#debug").select("line").attr("x2", x).attr("y2", y);
    return;
  }

  if (pressed.id === "brushFill") {
    removeCircle();
    return;
  }

  moveCircle(x, y, ensureEl<HTMLInputElement>("heightmapBrushRadius").valueAsNumber);
}

// get user-friendly (real-world) height value from map data
function getFriendlyHeight(h: number): string {
  const unit = heightUnit.value;
  let unitRatio = 3.281; // default calculations are in feet
  if (unit === "m") unitRatio = 1;
  // if meter
  else if (unit === "f") unitRatio = 0.5468; // if fathom

  let height = -990;
  if (h >= 20) height = (h - 18) ** +heightExponentInput.value;
  else if (h < 20 && h > 0) height = ((h - 20) / h) * 50;

  return `${rn(height * unitRatio)} ${unit}`;
}

// Exit customization mode
function finalizeHeightmap(): void {
  if (select<SVGElement, unknown>("#viewbox").select("#heights").selectAll("*").size() < 200) {
    tip("Insufficient land area. There should be at least 200 land cells!", false, "error");
    return;
  }
  if (findEl("imageConverter")) {
    tip("Please exit the Image Conversion mode first", false, "error");
    return;
  }

  window.edits = undefined; // remove global variable
  setHistoryButtonsDisabled(true, true);

  customization = 0;
  ensureEl("customizationMenu").style.display = "none";
  if (ensureEl("options").querySelector<HTMLElement>(".tab > button.active")!.id === "toolsTab")
    ensureEl("toolsContent").style.display = "block";
  ensureEl<HTMLSelectElement>("layersPreset").disabled = false;
  ensureEl("exitCustomization").style.display = "none"; // hide finalize button

  applyDefaultViewboxEvents();
  clearMainTip();
  closeDialogs();
  resetZoom();

  document.getElementById("preview")?.remove();
  if (document.getElementById("canvas3d")) void Controllers.View3d.enterStandard();

  const mode = ensureEl("heightmapEditMode").innerHTML;
  if (mode === "erase") regenerateErasedData();
  else if (mode === "keep") restoreKeptData();
  else if (mode === "risk") restoreRiskedData();

  // restore initial layers; the landmass, coastline and lakes all follow the edited heightmap
  Layers.draw("landmass", "coastline", "lakes");
  select<SVGElement, unknown>("#viewbox").selectAll("#heights").remove();

  Layers.set(storedLayers);
}

function regenerateErasedData(): void {
  INFO && console.group("Edit Heightmap");
  TIME && console.time("regenerateErasedData");

  // remove data
  pack.cultures = [];
  pack.burgs = [];
  pack.states = [];
  pack.provinces = [];
  pack.religions = [];

  const erosionAllowed = ensureEl<HTMLInputElement>("allowErosion").checked;
  Features.markupGrid();
  if (erosionAllowed) {
    addLakesInDeepDepressions();
    openNearSeaLakes();
  }
  Layers.draw("ocean");
  generateAeroHydro();
  calculateTemperatures();
  generatePrecipitation();
  reGraph();
  Features.markupPack();

  Rivers.generate(erosionAllowed);

  if (!erosionAllowed) {
    for (const i of pack.cells.i) {
      const g = pack.cells.g[i];
      if (pack.cells.h[i] !== grid.cells.h[g] && pack.cells.h[i] >= 20 === grid.cells.h[g] >= 20)
        pack.cells.h[i] = grid.cells.h[g];
    }
  }

  Biomes.define();
  Features.defineGroups();

  Goods.generate();

  rankCells();
  Cultures.generate();
  Cultures.expand();

  Burgs.generate();
  States.generate();
  Routes.generate();
  Religions.generate();

  Burgs.specify();
  States.collectStatistics();
  States.defineStateForms();

  Provinces.generate();
  Provinces.getPoles();

  Rivers.specify();
  Lakes.defineNames();

  Markets.generate();
  Production.produce();
  States.collectTaxes();

  Ice.generate();

  Military.generate();
  Markers.generate();
  Zones.generate();
  TIME && console.timeEnd("regenerateErasedData");
  INFO && console.groupEnd();
}

function restoreKeptData(): void {
  for (const i of pack.cells.i) {
    pack.cells.h[i] = grid.cells.h[pack.cells.g[i]];
  }
}

/**
 * Creates a finder that assigns each request the nearest currently available land cell.
 * Assigned cells are removed from the spatial index, so a later request cannot overwrite
 * the reverse burg reference of an earlier request.
 */
export const createAvailableLandCellFinder = (cells: {
  h: ArrayLike<number>;
  p: readonly (readonly [number, number])[];
}) => {
  const landPoints: [number, number, number][] = [];
  for (let i = 0; i < cells.p.length; i++) {
    if (cells.h[i] >= 20) landPoints.push([cells.p[i][0], cells.p[i][1], i]);
  }

  const availableLand = quadtree<[number, number, number]>(landPoints);
  return (x: number, y: number): number | undefined => {
    const point = availableLand.find(x, y);
    if (!point) return;

    availableLand.remove(point);
    return point[2];
  };
};

function restoreRiskedData(): void {
  INFO && console.group("Edit Heightmap");
  TIME && console.time("restoreRiskedData");
  const erosionAllowed = ensureEl<HTMLInputElement>("allowErosion").checked;

  // assign pack data to grid cells
  const l = grid.cells.i.length;
  const biome = new Uint8Array(l);
  const pop = new Uint16Array(l);
  const routes: Record<number, any> = {};
  const s = new Uint16Array(l);
  const burg = new Uint16Array(l);
  const state = new Uint16Array(l);
  const province = new Uint16Array(l);
  const culture = new Uint16Array(l);
  const religion = new Uint16Array(l);
  const good = new Uint16Array(l);

  // rivers data, stored only if allowErosion is unchecked
  const fl = new Uint16Array(l);
  const r = new Uint16Array(l);
  const conf = new Uint8Array(l);

  for (const i of pack.cells.i) {
    const g = pack.cells.g[i];
    biome[g] = pack.cells.biome[i];
    culture[g] = pack.cells.culture[i];
    pop[g] = pack.cells.pop[i];
    routes[g] = pack.cells.routes[i];
    s[g] = pack.cells.s[i];
    state[g] = pack.cells.state[i];
    province[g] = pack.cells.province[i];
    burg[g] = pack.cells.burg[i];
    religion[g] = pack.cells.religion[i];
    good[g] = pack.cells.good?.[i] || 0;

    if (!erosionAllowed) {
      fl[g] = pack.cells.fl[i];
      r[g] = pack.cells.r[i];
      conf[g] = pack.cells.conf[i];
    }
  }

  // do not allow to remove land with burgs
  for (const i of grid.cells.i) {
    if (!burg[i]) continue;
    if (grid.cells.h[i] < 20) grid.cells.h[i] = 20;
  }

  // save culture centers x and y to restore center cell id after re-graph
  for (const c of pack.cultures) {
    if (!c.i || c.removed) continue;
    const p = pack.cells.p[c.center!];
    c.x = p[0];
    c.y = p[1];
  }

  // save zone grid cells to restore them later
  const zoneGridCellsMap = new Map<number, number[]>();
  for (const zone of pack.zones) {
    if (!zone.cells?.length) continue;
    const zoneGridCells = zone.cells.map(i => pack.cells.g[i]);
    zoneGridCellsMap.set(zone.i, unique(zoneGridCells));
  }

  Features.markupGrid();
  if (erosionAllowed) addLakesInDeepDepressions();
  Layers.draw("ocean");
  generateAeroHydro();
  calculateTemperatures();
  generatePrecipitation();
  reGraph();
  Features.markupPack();

  if (erosionAllowed) {
    Rivers.generate(true);
    Features.defineGroups();
  }

  // assign saved pack data from grid back to pack
  const n = pack.cells.i.length;
  pack.cells.pop = new Float32Array(n);
  pack.cells.routes = {};
  pack.cells.s = new Uint16Array(n);
  pack.cells.burg = new Uint16Array(n);
  pack.cells.state = new Uint16Array(n);
  pack.cells.province = new Uint16Array(n);
  pack.cells.culture = new Uint16Array(n);
  pack.cells.religion = new Uint16Array(n);
  pack.cells.biome = new Uint8Array(n);
  pack.cells.good = new Uint16Array(n);

  if (!erosionAllowed) {
    pack.cells.r = new Uint16Array(n);
    pack.cells.conf = new Uint8Array(n);
    pack.cells.fl = new Uint16Array(n);
  }

  for (const i of pack.cells.i) {
    const g = pack.cells.g[i];
    const isLandCell = pack.cells.h[i] >= 20;

    // rivers data
    if (!erosionAllowed) {
      pack.cells.r[i] = r[g];
      pack.cells.conf[i] = conf[g];
      pack.cells.fl[i] = fl[g];
    }

    // check biome
    pack.cells.biome[i] =
      isLandCell && biome[g]
        ? biome[g]
        : Biomes.getId(grid.cells.prec[g], grid.cells.temp[g], pack.cells.h[i], Boolean(pack.cells.r[i]));

    pack.cells.good[i] = good[g]; // goods can sit on water cells (e.g. fish), so restore before the land check

    if (!isLandCell) continue;
    pack.cells.culture[i] = culture[g];
    pack.cells.pop[i] = pop[g];
    pack.cells.routes[i] = routes[g];
    pack.cells.s[i] = s[g];
    pack.cells.state[i] = state[g];
    pack.cells.province[i] = province[g];
    pack.cells.religion[i] = religion[g];
  }

  // find closest available land cell to burg
  const findBurgCell = createAvailableLandCellFinder(pack.cells);

  // find best cell for burgs
  for (const b of pack.burgs) {
    if (!b.i || b.removed) continue;
    const cell = findBurgCell(b.x, b.y);
    if (cell === undefined) {
      ERROR &&
        console.error(
          `[Data integrity] Burg ${b.i} has no available land cell after Risk restoration. Removing the burg`
        );
      Burgs.remove(b.i);
      continue;
    }

    b.cell = cell;
    b.feature = pack.cells.f[b.cell];

    pack.cells.burg[b.cell] = b.i;
    if (!b.capital && pack.cells.h[b.cell] < 20) Burgs.remove(b.i);
    if (b.capital) pack.states[b.state!].center = b.cell;
  }

  for (const p of pack.provinces) {
    if (!p.i || p.removed) continue;
    const provCells = pack.cells.i.filter(i => pack.cells.province[i] === p.i);
    if (!provCells.length) {
      const state = p.state;
      const stateProvs = pack.states[state].provinces!;
      if (stateProvs.includes(p.i)) pack.states[state].provinces!.splice(stateProvs.indexOf(p.i), 1);

      p.removed = true;
      continue;
    }

    if (p.burg && !pack.burgs[p.burg].removed) p.center = pack.burgs[p.burg].cell;
    else {
      p.center = provCells[0];
      p.burg = pack.cells.burg[p.center];
    }
  }

  for (const c of pack.cultures) {
    if (!c.i || c.removed) continue;
    c.center = findCell(c.x!, c.y!)!;
  }

  States.getPoles();
  States.findNeighbors();
  States.collectStatistics();

  if (erosionAllowed) {
    Rivers.specify();
    Lakes.defineNames();
  }

  const gridToPackMap = new Map<number, number[]>();
  for (const i of pack.cells.i) {
    const g = pack.cells.g[i];
    if (!gridToPackMap.has(g)) gridToPackMap.set(g, []);
    gridToPackMap.get(g)!.push(i);
  }

  // restore zone cells
  for (const zone of pack.zones) {
    const gridCells = zoneGridCellsMap.get(zone.i);
    if (gridCells?.length) {
      const packCells = gridCells.flatMap(g => gridToPackMap.get(g) || []);
      zone.cells = unique(packCells);
    } else {
      zone.cells = [];
    }
  }

  // restore economy: keep the existing goods and markets, then recompute
  if (pack.goods?.length) {
    pack.markets = (pack.markets || []).filter(market => {
      const centerBurg = pack.burgs[market.centerBurgId];
      return Boolean(centerBurg && !centerBurg.removed);
    });
    Production.regenerateEconomy();
    Layers.draw("markets", "goods");
    Layers.draw("trade");
    refreshEditors();
  } else {
    Goods.generate();
    Markets.generate();
    Production.produce();
    States.collectTaxes();
  }

  // recalculate ice
  Ice.generate();
  select("#ice").selectAll("*").remove();

  TIME && console.timeEnd("restoreRiskedData");
  INFO && console.groupEnd();
}

// trigger heightmap redraw and history update if at least 1 cell is changed
function updateHeightmap(): void {
  const prev = last(edits) as number[];
  const changed = grid.cells.h.reduce((s: number, h: number, i: number) => (h !== prev[i] ? s + 1 : s), 0);
  tip(`Cells changed: ${changed}`);
  if (!changed) return;

  const cellTypeFilter = findEl<HTMLSelectElement>("cellTypeFilter")?.value ?? defaultCellTypeFilter;
  // check ocean cells are not changed if only land edit is allowed
  if (cellTypeFilter === "land") {
    for (const i of grid.cells.i) {
      if (prev[i] < 20 || grid.cells.h[i] < 20) grid.cells.h[i] = prev[i];
    }
  }

  // check land cells are not changed if only water edit is allowed
  if (cellTypeFilter === "water") {
    for (const i of grid.cells.i) {
      if (prev[i] >= 20 || grid.cells.h[i] >= 20) grid.cells.h[i] = prev[i];
    }
  }

  mockHeightmap();
  updateHistory();
}

function getColor(value: number, scheme = getColorScheme("bright")): string {
  return scheme(1 - (value < 20 ? value - 5 : value) / 100);
}

// draw or update heightmap
function mockHeightmap(): void {
  const data: number[] = ensureEl<HTMLInputElement>("renderOcean").checked
    ? grid.cells.i
    : grid.cells.i.filter((i: number) => grid.cells.h[i] >= 20);

  select<SVGElement, unknown>("#viewbox")
    .select("#heights")
    .selectAll<SVGPolygonElement, number>("polygon")
    .data<number>(data)
    .join("polygon")
    .attr("points", (d: number) => getGridPolygon(d, grid))
    .attr("id", (d: number) => `cell${d}`)
    .attr("fill", (d: number) => getColor(grid.cells.h[d]));
}

// draw or update heightmap for a selection of cells
function mockHeightmapSelection(selection: number[]): void {
  const ocean = ensureEl<HTMLInputElement>("renderOcean").checked;

  selection.forEach(i => {
    let cell: any = select<SVGElement, unknown>("#viewbox").select("#heights").select(`#cell${i}`);
    if (!ocean && grid.cells.h[i] < 20) {
      cell.remove();
      return;
    }

    if (!cell.size())
      cell = select<SVGElement, unknown>("#viewbox")
        .select("#heights")
        .append("polygon")
        .attr("points", getGridPolygon(i, grid))
        .attr("id", `cell${i}`);
    cell.attr("fill", getColor(grid.cells.h[i]));
  });
}

function updateStatistics(): void {
  const landCells = grid.cells.h.reduce((s: number, h: number) => (h >= 20 ? s + 1 : s), 0);
  ensureEl("landmassCounter").innerText = `${landCells} (${rn((landCells / grid.cells.i.length) * 100)}%)`;
  ensureEl("landmassAverage").innerText = String(rn(mean(grid.cells.h) ?? 0));
}

// the brushes panel's and template editor's undo/redo buttons only exist once rendered,
// which happens after a heightmap edit mode is chosen — so they must be looked up defensively
function setHistoryButtonsDisabled(undo: boolean, redo: boolean): void {
  const setPair = (undoId: string, redoId: string) => {
    const undoEl = findEl<HTMLButtonElement>(undoId);
    if (undoEl) undoEl.disabled = undo;
    const redoEl = findEl<HTMLButtonElement>(redoId);
    if (redoEl) redoEl.disabled = redo;
  };
  setPair("undo", "redo");
  setPair("templateUndo", "templateRedo");
}

function updateHistory(noStat?: string): void {
  const step = edits.n;
  edits = edits.slice(0, step);
  edits[step] = grid.cells.h.slice();
  edits.n = step + 1;

  setHistoryButtonsDisabled(edits.n <= 1, true);
  if (!noStat) {
    updateStatistics();
    if (document.getElementById("preview")) drawHeightmapPreview();
    if (document.getElementById("canvas3d")) Controllers.View3d.redraw();
  }
}

// restoreHistory
function restoreHistory(step: number): void {
  edits.n = step;
  setHistoryButtonsDisabled(edits.n <= 1, edits.n >= edits.length);
  if (edits[edits.n - 1] === undefined) return;
  grid.cells.h = edits[edits.n - 1].slice();
  mockHeightmap();
  updateStatistics();

  if (document.getElementById("preview")) drawHeightmapPreview();
  if (document.getElementById("canvas3d")) Controllers.View3d.redraw();
}

// restart edits from 1st step
function restartHistory(): void {
  window.edits = []; // declare temp global variable
  edits.n = 0;
  setHistoryButtonsDisabled(true, true);
  updateHistory();
}

function openBrushesPanel(): void {
  if (document.getElementById("brushesPanel")) return;
  renderBrushesPanel();

  $("#brushesPanel").dialog({
    title: "Paint Brushes",
    resizable: false,
    position: { my: "right top", at: "right-10 top+10", of: "svg" },
    close: closeBrushesPanel
  });
}

function renderBrushesPanel(): void {
  destroyDialog("brushesPanel");

  const html = /* html */ `<div id="brushesPanel" class="dialog stable">
    <div id="brushesButtons" style="display: inline-block">
      <button id="brushRaise" data-tip="Raise brush: increase height of cells in radius by Power value">
        <svg viewBox="15 15 70 70" height="1em" width="1.6em">
          <path d="m20,39 h60 M50,85 v-35 l-12,8 m12,-8 l12,8" fill="none" stroke="#000" stroke-width="5" />
        </svg>
      </button>
      <button id="brushElevate" data-tip="Elevate brush: drag to gradually increase height of cells in radius by Power value">
        <svg viewBox="15 15 70 70" height="1em" width="1.6em">
          <path d="m20,50 q30,-35 60,0 M50,85 v-35 l-12,8 m12,-8 l12,8" fill="none" stroke="#000" stroke-width="5" />
        </svg>
      </button>
      <button id="brushLower" data-tip="Lower brush: drag to decrease height of cells in radius by Power value">
        <svg viewBox="15 15 70 70" height="1em" width="1.6em">
          <path d="M50,30 v35 l-12,-8 m12,8 l12,-8 M20,78 h60" fill="none" stroke="#000" stroke-width="5" />
        </svg>
      </button>
      <button id="brushDepress" data-tip="Depress brush: drag to gradually decrease height of cells in radius by Power value">
        <svg viewBox="15 15 70 70" height="1em" width="1.6em">
          <path d="M50,30 v35 l-12,-8 m12,8 l12,-8 M20,63 q30,35 60,0" fill="none" stroke="#000" stroke-width="5" />
        </svg>
      </button>
      <button id="brushAlign" data-tip="Align brush: drag to set height of cells in radius to height of the cell at mousepoint">
        <svg viewBox="15 15 70 70" height="1em" width="1.6em">
          <path d="m20,50 h56 m0,20 h-56" fill="none" stroke="#000" stroke-width="5" />
        </svg>
      </button>
      <button id="brushSmooth" data-tip="Smooth brush: drag to level height of cells in radius to height of adjacent cells">
        <svg viewBox="15 15 70 70" height="1em" width="1.6em">
          <path d="m15,60 q15,-15 30,0 q15,15 35,0" fill="none" stroke="#000" stroke-width="5" />
        </svg>
      </button>
      <button id="brushDisrupt" data-tip="Disrupt brush: drag to randomize height of cells in radius based on Power value">
        <svg viewBox="15 15 70 70" height="1em" width="1.6em">
          <path d="m15,63 l15,-13 15,20 15,-20 15,19 15,-14" fill="none" stroke="#000" stroke-width="5" />
        </svg>
      </button>
      <button id="brushFill" data-tip="Fill: click enclosed water or same-height land area to create a cone blob">
        <svg viewBox="20 10 60 60" height="1em" width="1.6em">
          <path d="M30,70 h40 M30,70 q0,-20 20,-20 q20,0 20,20" fill="none" stroke="#000" stroke-width="5" />
          <path d="M50,20 v25 M50,20 l-10,8 M50,20 l10,8" fill="none" stroke="#000" stroke-width="5" />
        </svg>
      </button>
      <button id="brushLine" data-tip="Line: select two points to change heights along the line">
        <svg viewBox="0 -5 100 100" height="1em" width="1.6em">
          <path d="M0 90 L100 10" fill="none" stroke="#000" stroke-width="7"></path>
        </svg>
      </button>
    </div>
    <div id="brushesSliders" style="display: none">
      <div data-tip="Change brush size. Shortcut: + to increase; – to decrease">
        <slider-input id="heightmapBrushRadius" min="1" max="100" value="25">
          <div style="width: 3.5em">Radius:</div>
        </slider-input>
      </div>
      <div data-tip="Change brush power">
        <slider-input id="heightmapBrushPower" min="1" max="10" value="5">
          <div style="width: 3.5em">Power:</div>
        </slider-input>
      </div>
    </div>
    <div id="lineSlider" style="display: none">
      <div data-tip="Change tool power. Shortcut: + to increase; – to decrease">
        <slider-input id="heightmapLinePower" min="-100" max="100" value="30">
          <div style="width: 5.5em">Power:</div>
        </slider-input>
      </div>
      <div data-tip="Change line randomness. Zero makes the line as straight as possible">
        <slider-input id="heightmapLineRandomness" min="0" max="100" value="30">
          <div style="width: 5.5em">Randomness:</div>
        </slider-input>
      </div>
    </div>
    <div data-tip="Restrict brush to specific cell types" style="margin-bottom: 0.6em">
      <label for="cellTypeFilter"><i>Cells to change:</i></label>
      <select id="cellTypeFilter">
        <option value="all" ${defaultCellTypeFilter === "all" ? "selected" : ""}>all cells</option>
        <option value="land" ${defaultCellTypeFilter === "land" ? "selected" : ""}>only land cells</option>
        <option value="water" ${defaultCellTypeFilter === "water" ? "selected" : ""}>only water cells</option>
      </select>
    </div>
    <div id="modifyButtons">
      <button id="undo" data-tip="Undo the latest action (Ctrl + Z)" class="icon-ccw" disabled></button>
      <button id="redo" data-tip="Redo the action (Ctrl + Y)" class="icon-cw" disabled></button>
      <button id="rescaleShow" data-tip="Show rescaler slider" class="icon-exchange"></button>
      <button id="rescaleCondShow" data-tip="Rescaler: change height if condition is fulfilled" class="icon-if"></button>
      <button id="smoothHeights" data-tip="Smooth all heights a bit" class="icon-smooth"></button>
      <button id="disruptHeights" data-tip="Disrupt (randomize) heights a bit" class="icon-disrupt"></button>
      <button id="brushClear" data-tip="Set height for all cells to 0 (erase the map)" class="icon-eraser"></button>
    </div>
    <div id="rescaleSection" style="display: none">
      <button id="rescaleHide" data-tip="Hide rescaler slider" class="icon-exchange"></button>
      <input id="rescaler" data-tip="Change height for all cells" type="range" min="-10" max="10" step="1" value="0" />
    </div>
    <div
      id="rescaleCondSection"
      data-tip="If height is greater or equal to X and less or equal to Y, then perform an operation Z with operand V"
      style="display: none"
    >
      <button id="rescaleCondHide" data-tip="Hide rescaler" class="icon-if"></button>
      <label>h ≥</label>
      <input id="rescaleLower" value="20" type="number" min="0" max="100" />
      <label>≤</label>
      <input id="rescaleHigher" value="100" type="number" min="1" max="100" />
      <label>⇒</label>
      <select id="conditionSign">
        <option value="multiply" selected>×</option>
        <option value="divide">÷</option>
        <option value="add">+</option>
        <option value="subtract">-</option>
        <option value="exponent">^</option>
      </select>
      <input id="rescaleModifier" type="number" value="0.9" min="0" max="1.5" step="0.01" />
      <button id="rescaleExecute" data-tip="Click to perform an operation" class="icon-play-circled2"></button>
    </div>
  </div>`;
  ensureEl("dialogs").insertAdjacentHTML("beforeend", html);
  addBrushesListeners();
}

function closeBrushesPanel(): void {
  exitBrushMode();
  destroyDialog("brushesPanel");
}

function addBrushesListeners(): void {
  ensureEl("brushesButtons").addEventListener("click", toggleBrushMode);
  ensureEl("cellTypeFilter").addEventListener("change", cellTypeFilterChange);
  ensureEl("undo").addEventListener("click", () => restoreHistory(edits.n - 1));
  ensureEl("redo").addEventListener("click", () => restoreHistory(edits.n + 1));
  ensureEl("rescaleShow").addEventListener("click", () => {
    ensureEl("modifyButtons").style.display = "none";
    ensureEl("rescaleSection").style.display = "block";
  });
  ensureEl("rescaleHide").addEventListener("click", () => {
    ensureEl("modifyButtons").style.display = "block";
    ensureEl("rescaleSection").style.display = "none";
  });
  ensureEl("rescaler").addEventListener("change", (e: Event) => rescale((e.target as HTMLInputElement).valueAsNumber));
  ensureEl("rescaleCondShow").addEventListener("click", () => {
    ensureEl("modifyButtons").style.display = "none";
    ensureEl("rescaleCondSection").style.display = "block";
  });
  ensureEl("rescaleCondHide").addEventListener("click", () => {
    ensureEl("modifyButtons").style.display = "block";
    ensureEl("rescaleCondSection").style.display = "none";
  });
  ensureEl("rescaleExecute").addEventListener("click", rescaleWithCondition);
  ensureEl("smoothHeights").addEventListener("click", smoothAllHeights);
  ensureEl("disruptHeights").addEventListener("click", disruptAllHeights);
  ensureEl("brushClear").addEventListener("click", startFromScratch);
}

function exitBrushMode(): void {
  const pressed = document.querySelector("#brushesButtons > button.pressed");
  if (pressed) pressed.classList.remove("pressed");

  applyDefaultViewboxEvents();
  select<SVGSVGElement, unknown>("#map").on("dblclick.zoom", null);
  select<SVGElement, unknown>("#viewbox").on("touchmove mousemove", moveCursor);
  select("#debug").selectAll(".lineCircle").remove();
  removeCircle();

  ensureEl("brushesSliders").style.display = "none";
  ensureEl("lineSlider").style.display = "none";
}

function toggleBrushMode(event: Event): void {
  const button = (event.target as HTMLElement).closest<HTMLElement>("#brushesButtons > button");
  if (!button) return;

  if (button.classList.contains("pressed")) {
    exitBrushMode();
    return;
  }

  exitBrushMode();
  button.classList.add("pressed");
  const radiusRow = ensureEl("heightmapBrushRadius").parentElement;
  if (radiusRow) radiusRow.style.display = button.id === "brushFill" ? "none" : "";

  if (button.id === "brushLine") {
    ensureEl("lineSlider").style.display = "block";
    select<SVGElement, unknown>("#viewbox").style("cursor", "crosshair").on("click", placeLinearFeature);
  } else if (button.id === "brushFill") {
    ensureEl("brushesSliders").style.display = "block";
    select<SVGElement, unknown>("#viewbox").style("cursor", "crosshair").on("click", applyFillBrush);
  } else {
    ensureEl("brushesSliders").style.display = "block";
    select<SVGElement, unknown>("#viewbox")
      .style("cursor", "crosshair")
      .call(drag<SVGElement, unknown>().on("start", dragBrush));
  }
}

function placeLinearFeature(this: SVGElement, event: any): void {
  const [x, y] = getPointer(event, this);
  const toCell = findGridCell(x, y, grid);

  const lineCircle = select("#debug").selectAll(".lineCircle");
  if (!lineCircle.size()) {
    // first click: add 1st control point
    select("#debug").append("line").attr("id", "brushCircle").attr("x1", x).attr("y1", y).attr("x2", x).attr("y2", y);

    select("#debug")
      .append("circle")
      .attr("data-cell", toCell)
      .attr("class", "lineCircle")
      .attr("r", 6)
      .attr("cx", x)
      .attr("cy", y)
      .attr("fill", "yellow")
      .attr("stroke", "#333")
      .attr("stroke-width", 2);
    return;
  }

  // second click: execute operation and remove control points
  const fromCell = +lineCircle.attr("data-cell");
  select("#debug").selectAll("*").remove();

  const power = ensureEl<HTMLInputElement>("heightmapLinePower").valueAsNumber;
  if (power === 0) {
    tip("Power should not be zero", false, "error");
    return;
  }

  // map slider 0-100 to halving probability 0-0.5: past 0.5 the ordering stabilizes again, so 0.5 is max meander
  const randomness = ensureEl<HTMLInputElement>("heightmapLineRandomness").valueAsNumber / 200;

  const heights = grid.cells.h;
  const operation =
    power > 0
      ? HeightmapGenerator.addRange.bind(HeightmapGenerator)
      : HeightmapGenerator.addTrough.bind(HeightmapGenerator);
  HeightmapGenerator.setGraph(grid);
  operation("1", String(Math.abs(power)), "", "", fromCell, toCell, randomness);
  const changedHeights = HeightmapGenerator.getHeights()!;

  const cellTypeFilter = ensureEl<HTMLSelectElement>("cellTypeFilter").value;
  const selection: number[] = [];
  for (let i = 0; i < heights.length; i++) {
    if (changedHeights[i] === heights[i]) continue;
    if (cellTypeFilter === "land" && heights[i] < 20) continue;
    if (cellTypeFilter === "water" && heights[i] >= 20) continue;
    heights[i] = changedHeights[i];
    selection.push(i);
  }

  mockHeightmapSelection(selection);
  updateHistory();
}

function applyFillBrush(this: SVGElement, event: any): void {
  const [x, y] = getPointer(event, this);
  const start = findGridCell(x, y, grid);
  const startHeight = grid.cells.h[start];
  const isWaterFill = startHeight < 20;
  const MIN_FILL_CELLS = 3;

  const cellTypeFilter = ensureEl<HTMLSelectElement>("cellTypeFilter").value;
  if (cellTypeFilter === "water") {
    tip("Fill brush is not available with 'only water cells' filter", false, "error");
    return;
  }
  if (cellTypeFilter === "land" && isWaterFill) {
    tip("Land filter is active, water areas cannot be filled", false, "error");
    return;
  }

  const { selection, reachedBorder } = collectFillSelection(start, isWaterFill, startHeight);
  if (selection.length < MIN_FILL_CELLS) {
    tip("No enclosed area found to fill", false, "error");
    return;
  }
  if (isWaterFill && reachedBorder) {
    tip("Selected water area is open to map border and is not enclosed", false, "error");
    return;
  }

  const changed = applyConeToSelection(selection, isWaterFill, startHeight);
  if (!changed.length) return;

  mockHeightmapSelection(changed);
  updateHeightmap();
}

function collectFillSelection(
  start: number,
  isWaterFill: boolean,
  targetHeight: number
): { selection: number[]; reachedBorder: boolean } {
  const { h: heights, c: neighbors, i: cells } = grid.cells;
  const visited = new Uint8Array(cells.length);
  const stack = [start];
  const selection: number[] = [];
  let reachedBorder = false;

  while (stack.length) {
    const cell = stack.pop()!;
    if (visited[cell]) continue;
    visited[cell] = 1;

    const matches = isWaterFill ? heights[cell] < 20 : heights[cell] === targetHeight;
    if (!matches) continue;

    selection.push(cell);
    if (grid.cells.b[cell]) reachedBorder = true;
    neighbors[cell].forEach((next: number) => {
      if (!visited[next]) stack.push(next);
    });
  }

  return { selection, reachedBorder };
}

function applyConeToSelection(selection: number[], isWaterFill: boolean, targetHeight: number): number[] {
  const power = ensureEl<HTMLInputElement>("heightmapBrushPower").valueAsNumber * 10;
  const { h: heights, c: neighbors, i: cells } = grid.cells;
  const inSelection = new Uint8Array(cells.length);
  const edgeDistance = new Uint16Array(cells.length);
  const changed: number[] = [];

  selection.forEach(cell => {
    inSelection[cell] = 1;
  });

  // Multi-source BFS from area edge gives each cell distance from edge.
  const queue: number[] = [];
  let head = 0;
  selection.forEach(cell => {
    const isEdgeCell = neighbors[cell].some((next: number) => !inSelection[next]);
    if (!isEdgeCell) return;
    inSelection[cell] = 2;
    queue.push(cell);
  });

  while (head < queue.length) {
    const cell = queue[head++];
    const nextDistance = edgeDistance[cell] + 1;
    neighbors[cell].forEach((next: number) => {
      if (inSelection[next] !== 1) return;
      inSelection[next] = 2;
      edgeDistance[next] = nextDistance;
      queue.push(next);
    });
  }

  const maxDistance = max(selection, cell => edgeDistance[cell]) || 0;
  const baseHeight = isWaterFill ? 20 : targetHeight;

  selection.forEach(cell => {
    const ratio = maxDistance ? edgeDistance[cell] / maxDistance : 1;
    const rise = Math.max(1, Math.round(power * ratio));
    const nextHeight = minmax(baseHeight + rise, 0, 100);
    if (nextHeight === heights[cell]) return;

    heights[cell] = nextHeight;
    changed.push(cell);
  });

  return changed;
}

function dragBrush(this: SVGElement, event: any): void {
  const r = ensureEl<HTMLInputElement>("heightmapBrushRadius").valueAsNumber;
  const [startX, startY] = getPointer(event, this);
  const start = findGridCell(startX, startY, grid); // fixed once per drag: Align replicates this cell's height

  const applyBrush = (pointerEvent: any) => {
    const p = getPointer(pointerEvent, this);
    moveCircle(p[0], p[1], r);

    const inRadius = findGridAll(p[0], p[1], r, grid);
    let selection = inRadius;
    const cellTypeFilter = ensureEl<HTMLSelectElement>("cellTypeFilter").value;
    if (cellTypeFilter === "land") selection = inRadius.filter((i: number) => grid.cells.h[i] >= 20);
    else if (cellTypeFilter === "water") selection = inRadius.filter((i: number) => grid.cells.h[i] < 20);
    if (selection?.length) changeHeightForSelection(selection, start);
  };

  applyBrush(event); // apply once on start so a plain click changes height
  event.on("drag", applyBrush);
  event.on("end", updateHeightmap);
}

function changeHeightForSelection(selection: number[], start: number): void {
  const power = ensureEl<HTMLInputElement>("heightmapBrushPower").valueAsNumber;

  const interpolate = interpolateRound(power, 1);
  const land = ensureEl<HTMLSelectElement>("cellTypeFilter").value === "land";
  const ocean = ensureEl<HTMLSelectElement>("cellTypeFilter").value === "water";
  const limit = (v: number): number => minmax(v, land ? 20 : 0, ocean ? 19 : 100);
  const heights = grid.cells.h;

  const brush = document.querySelector<HTMLElement>("#brushesButtons > button.pressed")!.id;
  if (brush === "brushRaise")
    selection.forEach(i => {
      heights[i] = !ocean && heights[i] < 20 ? 20 : limit(heights[i] + power);
    });
  else if (brush === "brushElevate")
    selection.forEach((i, d) => {
      heights[i] = limit(heights[i] + interpolate(d / Math.max(selection.length - 1, 1)));
    });
  else if (brush === "brushLower")
    selection.forEach(i => {
      heights[i] = limit(heights[i] - power);
    });
  else if (brush === "brushDepress")
    selection.forEach((i, d) => {
      heights[i] = limit(heights[i] - interpolate(d / Math.max(selection.length - 1, 1)));
    });
  else if (brush === "brushAlign")
    selection.forEach(i => {
      heights[i] = limit(heights[start]);
    });
  else if (brush === "brushSmooth")
    selection.forEach(i => {
      heights[i] = rn(
        ((mean(
          grid.cells.c[i]
            .filter((c: number) => (land ? heights[c] >= 20 : ocean ? heights[c] < 20 : true))
            .map((c: number) => heights[c])
        ) ?? 0) +
          heights[i] * (10 - power) +
          0.6) /
          (11 - power),
        1
      );
    });
  else if (brush === "brushDisrupt")
    selection.forEach(i => {
      heights[i] = heights[i] < 15 ? heights[i] : limit(heights[i] + power / 1.6 - Math.random() * power);
    });

  mockHeightmapSelection(selection);
}

function cellTypeFilterChange(): void {
  const cellTypeFilter = ensureEl<HTMLSelectElement>("cellTypeFilter");
  if (cellTypeFilter.value === "land" && ensureEl("heightmapEditMode").innerHTML === "keep") {
    tip("You cannot change the coastline in 'Keep' edit mode", false, "error");
    cellTypeFilter.value = "all";
  }
}

function rescale(v: number): void {
  const land = ensureEl<HTMLSelectElement>("cellTypeFilter").value === "land";
  const ocean = ensureEl<HTMLSelectElement>("cellTypeFilter").value === "water";
  grid.cells.h = grid.cells.h.map((h: number) => {
    if (land && (h < 20 || h + v < 20)) return h;
    if (ocean && h >= 20) return h;
    const newH = lim(h + v);
    return ocean ? Math.min(newH, 19) : newH;
  });
  updateHeightmap();
  ensureEl<HTMLInputElement>("rescaler").value = "0";
}

function rescaleWithCondition(): void {
  const range = `${ensureEl<HTMLInputElement>("rescaleLower").value}-${ensureEl<HTMLInputElement>("rescaleHigher").value}`;
  const operator = ensureEl<HTMLSelectElement>("conditionSign").value;
  const operand = ensureEl<HTMLInputElement>("rescaleModifier").valueAsNumber;
  if (Number.isNaN(operand)) {
    tip("Operand should be a number", false, "error");
    return;
  }
  if ((operator === "add" || operator === "subtract") && !Number.isInteger(operand)) {
    tip("Operand should be an integer", false, "error");
    return;
  }

  HeightmapGenerator.setGraph(grid);

  if (operator === "multiply") HeightmapGenerator.modify(range, 0, operand, 0);
  else if (operator === "divide") HeightmapGenerator.modify(range, 0, 1 / operand, 0);
  else if (operator === "add") HeightmapGenerator.modify(range, operand, 1, 0);
  else if (operator === "subtract") HeightmapGenerator.modify(range, -1 * operand, 1, 0);
  else if (operator === "exponent") HeightmapGenerator.modify(range, 0, 1, operand);

  grid.cells.h = HeightmapGenerator.getHeights();
  updateHeightmap();
}

function smoothAllHeights(): void {
  HeightmapGenerator.setGraph(grid);
  HeightmapGenerator.smooth(4, 1.5);
  grid.cells.h = HeightmapGenerator.getHeights();
  updateHeightmap();
}

function disruptAllHeights(): void {
  grid.cells.h = grid.cells.h.map((h: number) => (h < 15 ? h : lim(h + 2.5 - Math.random() * 4)));
  updateHeightmap();
}

function startFromScratch(): void {
  const cellTypeFilter = ensureEl<HTMLSelectElement>("cellTypeFilter").value;
  if (cellTypeFilter === "land") {
    tip("Not allowed when 'only land cells' filter is set", false, "error");
    return;
  }
  if (cellTypeFilter === "water") {
    tip("Not allowed when 'only water cells' filter is set", false, "error");
    return;
  }
  const someHeights = grid.cells.h.some((h: number) => h);
  if (!someHeights) {
    tip("Heightmap is already cleared, please do not click twice if not required", false, "error");
    return;
  }

  grid.cells.h = new Uint8Array(grid.cells.i.length);
  select<SVGElement, unknown>("#viewbox").select("#heights").selectAll("*").remove();
  updateHistory();
}

function openTemplateEditor(): void {
  if (document.getElementById("templateEditor")) return;
  renderTemplateEditor();

  $("#templateEditor").dialog({
    title: "Template Editor",
    minHeight: "auto",
    width: "fit-content",
    resizable: false,
    position: { my: "right top", at: "right-10 top+10", of: "svg" },
    close: closeTemplateEditor
  });
}

function closeTemplateEditor(): void {
  $("#templateEditor").dialog("destroy");
  ensureEl("templateEditor").remove();
}

function addStepOnClick(e: Event): void {
  const target = e.target as HTMLElement;
  if (target.tagName !== "BUTTON") return;
  const type = target.dataset.type!;
  ensureEl("templateBody").dataset.changed = "1";
  addStep(type);
}

function addStep(type: string, count?: string, dist?: string, arg4?: string, arg5?: string): void {
  const $body = ensureEl("templateBody");
  $body.insertAdjacentHTML("beforeend", getStepHTML(type, count, dist, arg4, arg5));

  const $elDist = $body.querySelector<HTMLSelectElement>("div:last-child > span > .templateDist");
  if ($elDist) $elDist.addEventListener("change", setRange);

  if (dist && $elDist && $elDist.tagName === "SELECT") {
    for (const option of Array.from($elDist.options)) {
      if (option.value === dist) $elDist.value = dist;
    }
    if ($elDist.value !== dist) {
      const opt = document.createElement("option");
      opt.value = opt.innerHTML = dist;
      $elDist.add(opt);
      $elDist.value = dist;
    }
  }
}

function getStepHTML(type: string, count?: string, arg3?: string, arg4?: string, arg5?: string): string {
  const Trash = /* html */ `<i class="icon-trash-empty pointer" data-tip="Click to remove the step"></i>`;
  const Hide = /* html */ `<div class="icon-check" data-tip="Click to skip the step"></div>`;
  const Reorder = /* html */ `<i class="icon-resize-vertical" data-tip="Drag to reorder"></i>`;
  const common = /* html */ `<div data-type="${type}">${Hide}<div style="width:4em">${type}</div>${Trash}${Reorder}`;

  const TempY = /* html */ `<span>y:
      <input class="templateY" data-tip="Placement range percentage along Y axis (minY-maxY)" value=${arg5 || "20-80"} />
    </span>`;

  const TempX = /* html */ `<span>x:
      <input class="templateX" data-tip="Placement range percentage along X axis (minX-maxX)" value=${arg4 || "15-85"} />
    </span>`;

  const Height = /* html */ `<span>h:
      <input class="templateHeight" data-tip="Blob maximum height, use hyphen to get a random number in range" value=${arg3 || "40-50"} />
    </span>`;

  const Count = /* html */ `<span>n:
      <input class="templateCount" data-tip="Blobs to add, use hyphen to get a random number in range" value=${count || "1-2"} />
    </span>`;

  if (type === "Hill" || type === "Pit" || type === "Range" || type === "Trough")
    return /* html */ `${common}${TempY}${TempX}${Height}${Count}</div>`;

  if (type === "Strait")
    return /* html */ `${common}
      <span>d:
        <select class="templateDist" data-tip="Strait direction">
          <option value="vertical" selected>vertical</option>
          <option value="horizontal">horizontal</option>
        </select>
      </span>
      <span>w:
        <input class="templateCount" data-tip="Strait width, use hyphen to get a random number in range" value=${count || "2-7"} />
      </span>
    </div>`;

  if (type === "Invert")
    return /* html */ `${common}
      <span>by:
        <select class="templateDist" data-tip="Mirror heightmap along axis" style="width: 7.8em">
          <option value="x" selected>x</option>
          <option value="y">y</option>
          <option value="xy">both</option>
        </select>
      </span>
      <span>n:
        <input class="templateCount" data-tip="Probability of inversion, range 0-1" value=${count || "0.5"} />
      </span>
    </div>`;

  if (type === "Mask")
    return /* html */ `${common}
      <span>f:
        <input class="templateCount"
          data-tip="Set masking fraction. 1 - full insulation (prevent land on map edges), 2 - half-insulation, etc. Negative number to inverse the effect"
          type="number" min=-10 max=10 value=${count || 1} />
      </span>
    </div>`;

  if (type === "Add")
    return /* html */ `${common}
      <span>to:
        <select class="templateDist" data-tip="Change only land or all cells">
          <option value="all" selected>all cells</option>
          <option value="land">land only</option>
          <option value="interval">interval</option>
        </select>
      </span>
      <span>v:
        <input class="templateCount" data-tip="Add value to height of all cells (negative values are allowed)"
        type="number" value=${count || -10} min=-100 max=100 step=1 />
      </span>
    </div>`;

  if (type === "Multiply")
    return /* html */ `${common}
      <span>to:
        <select class="templateDist" data-tip="Change only land or all cells">
          <option value="all" selected>all cells</option>
          <option value="land">land only</option>
          <option value="interval">interval</option>
        </select>
      </span>
      <span>v:
        <input class="templateCount" data-tip="Multiply all cells Height by the value" type="number"
          value=${count || 1.1} min=0 max=10 step=.1 />
      </span>
    </div>`;

  if (type === "Smooth")
    return /* html */ `${common}
      <span>f:
        <input class="templateCount" data-tip="Set smooth fraction. 1 - full smooth, 2 - half-smooth, etc."
          type="number" min=1 max=10 step=1 value=${count || 2} />
      </span>
    </div>`;

  return "";
}

function setRange(event: Event): void {
  const target = event.target as HTMLSelectElement;
  if (target.value !== "interval") return;

  prompt("Set a height interval. Avoid space, use hyphen as a separator", { default: "17-20" }, v => {
    const opt = document.createElement("option");
    opt.value = opt.innerHTML = String(v);
    target.add(opt);
    target.value = String(v);
  });
}

function selectTemplate(e: Event): void {
  const body = ensureEl("templateBody");
  const steps = body.querySelectorAll("div").length;
  const changed = +body.getAttribute("data-changed")!;
  const template = (e.target as HTMLSelectElement).value;
  if (!steps || !changed) {
    changeTemplate(template);
    return;
  }

  alertMessage.innerHTML = "Are you sure you want to select a different template? All changes will be lost.";
  $("#alert").dialog({
    resizable: false,
    title: "Change Template",
    buttons: {
      Change: function (this: HTMLElement) {
        changeTemplate(template);
        $(this).dialog("close");
      },
      Cancel: function (this: HTMLElement) {
        $(this).dialog("close");
      }
    }
  });
}

function changeTemplate(template: string): void {
  const body = ensureEl("templateBody");
  body.setAttribute("data-changed", "0");
  body.innerHTML = "";

  const templateString = heightmapTemplates[template]?.template;
  if (!templateString) return;

  const steps = templateString.split("\n");
  if (!steps.length) {
    tip(`Heightmap template: no steps defined`, false, "error");
    return;
  }

  for (const step of steps) {
    const elements = step.trim().split(" ");
    addStep(elements[0], elements[1], elements[2], elements[3], elements[4]);
  }
}

function executeTemplate(): void {
  const steps = ensureEl("templateBody").querySelectorAll<HTMLElement>("#templateBody > div");
  if (!steps.length) return;

  const currentSeed = ensureEl<HTMLInputElement>("templateSeed").value;
  Math.random = aleaPRNG(currentSeed || generateSeed());

  grid.cells.h = new Uint8Array(grid.points.length);
  HeightmapGenerator.setGraph(grid);
  restartHistory();

  for (const step of steps) {
    if (step.style.opacity === "0.5") continue;

    const count = step.querySelector<HTMLInputElement>(".templateCount")?.value || "";
    const height = step.querySelector<HTMLInputElement>(".templateHeight")?.value || "";
    const dist = step.querySelector<HTMLSelectElement>(".templateDist")?.value || "";
    const x = step.querySelector<HTMLInputElement>(".templateX")?.value || "";
    const y = step.querySelector<HTMLInputElement>(".templateY")?.value || "";
    const type = step.dataset.type;

    if (type === "Hill") HeightmapGenerator.addHill(count, height, x, y);
    else if (type === "Pit") HeightmapGenerator.addPit(count, height, x, y);
    else if (type === "Range") HeightmapGenerator.addRange(count, height, x, y);
    else if (type === "Trough") HeightmapGenerator.addTrough(count, height, x, y);
    else if (type === "Strait") HeightmapGenerator.addStrait(count, dist);
    else if (type === "Mask") HeightmapGenerator.mask(+count);
    else if (type === "Invert") HeightmapGenerator.invert(+count, dist);
    else if (type === "Add") HeightmapGenerator.modify(dist, +count, 1);
    else if (type === "Multiply") HeightmapGenerator.modify(dist, 0, +count);
    else if (type === "Smooth") HeightmapGenerator.smooth(+count);

    grid.cells.h = HeightmapGenerator.getHeights();
    updateHistory("noStat"); // update history on every step
  }

  grid.cells.h = HeightmapGenerator.getHeights();
  updateStatistics();
  mockHeightmap();
  if (document.getElementById("preview")) drawHeightmapPreview();
  if (document.getElementById("canvas3d")) Controllers.View3d.redraw();
}

function downloadTemplate(): void {
  const body = ensureEl("templateBody");
  body.dataset.changed = "0";
  const steps = body.querySelectorAll<HTMLElement>("#templateBody > div");
  if (!steps.length) return;

  let data = "";
  for (const s of Array.from(steps)) {
    if (s.style.opacity === "0.5") continue;

    const type = s.getAttribute("data-type");
    const count = s.querySelector<HTMLInputElement>(".templateCount")?.value || "0";
    const arg3 =
      s.querySelector<HTMLInputElement>(".templateHeight")?.value ||
      s.querySelector<HTMLSelectElement>(".templateDist")?.value ||
      "0";
    const x = s.querySelector<HTMLInputElement>(".templateX")?.value || "0";
    const y = s.querySelector<HTMLInputElement>(".templateY")?.value || "0";
    data += `${type} ${count} ${arg3} ${x} ${y}\r\n`;
  }

  const name = `template_${Date.now()}.txt`;
  downloadFile(data, name);
}

function uploadTemplate(dataLoaded: string): void {
  const steps = dataLoaded.split("\r\n");
  if (!steps.length) {
    tip("Cannot parse the template, please check the file", false, "error");
    return;
  }
  ensureEl("templateBody").innerHTML = "";

  for (const s of steps) {
    const step = s.split(" ");
    if (step.length !== 5) {
      ERROR && console.error("Cannot parse step, wrong arguments count", s);
      continue;
    }
    addStep(step[0], step[1], step[2], step[3], step[4]);
  }
}

function openImageConverter(): void {
  if (document.getElementById("imageConverter")) return;
  ensureEl("imageToLoad").click();
  closeDialogs("#imageConverter");

  renderImageConverter();

  $("#imageConverter").dialog({
    title: "Image Converter",
    maxHeight: svgHeight * 0.8,
    minHeight: "auto",
    width: "20em",
    position: { my: "right top", at: "right-10 top+10", of: "svg" },
    beforeClose: closeImageConverter
  });

  // create canvas for image
  const canvas = document.createElement("canvas");
  canvas.id = "canvas";
  canvas.width = graphWidth;
  canvas.height = graphHeight;
  document.body.insertBefore(canvas, ensureEl("optionsContainer"));

  setOverlayOpacity(0);
  clearMainTip();
  tip("Image Converter is opened. Upload image and assign height value for each color", false, "warn"); // main tip

  // remove all heights
  grid.cells.h = new Uint8Array(grid.cells.i.length);
  select<SVGElement, unknown>("#viewbox").select("#heights").selectAll("*").remove();
  updateHistory();
}

function showPalleteHeight(this: HTMLElement): void {
  const height = +this.getAttribute("data-color")!;
  ensureEl("colorsSelectValue").innerHTML = String(height);
  ensureEl("colorsSelectFriendly").innerHTML = getFriendlyHeight(height);
  const former = ensureEl("imageConverterPalette").querySelector<HTMLElement>(".hoveredColor");
  if (former) former.className = "";
  this.className = "hoveredColor";
}

function loadImage(this: HTMLInputElement): void {
  const file = this.files![0];
  this.value = ""; // reset input value to get triggered if the file is re-uploaded
  const reader = new FileReader();

  const img = new Image();
  img.id = "imageToConvert";
  img.style.display = "none";
  document.body.appendChild(img);

  img.onload = () => {
    const ctx = ensureEl<HTMLCanvasElement>("canvas").getContext("2d")!;
    ctx.drawImage(img, 0, 0, graphWidth, graphHeight);
    heightsFromImage(+ensureEl<HTMLInputElement>("convertColors").value);
    resetZoom();
  };

  reader.onloadend = () => {
    img.src = reader.result as string;
  };
  reader.readAsDataURL(file);
}

function heightsFromImage(count: number): void {
  const sourceImage = ensureEl<HTMLCanvasElement>("canvas");
  const sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = grid.cellsX;
  sampleCanvas.height = grid.cellsY;
  sampleCanvas.getContext("2d")!.drawImage(sourceImage, 0, 0, grid.cellsX, grid.cellsY);

  const q = new RgbQuant({ colors: count });
  q.sample(sampleCanvas);
  const data = q.reduce(sampleCanvas);
  const pallete = q.palette(true);

  select<SVGElement, unknown>("#viewbox").select("#heights").selectAll("*").remove();
  select("#imageConverter").selectAll("div.color-div").remove();
  ensureEl("colorsSelect").style.display = "block";
  ensureEl("colorsUnassigned").style.display = "block";
  ensureEl("colorsAssigned").style.display = "none";
  sampleCanvas.remove(); // no need to keep

  select<SVGElement, unknown>("#viewbox")
    .select("#heights")
    .selectAll<SVGPolygonElement, number>("polygon")
    .data<number>(grid.cells.i as number[])
    .join("polygon")
    .attr("points", (d: number) => getGridPolygon(d, grid))
    .attr("id", (d: number) => `cell${d}`)
    .attr("fill", (d: number) => `rgb(${data[d * 4]}, ${data[d * 4 + 1]}, ${data[d * 4 + 2]})`)
    .on("click", mapClicked);

  const colors: string[] = pallete.map((p: number[]) => `rgb(${p[0]}, ${p[1]}, ${p[2]})`);
  select("#colorsUnassignedContainer")
    .selectAll<HTMLDivElement, string>("div")
    .data(colors)
    .enter()
    .append("div")
    .attr("data-color", (i: string) => i)
    .style("background-color", (i: string) => i)
    .attr("class", "color-div")
    .on("click", colorClicked);

  ensureEl("colorsUnassignedNumber").innerHTML = String(colors.length);
}

function mapClicked(this: SVGElement): void {
  const fill = this.getAttribute("fill");
  const palleteColor = ensureEl("imageConverter").querySelector<HTMLElement>(`div[data-color="${fill}"]`);
  palleteColor?.click();
}

function colorClicked(this: HTMLElement): void {
  select<SVGElement, unknown>("#viewbox").select("#heights").selectAll(".selectedCell").attr("class", null);
  const unselect = this.classList.contains("selectedColor");

  const selectedColor = ensureEl("imageConverter").querySelector("div.selectedColor");
  if (selectedColor) selectedColor.classList.remove("selectedColor");
  const hoveredColor = ensureEl("imageConverterPalette").querySelector("div.hoveredColor");
  if (hoveredColor) hoveredColor.classList.remove("hoveredColor");
  ensureEl("colorsSelectValue").innerHTML = ensureEl("colorsSelectFriendly").innerHTML = "0";

  if (unselect) return;
  this.classList.add("selectedColor");

  if (this.dataset.height) {
    const height = +this.dataset.height;
    ensureEl("imageConverterPalette").querySelector(`div[data-color="${height}"]`)?.classList.add("hoveredColor");
    ensureEl("colorsSelectValue").innerHTML = String(height);
    ensureEl("colorsSelectFriendly").innerHTML = getFriendlyHeight(height);
  }

  const clr = this.getAttribute("data-color");
  select<SVGElement, unknown>("#viewbox")
    .select("#heights")
    .selectAll("polygon.selectedCell")
    .classed("selectedCell", false);
  select<SVGElement, unknown>("#viewbox")
    .select("#heights")
    .selectAll(`polygon[fill='${clr}']`)
    .classed("selectedCell", true);
}

function assignHeight(this: HTMLElement): void {
  const height = +this.dataset.color!;
  const rgb = color(1 - (height < 20 ? height - 5 : height) / 100);
  const selectedColor = ensureEl("imageConverter").querySelector<HTMLElement>("div.selectedColor")!;
  selectedColor.style.backgroundColor = rgb;
  selectedColor.setAttribute("data-color", rgb);
  selectedColor.setAttribute("data-height", String(height));

  select<SVGElement, unknown>("#viewbox")
    .select("#heights")
    .selectAll<SVGElement, unknown>(".selectedCell")
    .each(function () {
      this.setAttribute("fill", rgb);
      this.setAttribute("data-height", String(height));
    });

  if ((selectedColor.parentNode as HTMLElement).id === "colorsUnassignedContainer") {
    ensureEl("colorsAssignedContainer").appendChild(selectedColor);
    ensureEl("colorsAssigned").style.display = "block";

    ensureEl("colorsUnassignedNumber").innerHTML = String(ensureEl("colorsUnassignedContainer").childElementCount - 2);
    ensureEl("colorsAssignedNumber").innerHTML = String(ensureEl("colorsAssignedContainer").childElementCount - 2);
  }
}

// auto assign color based on luminosity or hue
function autoAssing(type: string): void {
  const colorsUnassignedContainer = ensureEl("colorsUnassignedContainer");
  let unassigned = colorsUnassignedContainer.querySelectorAll<HTMLElement>("div");
  if (!unassigned.length) {
    heightsFromImage(+ensureEl<HTMLInputElement>("convertColors").value);
    unassigned = colorsUnassignedContainer.querySelectorAll<HTMLElement>("div");
    if (!unassigned.length) {
      tip("No unassigned colors. Please load an image and click the button again", false, "error");
      return;
    }
  }

  const getHeightByHue = (clr: string): number => {
    let hue = hsl(clr).h;
    if (hue > 300) hue -= 360;
    if (hue > 170) return (Math.abs(hue - 250) / 3) | 0; // water
    return (Math.abs(hue - 250 + 20) / 3) | 0; // land
  };

  const getHeightByLum = (clr: string): number => {
    const lum = lab(clr).l;
    if (lum < 13) return ((lum / 13) * 20) | 0; // water
    return lum | 0; // land
  };

  const scheme = range(101).map(i => getColor(i));
  const hues = scheme.map(rgb => hsl(rgb).h | 0);
  const getHeightByScheme = (clr: string): number => {
    const height = scheme.indexOf(clr);
    if (height !== -1) return height; // exact match
    const hue = hsl(clr).h;
    const closest = hues.reduce((prev, curr) => (Math.abs(curr - hue) < Math.abs(prev - hue) ? curr : prev));
    return hues.indexOf(closest);
  };

  const assinged: boolean[] = []; // store assigned heights
  const colorsAssignedContainer = ensureEl("colorsAssignedContainer");
  unassigned.forEach(el => {
    const clr = el.dataset.color!;
    const height = type === "hue" ? getHeightByHue(clr) : type === "lum" ? getHeightByLum(clr) : getHeightByScheme(clr);
    const colorTo = color(1 - (height < 20 ? (height - 5) / 100 : height / 100));
    select<SVGElement, unknown>("#viewbox")
      .select("#heights")
      .selectAll(`polygon[fill='${clr}']`)
      .attr("fill", colorTo)
      .attr("data-height", height);

    if (assinged[height]) {
      el.remove();
      return;
    } // if color is already added, remove it
    el.style.backgroundColor = el.dataset.color = colorTo;
    el.dataset.height = String(height);
    colorsAssignedContainer.appendChild(el);
    assinged[height] = true;
  });

  // sort assigned colors by height
  Array.from(colorsAssignedContainer.children)
    .sort((a, b) => +(a as HTMLElement).dataset.height! - +(b as HTMLElement).dataset.height!)
    .forEach(line => {
      colorsAssignedContainer.appendChild(line);
    });

  ensureEl("colorsAssigned").style.display = "block";
  ensureEl("colorsUnassigned").style.display = "none";
  ensureEl("colorsAssignedNumber").innerHTML = String(colorsAssignedContainer.childElementCount - 2);
}

function setConvertColorsNumber(): void {
  prompt(
    `Please set maximum number of colors. <br>An actual number is usually lower and depends on color scheme`,
    { default: +ensureEl<HTMLInputElement>("convertColors").value, step: 1, min: 3, max: 255 },
    number => {
      ensureEl<HTMLInputElement>("convertColors").value = String(number);
      heightsFromImage(+number);
    }
  );
}

function setOverlayOpacity(v: number): void {
  ensureEl<HTMLInputElement>("convertOverlay").value = ensureEl<HTMLInputElement>("convertOverlayNumber").value =
    String(v);
  ensureEl("canvas").style.opacity = String(v);
}

function applyConversion(): void {
  if (ensureEl("colorsAssignedContainer").childElementCount < 3) {
    tip("Please assign colors to heights first", false, "error");
    return;
  }

  select<SVGElement, unknown>("#viewbox")
    .select("#heights")
    .selectAll<SVGElement, unknown>("polygon")
    .each(function () {
      const height = +(this.dataset.height ?? "0") || 0;
      const i = +this.id.slice(4);
      grid.cells.h[i] = height;
    });

  select<SVGElement, unknown>("#viewbox").select("#heights").selectAll("polygon").remove();
  updateHeightmap();
  restoreImageConverterState();
}

function cancelConversion(): void {
  restoreImageConverterState();
  select<SVGElement, unknown>("#viewbox").select("#heights").selectAll("polygon").remove();
  restoreHistory(edits.n - 1);
}

function restoreImageConverterState(): void {
  document.getElementById("canvas")?.remove();
  document.getElementById("imageToConvert")?.remove();

  select("#imageConverter").selectAll("div.color-div").remove();
  ensureEl("colorsAssigned").style.display = "none";
  ensureEl("colorsUnassigned").style.display = "none";
  ensureEl("colorsSelectValue").innerHTML = ensureEl("colorsSelectFriendly").innerHTML = "0";
  select<SVGElement, unknown>("#viewbox").style("cursor", "default").on(".drag", null);
  tip('Heightmap edit mode is active. Click on "Exit Customization" to finalize the heightmap', true);
  $("#imageConverter").dialog("destroy");
  ensureEl("imageConverter").remove();
  openBrushesPanel();
}

function closeImageConverter(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
  alertMessage.innerHTML = /* html */ `Are you sure you want to close the Image Converter? Click "Cancel" to keep editing. Click "Complete" to apply
  the conversion and close the tool. Click "Close" to discard the conversion and restore the previous heightmap.`;

  $("#alert").dialog({
    resizable: false,
    title: "Close Image Converter",
    buttons: {
      Cancel: function (this: HTMLElement) {
        $(this).dialog("close");
      },
      Complete: function (this: HTMLElement) {
        $(this).dialog("close");
        applyConversion();
      },
      Close: function (this: HTMLElement) {
        $(this).dialog("close");
        restoreImageConverterState();
        select<SVGElement, unknown>("#viewbox").select("#heights").selectAll("polygon").remove();
        restoreHistory(edits.n - 1);
      }
    }
  });
}

function toggleHeightmapPreview(): void {
  const existing = document.getElementById("preview");
  if (existing) {
    existing.remove();
    return;
  }
  const preview = document.createElement("canvas");
  preview.id = "preview";
  preview.width = grid.cellsX;
  preview.height = grid.cellsY;
  document.body.insertBefore(preview, ensureEl("optionsContainer"));
  preview.addEventListener("mouseover", () => tip("Heightmap preview. Click to download a screen-sized image"));
  preview.addEventListener("click", downloadPreview);
  drawHeightmapPreview();
}

function drawHeightmapPreview(): void {
  const ctx = (document.getElementById("preview") as HTMLCanvasElement).getContext("2d")!;
  const imageData = ctx.createImageData(grid.cellsX, grid.cellsY);

  grid.cells.h.forEach((height: number, i: number) => {
    const h = height < 20 ? Math.max(height / 1.5, 0) : height;
    const v = (h / 100) * 255;

    const n = i * 4;
    imageData.data[n] = v;
    imageData.data[n + 1] = v;
    imageData.data[n + 2] = v;
    imageData.data[n + 3] = 255;
  });

  ctx.putImageData(imageData, 0, 0);
}

function downloadPreview(): void {
  const preview = document.getElementById("preview") as HTMLCanvasElement;
  const dataURL = preview.toDataURL("image/png");

  const img = new Image();
  img.src = dataURL;

  img.onload = () => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    canvas.width = graphWidth;
    canvas.height = graphHeight;
    document.body.insertBefore(canvas, ensureEl("optionsContainer"));
    ctx.drawImage(img, 0, 0, graphWidth, graphHeight);
    const imgBig = canvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.download = `${getFileName("Heightmap")}.png`;
    link.href = imgBig;
    link.click();
    canvas.remove();
  };
}

export const HeightmapEditor = { open };


========================================
FILE: ./controllers/world-configurator.ts
========================================

import { geoGraticule, geoOrthographic, geoPath, interpolateSpectral, range, scaleSequential, select } from "d3";
import { destroyDialog } from "@/components/dialog/dialog-helpers";
import { Layers } from "@/components/layers";
import { tip } from "@/components/tooltips";
import { stored } from "@/utils/preferences";
import { convertTemperature, ensureEl, findEl, parseTransform, rn, round } from "../utils";

const projection = geoOrthographic().translate([100, 100]).scale(100);
const path = geoPath(projection);

function open(): void {
  if (customization) return;

  renderDialog();
  updateInputValues();
  updateGlobeTemperature();
  updateGlobePosition();
  updateWindDirections();

  $("#worldConfigurator").dialog({
    title: "Configure World",
    resizable: false,
    width: "minmax(40em, 85vw)",
    buttons: { "Update world": updateWorld },
    open: function (this: HTMLElement) {
      const checkbox = /* html */ `<div class="dontAsk" data-tip="Automatically update world on input changes and button clicks">
        <input id="wcAutoChange" class="checkbox" type="checkbox" checked />
        <label for="wcAutoChange" class="checkbox-label"><i>auto-apply changes</i></label>
      </div>`;
      const pane = this.parentElement?.querySelector(".ui-dialog-buttonpane");
      pane?.insertAdjacentHTML("afterbegin", checkbox);

      const button = this.parentElement?.querySelector(".ui-dialog-buttonset > button");
      button?.addEventListener("mousemove", () => tip("Apply current settings to the map"));
    },
    close: () => destroyDialog("worldConfigurator")
  });
}

function renderDialog(): void {
  destroyDialog("worldConfigurator");
  ensureEl("dialogs").insertAdjacentHTML("beforeend", createDialogHtml());
  addListeners();
}

function createDialogHtml(): string {
  const temperatureControl = (param: string, label: string, dataTip: string): string => /* html */ `<div>
    <i data-locked="0" id="lock_${param}" class="icon-lock-open"></i>
    <label data-tip="${dataTip}">
      <i>${label}:</i>
      <input id="${param}Input" type="number" min="-50" max="50" />
      <span>°C<span id="${param}Converted"></span></span>
      <input id="${param}Output" type="range" min="-50" max="50" />
    </label>
  </div>`;

  return /* html */ `<div id="worldConfigurator" class="dialog stable">
    <div style="display: flex">
      <div id="worldControls">
        ${temperatureControl("temperatureEquator", "Equator", "Set temperature at equator")}
        ${temperatureControl("temperatureNorthPole", "North Pole", "Set the North Pole average yearly temperature")}
        ${temperatureControl("temperatureSouthPole", "South Pole", "Set the South Pole average yearly temperature")}
        <div>
          <i data-locked="0" id="lock_mapSize" class="icon-lock-open"></i>
          <label data-tip="Set map size relative to the world size">
            <i>Map size:</i>
            <input id="mapSizeInput" type="number" min="1" max="100" step="0.1" />%
            <input id="mapSizeOutput" type="range" min="1" max="100" step="0.1" />
          </label>
        </div>
        <div>
          <i data-locked="0" id="lock_latitude" class="icon-lock-open"></i>
          <label data-tip="Set a North-South map shift, set to 50 to make map center lie on Equator">
            <i>Latitudes:</i>
            <input id="latitudeInput" type="number" min="0" max="100" step="0.1" />
            <br /><i>N</i
            ><input
              id="latitudeOutput"
              type="range"
              min="0"
              max="100"
              step="0.1"
              style="width: 10.3em"
            /><i>S</i>
          </label>
        </div>
        <div>
          <i data-locked="0" id="lock_longitude" class="icon-lock-open"></i>
          <label data-tip="Set a West-East map shift, set to 50 to make map center lie on Prime meridian">
            <i>Longitudes:</i>
            <input id="longitudeInput" type="number" min="0" max="100" step="0.1" />
            <br /><i>W</i
            ><input
              id="longitudeOutput"
              type="range"
              min="0"
              max="100"
              step="0.1"
              style="width: 10.3em"
            /><i>E</i>
          </label>
        </div>
        <div>
          <label
            data-tip="Set precipitation - water amount clouds can bring. Defines rivers and biomes generation. Keep around 100% for default generation"
          >
            <i data-locked="0" id="lock_prec" class="icon-lock-open"></i>
            <i>Precipitation:</i>
            <input id="precInput" type="number" />%
            <input id="precOutput" type="range" min="0" max="500" />
          </label>
        </div>
        <div data-tip="Canvas size. Can be changed in general options on new map generation">
          <i>Canvas size:</i><br />
          <span id="mapSize"></span> px = <span id="mapSizeFriendly"></span>
        </div>
        <div>
          <i data-tip="Length of Meridian. Almost half of the equator length">Meridian length:</i><br />
          <span id="meridianLength" data-tip="Length of Meridian in pixels"></span> px =
          <span
            id="meridianLengthFriendly"
            data-tip="Length of Meridian is friendly units (depends on user configuration)"
          ></span>
          <span
            id="meridianLengthEarth"
            data-tip="Fantasy world Meridian length relative to real-world Earth (20k km)"
          ></span>
        </div>
        <div data-tip="Map coordinates on globe"><i>Coords:</i> <span id="mapCoordinates"></span></div>
      </div>
      <div style="display: flex; flex-direction: column; align-items: flex-end">
        <svg id="globe" width="22em" viewBox="-20 -25 240 240">
          <defs>
            <linearGradient id="temperatureGradient" x1="0" x2="0" y1="0" y2="1">
              <stop id="grad90" offset="0%" stop-color="blue" />
              <stop id="grad60" offset="16.6%" stop-color="green" />
              <stop id="grad30" offset="33.3%" stop-color="yellow" />
              <stop id="grad0" offset="50%" stop-color="red" />
              <stop id="grad-30" offset="66.6%" stop-color="yellow" />
              <stop id="grad-60" offset="83.3%" stop-color="green" />
              <stop id="grad-90" offset="100%" stop-color="blue" />
            </linearGradient>
          </defs>
          <g id="globeNoteLines">
            <line x1="5" x2="220" y1="0" y2="0" />
            <line x1="5" x2="220" y1="13" y2="13" />
            <line x1="5" x2="220" y1="49.5" y2="49.5" />
            <line x1="-5" x2="220" y1="100" y2="100" />
            <line x1="5" x2="220" y1="150.5" y2="150.5" />
            <line x1="5" x2="220" y1="187" y2="187" />
            <line x1="5" x2="220" y1="200" y2="200" />
          </g>
          <g id="globeWindArrows" data-tip="Click to change wind direction" stroke-linejoin="round">
            <circle cx="210" cy="6" r="12" />
            <path data-tier="0" d="M210,11 v-10 l-3,3 m6,0 l-3,-3" transform="rotate(225 210 6)" />
            <circle cx="210" cy="30" r="12" />
            <path data-tier="1" d="M210,35 v-10 l-3,3 m6,0 l-3,-3" transform="rotate(45 210 30)" />
            <circle cx="210" cy="75" r="12" />
            <path data-tier="2" d="M210,80 v-10 l-3,3 m6,0 l-3,-3" transform="rotate(225 210 75)" />
            <circle cx="210" cy="130" r="12" />
            <path data-tier="3" d="M210,135 v-10 l-3,3 m6,0 l-3,-3" transform="rotate(315 210 130)" />
            <circle cx="210" cy="173" r="12" />
            <path data-tier="4" d="M210,178 v-10 l-3,3 m6,0 l-3,-3" transform="rotate(135 210 173)" />
            <circle cx="210" cy="194" r="12" />
            <path data-tier="5" d="M210,199 v-10 l-3,3 m6,0 l-3,-3" transform="rotate(315 210 194)" />
          </g>
          <g id="globaAxisLabels">
            <text x="82%" y="-4%">wind</text>
            <text x="-8%" y="-4%">latitude</text>
          </g>
          <g id="globeLatLabels">
            <text x="-15" y="5">90°</text>
            <text x="-15" y="18">60°</text>
            <text x="-15" y="53">30°</text>
            <text x="-15" y="103">0°</text>
            <text x="-15" y="153">30°</text>
            <text x="-15" y="190">60°</text>
            <text x="-15" y="204">90°</text>
          </g>
          <circle id="globeGradient" cx="100" cy="100" r="100" fill="url(#temperatureGradient)" stroke="none" />
          <line id="globePrimeMeridian" x1="100" x2="100" y1="0" y2="200" />
          <line id="globeEquator" x1="1" x2="200" y1="100" y2="100" />
          <circle id="globeOutline" cx="100" cy="100" r="100" fill="none" />
          <path id="globeGraticule" />
          <path id="globeArea" />
        </svg>
        <button id="restoreWinds" data-tip="Click to restore default (Earth-based) wind directions">
          Restore winds
        </button>
      </div>
    </div>
    <div style="margin-top: 0.3em">
      <i>Presets:</i>
      <button id="wcWholeWorld" data-tip="Click to set map size to cover the whole world">Whole world</button>
      <button id="wcNorthern" data-tip="Click to set map size to cover the Northern latitudes">Northern</button>
      <button id="wcTropical" data-tip="Click to set map size to cover the Tropical latitudes">Tropical</button>
      <button id="wcSouthern" data-tip="Click to set map size to cover the Southern latitudes">Southern</button>
    </div>
  </div>`;
}

function addListeners(): void {
  select("#globe").select("#globeWindArrows").on("click", handleWindChange);
  select("#globe")
    .select("#globeGraticule")
    .attr("d", round(path(geoGraticule()()) ?? "")); // globe graticule

  ensureEl("temperatureEquatorInput").addEventListener("input", changeTemperatureEquator);
  ensureEl("temperatureEquatorOutput").addEventListener("input", changeTemperatureEquator);
  ensureEl("temperatureNorthPoleInput").addEventListener("input", changeTemperatureNorthPole);
  ensureEl("temperatureNorthPoleOutput").addEventListener("input", changeTemperatureNorthPole);
  ensureEl("temperatureSouthPoleInput").addEventListener("input", changeTemperatureSouthPole);
  ensureEl("temperatureSouthPoleOutput").addEventListener("input", changeTemperatureSouthPole);
  ensureEl("mapSizeInput").addEventListener("input", changeMapSize);
  ensureEl("mapSizeOutput").addEventListener("input", changeMapSize);
  ensureEl("latitudeInput").addEventListener("input", changeLatitude);
  ensureEl("latitudeOutput").addEventListener("input", changeLatitude);
  ensureEl("longitudeInput").addEventListener("input", changeLongitude);
  ensureEl("longitudeOutput").addEventListener("input", changeLongitude);
  ensureEl("precInput").addEventListener("input", changePrecipitation);
  ensureEl("precOutput").addEventListener("input", changePrecipitation);

  ensureEl("restoreWinds").addEventListener("click", restoreDefaultWinds);
  ensureEl("wcWholeWorld").addEventListener("click", () => applyWorldPreset(100, 50));
  ensureEl("wcNorthern").addEventListener("click", () => applyWorldPreset(33, 25));
  ensureEl("wcTropical").addEventListener("click", () => applyWorldPreset(33, 50));
  ensureEl("wcSouthern").addEventListener("click", () => applyWorldPreset(33, 75));

  // lock icons: sync state from storage and toggle on click (stored == locked)
  ensureEl("worldConfigurator")
    .querySelectorAll<HTMLElement>("[data-locked]")
    .forEach(el => {
      const id = el.id.slice(5) as WorldOption; // drop "lock_" prefix
      setLockIcon(el, stored(id) !== null);

      el.addEventListener("mouseover", (event: Event) => {
        event.stopPropagation();
        if (el.className === "icon-lock")
          tip("Click to unlock the option and allow it to be randomized on new map generation");
        else tip("Click to lock the option and always use the current value on new map generation");
      });
      el.addEventListener("click", () => {
        if (el.className === "icon-lock") unlockOption(id);
        else lockOption(id);
      });
    });
}

type WorldOption =
  | "temperatureEquator"
  | "temperatureNorthPole"
  | "temperatureSouthPole"
  | "mapSize"
  | "latitude"
  | "longitude"
  | "prec";

// stored options are locked (won't be randomized on new map generation), the icon is just a mirror
function lockOption(id: WorldOption): void {
  localStorage.setItem(id, String(options[id]));
  const icon = findEl(`lock_${id}`);
  if (icon) setLockIcon(icon, true);
}

function unlockOption(id: WorldOption): void {
  localStorage.removeItem(id);
  const icon = findEl(`lock_${id}`);
  if (icon) setLockIcon(icon, false);
}

function setLockIcon(el: HTMLElement, isLocked: boolean): void {
  el.dataset.locked = isLocked ? "1" : "0";
  el.className = isLocked ? "icon-lock" : "icon-lock-open";
}

// inputs are always in °C; show " = <value>" in user units if user units are not °C
function convertedTemperature(temperatureCelsius: number): string {
  const userUnits = ensureEl<HTMLSelectElement>("temperatureScale").value;
  if (userUnits === "°C") return "";
  return ` = ${convertTemperature(temperatureCelsius)}`;
}

function changeTemperatureEquator(this: HTMLInputElement): void {
  options.temperatureEquator = Number(this.value);
  ensureEl<HTMLInputElement>("temperatureEquatorInput").value = this.value;
  ensureEl<HTMLInputElement>("temperatureEquatorOutput").value = this.value;
  ensureEl("temperatureEquatorConverted").innerText = convertedTemperature(options.temperatureEquator);
  lockOption("temperatureEquator");
  if (ensureEl<HTMLInputElement>("wcAutoChange").checked) updateWorld();
}

function changeTemperatureNorthPole(this: HTMLInputElement): void {
  options.temperatureNorthPole = Number(this.value);
  ensureEl<HTMLInputElement>("temperatureNorthPoleInput").value = this.value;
  ensureEl<HTMLInputElement>("temperatureNorthPoleOutput").value = this.value;
  ensureEl("temperatureNorthPoleConverted").innerText = convertedTemperature(options.temperatureNorthPole);
  lockOption("temperatureNorthPole");
  if (ensureEl<HTMLInputElement>("wcAutoChange").checked) updateWorld();
}

function changeTemperatureSouthPole(this: HTMLInputElement): void {
  options.temperatureSouthPole = Number(this.value);
  ensureEl<HTMLInputElement>("temperatureSouthPoleInput").value = this.value;
  ensureEl<HTMLInputElement>("temperatureSouthPoleOutput").value = this.value;
  ensureEl("temperatureSouthPoleConverted").innerText = convertedTemperature(options.temperatureSouthPole);
  lockOption("temperatureSouthPole");
  if (ensureEl<HTMLInputElement>("wcAutoChange").checked) updateWorld();
}

function changeMapSize(this: HTMLInputElement): void {
  options.mapSize = Number(this.value);
  ensureEl<HTMLInputElement>("mapSizeInput").value = this.value;
  ensureEl<HTMLInputElement>("mapSizeOutput").value = this.value;
  lockOption("mapSize");
  if (ensureEl<HTMLInputElement>("wcAutoChange").checked) updateWorld();
}

function changeLatitude(this: HTMLInputElement): void {
  options.latitude = Number(this.value);
  ensureEl<HTMLInputElement>("latitudeInput").value = this.value;
  ensureEl<HTMLInputElement>("latitudeOutput").value = this.value;
  lockOption("latitude");
  if (ensureEl<HTMLInputElement>("wcAutoChange").checked) updateWorld();
}

function changeLongitude(this: HTMLInputElement): void {
  options.longitude = Number(this.value);
  ensureEl<HTMLInputElement>("longitudeInput").value = this.value;
  ensureEl<HTMLInputElement>("longitudeOutput").value = this.value;
  lockOption("longitude");
  if (ensureEl<HTMLInputElement>("wcAutoChange").checked) updateWorld();
}

function changePrecipitation(this: HTMLInputElement): void {
  options.prec = Number(this.value);
  ensureEl<HTMLInputElement>("precInput").value = this.value;
  ensureEl<HTMLInputElement>("precOutput").value = this.value;
  lockOption("prec");
  if (ensureEl<HTMLInputElement>("wcAutoChange").checked) updateWorld();
}

function updateInputValues(): void {
  ensureEl<HTMLInputElement>("temperatureEquatorInput").value = String(options.temperatureEquator);
  ensureEl<HTMLInputElement>("temperatureEquatorOutput").value = String(options.temperatureEquator);
  ensureEl<HTMLInputElement>("temperatureNorthPoleInput").value = String(options.temperatureNorthPole);
  ensureEl<HTMLInputElement>("temperatureNorthPoleOutput").value = String(options.temperatureNorthPole);
  ensureEl<HTMLInputElement>("temperatureSouthPoleInput").value = String(options.temperatureSouthPole);
  ensureEl<HTMLInputElement>("temperatureSouthPoleOutput").value = String(options.temperatureSouthPole);
  ensureEl<HTMLInputElement>("mapSizeInput").value = String(options.mapSize);
  ensureEl<HTMLInputElement>("mapSizeOutput").value = String(options.mapSize);
  ensureEl<HTMLInputElement>("latitudeInput").value = String(options.latitude);
  ensureEl<HTMLInputElement>("latitudeOutput").value = String(options.latitude);
  ensureEl<HTMLInputElement>("longitudeInput").value = String(options.longitude);
  ensureEl<HTMLInputElement>("longitudeOutput").value = String(options.longitude);
  ensureEl<HTMLInputElement>("precInput").value = String(options.prec);
  ensureEl<HTMLInputElement>("precOutput").value = String(options.prec);
  ensureEl("temperatureEquatorConverted").innerText = convertedTemperature(options.temperatureEquator);
  ensureEl("temperatureNorthPoleConverted").innerText = convertedTemperature(options.temperatureNorthPole);
  ensureEl("temperatureSouthPoleConverted").innerText = convertedTemperature(options.temperatureSouthPole);
}

function updateWorld(): void {
  updateGlobeTemperature();
  updateGlobePosition();
  generateAeroHydro();
  calculateTemperatures();
  generatePrecipitation();
  const heights = new Uint8Array(pack.cells.h);
  Rivers.generate();
  Rivers.specify();
  pack.cells.h = new Float32Array(heights);
  Biomes.define();
  Features.defineGroups();
  Lakes.defineNames();

  Layers.draw("temperature", "precipitation");
  Layers.draw("biomes", "coordinates", "rivers");
  if (findEl("canvas3d")) setTimeout(() => window.Controllers.View3d.update(), 500);
}

function updateGlobePosition(): void {
  const eqD = ((graphHeight / 2) * 100) / options.mapSize;

  calculateMapCoordinates();
  const mc = mapCoordinates;
  const unit = distanceUnitInput.value;
  const meridian = toKilometer(eqD * 2 * distanceScale);
  ensureEl("mapSize").innerHTML = `${graphWidth}x${graphHeight}`;
  ensureEl("mapSizeFriendly").innerHTML =
    `${rn(graphWidth * distanceScale)}x${rn(graphHeight * distanceScale)} ${unit}`;
  ensureEl("meridianLength").innerHTML = String(rn(eqD * 2));
  ensureEl("meridianLengthFriendly").innerHTML = `${rn(eqD * 2 * distanceScale)} ${unit}`;
  ensureEl("meridianLengthEarth").innerHTML = meridian ? ` = ${rn(meridian / 200)}%🌏` : "";
  ensureEl("mapCoordinates").innerHTML =
    `${lat(mc.latN ?? 0)} ${Math.abs(rn(mc.lonW ?? 0))}°W; ${lat(mc.latS ?? 0)} ${rn(mc.lonE ?? 0)}°E`;

  function toKilometer(v: number): number {
    if (unit === "km") return v;
    if (unit === "mi") return v * 1.60934;
    if (unit === "lg") return v * 4.828;
    if (unit === "vr") return v * 1.0668;
    if (unit === "nmi") return v * 1.852;
    if (unit === "nlg") return v * 5.556;
    return 0; // 0 if distanceUnitInput is a custom unit
  }

  // parse latitude value
  function lat(latitude: number): string {
    return latitude > 0 ? `${Math.abs(rn(latitude))}°N` : `${Math.abs(rn(latitude))}°S`;
  }

  const area = geoGraticule().extent([
    [mc.lonW ?? 0, mc.latN ?? 0],
    [mc.lonE ?? 0, mc.latS ?? 0]
  ]);

  select("#globe")
    .select("#globeArea")
    .attr("d", round(path(area.outline()) ?? "")); // map area
}

// update temperatures on globe (visual-only)
function updateGlobeTemperature(): void {
  const tEq = options.temperatureEquator;
  const tNP = options.temperatureNorthPole;
  const tSP = options.temperatureSouthPole;

  const scale = scaleSequential(interpolateSpectral);
  const getColor = (value: number): string => scale(1 - value);
  const [tMin, tMax] = [-25, 30]; // temperature extremes
  const tDelta = tMax - tMin;

  select("#globe")
    .select("#grad90")
    .attr("stop-color", getColor((tNP - tMin) / tDelta));
  select("#globe")
    .select("#grad60")
    .attr("stop-color", getColor((tEq - ((tEq - tNP) * 2) / 3 - tMin) / tDelta));
  select("#globe")
    .select("#grad30")
    .attr("stop-color", getColor((tEq - ((tEq - tNP) * 1) / 4 - tMin) / tDelta));
  select("#globe")
    .select("#grad0")
    .attr("stop-color", getColor((tEq - tMin) / tDelta));
  select("#globe")
    .select("#grad-30")
    .attr("stop-color", getColor((tEq - ((tEq - tSP) * 1) / 4 - tMin) / tDelta));
  select("#globe")
    .select("#grad-60")
    .attr("stop-color", getColor((tEq - ((tEq - tSP) * 2) / 3 - tMin) / tDelta));
  select("#globe")
    .select("#grad-90")
    .attr("stop-color", getColor((tSP - tMin) / tDelta));
}

function updateWindDirections(): void {
  select("#globe")
    .select("#globeWindArrows")
    .selectAll<SVGPathElement, unknown>("path")
    .each(function (_d, i) {
      const tr = parseTransform(this.getAttribute("transform") ?? "");
      this.setAttribute("transform", `rotate(${options.winds[i]} ${tr[1]} ${tr[2]})`);
    });
}

function handleWindChange(event: Event): void {
  const target = event.target as SVGElement;
  // each arrow is a circle followed by a path; the click can land on either
  const arrow = (target.tagName === "path" ? target : target.nextElementSibling) as SVGPathElement | null;
  if (!arrow?.dataset.tier) return;
  const tier = +arrow.dataset.tier;
  options.winds[tier] = (options.winds[tier] + 45) % 360;
  const tr = parseTransform(arrow.getAttribute("transform") ?? "");
  arrow.setAttribute("transform", `rotate(${options.winds[tier]} ${tr[1]} ${tr[2]})`);
  localStorage.setItem("winds", String(options.winds));

  const mapTiers = range(mapCoordinates.latN ?? 0, mapCoordinates.latS ?? 0, -30).map(c => ((90 - c) / 30) | 0);
  if (ensureEl<HTMLInputElement>("wcAutoChange").checked && mapTiers.includes(tier)) updateWorld();
}

function restoreDefaultWinds(): void {
  const defaultWinds = [225, 45, 225, 315, 135, 315];
  const mapTiers = range(mapCoordinates.latN ?? 0, mapCoordinates.latS ?? 0, -30).map(c => ((90 - c) / 30) | 0);
  const shouldUpdate =
    ensureEl<HTMLInputElement>("wcAutoChange").checked && mapTiers.some(t => options.winds[t] !== defaultWinds[t]);
  options.winds = defaultWinds;
  updateWindDirections();
  if (shouldUpdate) updateWorld();
}

function applyWorldPreset(size: number, latitude: number): void {
  options.mapSize = size;
  options.latitude = latitude;
  updateInputValues();
  lockOption("mapSize");
  lockOption("latitude");
  if (ensureEl<HTMLInputElement>("wcAutoChange").checked) updateWorld();
}

export const WorldConfigurator = { open };


========================================
FILE: ./components/tools.ts
========================================

import { refreshEditors } from "@/components/dialog/dialog-helpers";
import { Layers } from "@/components/layers";
import { tip } from "@/components/tooltips";
import { Controllers } from "@/controllers";
import { Population } from "@/generators/population-generator";
import { unfog } from "@/renderers/overlays/fogging";
import { ensureEl, gauss, isCtrlClick } from "@/utils";

ensureEl("toolsContent").addEventListener("click", event => {
  if (customization) return tip("Please exit the customization mode first", false, "error");
  if (!(event instanceof MouseEvent) || !(event.target instanceof HTMLElement)) return;
  if (!["BUTTON", "I"].includes(event.target.tagName)) return;

  const buttonId = event.target.id;
  const parentId = event.target.parentElement?.id;
  if (parentId === "regenerateFeature") confirmRegeneration(event, buttonId);
  else if (buttonId === "editHeightmapButton") void Controllers.HeightmapEditor.open();
  else if (buttonId === "editBiomesButton") void Controllers.BiomesEditor.open();
  else if (
    buttonId === "editAeroHydroButton" ||
    buttonId === "editOceanCurrentsButton" ||
    buttonId === "editWindsButton"
  )
    void (Controllers as any).AeroHydroEditor?.open();
  else if (buttonId === "editStatesButton") void Controllers.StatesEditor.open();
  else if (buttonId === "editProvincesButton") void Controllers.ProvincesEditor.open();
  else if (buttonId === "editDiplomacyButton") void Controllers.DiplomacyEditor.open();
  else if (buttonId === "editCoastlineSettings") void Controllers.CoastlineEditor.open();
  else if (buttonId === "editTradeAnimationButton") void Controllers.TradeAnimationEditor.open();
  else if (buttonId === "editCulturesButton") void Controllers.CulturesEditor.open();
  else if (buttonId === "editReligions") void Controllers.ReligionsEditor.open();
  else if (buttonId === "editGoods") void Controllers.GoodsEditor.open();
  else if (buttonId === "editEmblemButton") void Controllers.EmblemsEditor.openDefault();
  else if (buttonId === "editNamesBaseButton") void Controllers.NamesbaseEditor.open();
  else if (buttonId === "editUnitsButton") void Controllers.UnitsEditor.open();
  else if (buttonId === "editMeasurersButton") void Controllers.MeasurersEditor.open();
  else if (buttonId === "editNotesButton") void Controllers.NotesEditor.open();
  else if (buttonId === "editZonesButton") void Controllers.ZonesEditor.open();
  else if (buttonId === "overviewChartsButton") void Controllers.ChartsOverview.open();
  else if (buttonId === "overviewBurgsButton") void Controllers.BurgsOverview.open();
  else if (buttonId === "overviewRoutesButton") void Controllers.RoutesOverview.open();
  else if (buttonId === "overviewRiversButton") void Controllers.RiversOverview.open();
  else if (buttonId === "overviewMilitaryButton") void Controllers.MilitaryOverview.open();
  else if (buttonId === "overviewLabelsButton") void Controllers.LabelsOverview.open();
  else if (buttonId === "overviewMarkersButton") void Controllers.MarkersOverview.open();
  else if (buttonId === "overviewMarketsButton") void Controllers.MarketsOverview.open();
  else if (buttonId === "overviewCellsButton") void Controllers.CellInfo.open();
  else if (buttonId === "openMinimapButton") void Controllers.Minimap.open();
  else if (buttonId === "configRegenerateMarkers") void Controllers.MarkersSettings.open();
  else if (buttonId === "addBurgTool") void Controllers.BurgCreator.toggle();
  else if (buttonId === "addLabel") void Controllers.LabelCreator.toggle();
  else if (buttonId === "addRiver") void Controllers.RiverAutoCreator.toggle();
  else if (buttonId === "addRoute") void Controllers.RouteCreator.open();
  else if (buttonId === "addMarker") void Controllers.MarkerCreator.toggle();
  else if (buttonId === "openSubmapTool") void Controllers.SubmapTool.open();
  else if (buttonId === "openTransformTool") void Controllers.TransformTool.open();
});

function confirmRegeneration(event: MouseEvent, button: string): void {
  if (sessionStorage.getItem("regenerateFeatureDontAsk")) {
    regenerate(event, button);
    return;
  }

  const message = ensureEl("alertMessage");
  message.innerHTML =
    "Regeneration will remove all the custom changes for the element.<br /><br />Are you sure you want to proceed?";
  $("#alert").dialog({
    resizable: false,
    title: "Regenerate element",
    buttons: {
      Proceed: function () {
        regenerate(event, button);
        $(this).dialog("close");
      },
      Cancel: function () {
        $(this).dialog("close");
      }
    },
    open: function () {
      const checkbox =
        '<span><input id="dontAsk" class="checkbox" type="checkbox"><label for="dontAsk" class="checkbox-label dontAsk"><i>do not ask again</i></label><span>';
      this.parentElement.querySelector(".ui-dialog-buttonpane")?.insertAdjacentHTML("afterbegin", checkbox);
    },
    close: function () {
      const checkbox = this.parentElement.querySelector(".checkbox") as HTMLInputElement | null;
      if (checkbox?.checked) sessionStorage.setItem("regenerateFeatureDontAsk", "true");
      $(this).dialog("destroy");
    }
  });
}

function regenerate(event: MouseEvent, button: string): void {
  if (button === "regenerateStateLabels") regenerateStateLabels();
  else if (button === "regenerateReliefIcons") regenerateReliefIcons();
  else if (button === "regenerateRoutes") regenerateRoutes();
  else if (button === "regenerateRivers") regenerateRivers();
  else if (button === "regeneratePopulation") regeneratePopulation();
  else if (button === "regenerateStates") regenerateStates();
  else if (button === "regenerateProvinces") regenerateProvinces();
  else if (button === "regenerateBurgs") regenerateBurgs();
  else if (button === "regenerateGoods") regenerateGoods();
  else if (button === "regenerateMarkets") regenerateMarkets();
  else if (button === "regenerateEconomy") regenerateEconomy();
  else if (button === "regenerateProduction") regenerateProduction();
  else if (button === "regenerateEmblems") regenerateEmblems();
  else if (button === "regenerateReligions") regenerateReligions();
  else if (button === "regenerateCultures") regenerateCultures();
  else if (button === "regenerateMilitary") regenerateMilitary();
  else if (button === "regenerateIce") regenerateIce();
  else if (button === "regenerateMarkers") regenerateMarkers();
  else if (button === "regenerateZones") regenerateZones(event);
  refreshEditors();
}

function regenerateStateLabels(): void {
  for (const state of pack.states) {
    if (!state.i || state.removed) continue;
    if (state.label) delete state.label; // cleanup custom label data to force recalculation of pathPoints
  }
  Layers.draw("labels");
}

function regenerateReliefIcons(): void {
  Relief.generate();
  Layers.draw("relief");
}

function regenerateRoutes(): void {
  Routes.regenerate();
  Layers.draw("routes");
}

function regenerateRivers(): void {
  Rivers.regenerate();
  Layers.draw("rivers");
}

function regeneratePopulation(): void {
  Population.regenerate();
  Layers.draw("population", "goods");
}

function regenerateStates(): void {
  const { warning, error } = States.regenerate();
  if (error) return void tip(error, false, "error");
  if (warning) tip(warning, false, "warn");

  unfog();
  Layers.draw("states", "borders", "provinces", "labels", "burgIcons", "military", "goods", "emblems");
}

function regenerateProvinces(): void {
  Provinces.regenerate();
  unfog();
  Layers.draw("borders", "provinces", "labels", "emblems");
}

function regenerateBurgs(): void {
  Burgs.regenerate();
  Layers.draw("burgIcons", "labels", "routes", "population", "goods", "emblems");
}

function regenerateGoods(): void {
  Goods.regenerate();
  Layers.draw("goods");
}

function regenerateMarkets(): void {
  Markets.regenerate();
  Layers.draw("markets", "goods", "trade");
}

function regenerateEconomy(): void {
  Production.regenerateEconomy();
  Layers.draw("markets", "goods", "trade");
}

function regenerateProduction(): void {
  Production.regenerate();
  Layers.draw("goods", "trade");
}

function regenerateEmblems(): void {
  COA.regenerate();
  Layers.draw("emblems");
}

function regenerateReligions(): void {
  Religions.regenerate();
  Layers.draw("religions", "goods");
}

function regenerateCultures(): void {
  Cultures.regenerate();
  Layers.draw("cultures", "goods");
}

function regenerateMilitary(): void {
  Military.regenerate();
  Layers.draw("military");
}

function regenerateIce(): void {
  Ice.regenerate();
  Layers.draw("ice");
}

function regenerateMarkers(): void {
  Markers.regenerate();
  Layers.draw("markers");
}

function regenerateZones(event: MouseEvent): void {
  function applyZonesRegeneration(multiplier: number): void {
    Zones.regenerate(multiplier);
    refreshEditors();
    Layers.draw("zones", "goods");
  }

  if (!isCtrlClick(event)) {
    applyZonesRegeneration(gauss(1, 0.5, 0.6, 5, 2));
    return;
  }

  const promptForNumber = window.prompt as unknown as (
    message: string,
    options: { default: number; step: number; min: number; max: number },
    callback: (value: number | string) => void
  ) => void;
  promptForNumber("Please provide zones number multiplier", { default: 1, step: 0.01, min: 0, max: 100 }, value =>
    applyZonesRegeneration(Number(value))
  );
}


========================================
FILE: ./components/layers.ts
========================================

// Global layers registry: owns layers list, order, and svg skeleton
import { drawBiomes } from "@/renderers/draw-biomes";
import { drawBorders } from "@/renderers/draw-borders";
import { drawBurgIcons, removeBurgIcons } from "@/renderers/draw-burg-icons";
import { drawCells } from "@/renderers/draw-cells";
import { drawCoastline } from "@/renderers/draw-coastline";
import { drawCoordinates } from "@/renderers/draw-coordinates";
import { drawCultures } from "@/renderers/draw-cultures";
import { drawEmblems } from "@/renderers/draw-emblems";
import { drawGoods } from "@/renderers/draw-goods";
import { drawGrid } from "@/renderers/draw-grid";
import { drawHeightmap } from "@/renderers/draw-heightmap";
import { drawIce } from "@/renderers/draw-ice";
import { drawLakes } from "@/renderers/draw-lakes";
import { drawLandmass } from "@/renderers/draw-landmass";
import { redrawLegend } from "@/renderers/draw-legend";
import { drawMarkers } from "@/renderers/draw-markers";
import { drawMarkets } from "@/renderers/draw-markets";
import { drawMeasurers } from "@/renderers/draw-measurers";
import { drawMilitary } from "@/renderers/draw-military";
import { drawOcean, removeOcean } from "@/renderers/draw-ocean";
import { drawPopulation } from "@/renderers/draw-population";
import { drawPrecipitation, removePrecipitation } from "@/renderers/draw-precipitation";
import { drawProvinces } from "@/renderers/draw-provinces";
import { drawRelief, removeRelief } from "@/renderers/draw-relief-icons";
import { drawReligions } from "@/renderers/draw-religions";
import { drawRivers } from "@/renderers/draw-rivers";
import { drawRoutes, removeRoutes } from "@/renderers/draw-routes";
import { drawScaleBar, removeScaleBar } from "@/renderers/draw-scalebar";
import { drawStates } from "@/renderers/draw-states";
import { drawTemperature } from "@/renderers/draw-temperature";
import { drawTexture } from "@/renderers/draw-texture";
import { drawVignette } from "@/renderers/draw-vignette";
import { drawZones } from "@/renderers/draw-zones";
import { drawLabels, removeLabels } from "@/renderers/labels/labels-renderer";
import { drawFogging } from "@/renderers/overlays/fogging";
import { tradeAnimation } from "@/renderers/trade-animation";
import { createEl, ensureEl, findEl } from "@/utils/nodeUtils";

interface LayerParams<Id extends string = string> {
  id: Id; // canonical identity, persisted in the .map file
  element?: string; // id of the svg group holding the layer content
  parent: "viewbox" | "map"; // id of the svg element the layer group is appended to
  children?: ChildParams[]; // permament elements created inside the group
  attrs?: Record<string, string>; // static attributes applied to the layer group
  permanent?: boolean; // structural layer: on from the start, never turned off and never saved as state
  keepContent?: boolean; // keep the content in the DOM when the layer is turned off
  draw?: (layer: Layer) => void; // renderer function
  erase?: (layer: Layer) => void; // custom teardown, defaults to erasing the content down to the declared children
}

type ChildParams = { id: string; tag: string; attrs?: Record<string, string> };

export interface LayersState {
  order: string[];
  active: string[];
}

export class Layer<Id extends string = string> {
  readonly id: Id;
  readonly elementId: string;
  readonly parent: "viewbox" | "map";
  readonly children: ChildParams[] = [];

  /** the registry reads `params`; consumers use the fields above and `getEl()` */
  constructor(readonly params: LayerParams<Id>) {
    this.id = params.id;
    this.elementId = params.element ?? params.id;
    this.parent = params.parent;
    this.children = params.children ?? [];
  }

  getEl(): SVGGElement {
    return ensureEl<SVGGElement>(this.elementId);
  }
}

export class LayersRegistry<Id extends string = string> {
  private active = new Set<Id>();
  private listeners = new Set<() => void>();

  constructor(private layers: Layer<Id>[]) {
    for (const layer of layers) if (layer.params.permanent) this.active.add(layer.id);
  }

  /** create missing layer groups, order them by registration order and apply the current state */
  init(): void {
    for (const layer of this.layers) {
      const { parent, attrs } = layer.params;

      let group = findEl<SVGGElement>(layer.elementId);
      if (!group) group = createEl<SVGGElement>("g", layer.elementId);
      for (const [name, value] of Object.entries(attrs ?? {})) group.setAttribute(name, value);
      ensureEl(parent).append(group);

      for (const { id, tag, attrs } of layer.children) {
        if (group.querySelector(`#${id}`)) continue;
        group.append(createEl(tag, id, attrs));
      }

      this.setVisible(group, this.active.has(layer.id));
    }
  }

  get all(): readonly Layer<Id>[] {
    return this.layers;
  }

  has(id: string): id is Id {
    return this.layers.some(layer => layer.id === id);
  }

  get(id: Id): Layer<Id> {
    const layer = this.layers.find(layer => layer.id === id);
    if (!layer) throw new Error(`Layer ${id} is not registered`);
    return layer;
  }

  isOn(id: Id): boolean {
    return this.active.has(id);
  }

  /** turn on the layers that are off and draw them */
  show(...ids: Id[]): void {
    const inactiveLayers = ids.filter(id => !this.active.has(id));
    if (!inactiveLayers.length) return;

    this.change(inactiveLayers, true);
    this.draw(...inactiveLayers);
    this.emit();
  }

  /** turn off the layers that are on; a permanent layer has no off state and is ignored */
  hide(...ids: Id[]): void {
    const activeLayers = ids.filter(id => this.active.has(id) && !this.get(id).params.permanent);
    if (!activeLayers.length) return;

    this.change(activeLayers, false);
    this.emit();
  }

  toggle(id: Id): void {
    this.active.has(id) ? this.hide(id) : this.show(id);
  }

  /* Turn on the listed layers and turn off every other user-controlled one */
  set(ids: readonly string[]): void {
    const known = this.layers.filter(layer => ids.includes(layer.id)).map(layer => layer.id);
    const drawn = known.filter(id => !this.active.has(id));
    const hidden = this.layers
      .filter(layer => !layer.params.permanent && !known.includes(layer.id) && this.active.has(layer.id))
      .map(layer => layer.id);

    this.change(hidden, false);
    this.change(drawn, true);
    this.draw(...drawn);
    this.emit();
  }

  /** draw the listed layers that are ON, always in layer order */
  draw(...ids: Id[]): void {
    for (const layer of this.layers) {
      if (ids.includes(layer.id) && this.active.has(layer.id)) layer.params.draw?.(layer);
    }
  }

  drawAll(): void {
    this.draw(...this.layers.map(layer => layer.id));
  }

  eraseAll(): void {
    for (const layer of this.layers) {
      if (layer.parent !== "viewbox") continue;
      if (layer.params.erase) layer.params.erase(layer);
      else this.eraseContent(layer);
    }
  }

  move(id: Id, before?: Id): void {
    if (before === id) return; // cannot be moved before itself
    const layer = this.get(id);
    const target = before ? this.get(before) : undefined;
    this.layers.splice(this.layers.indexOf(layer), 1);

    const isSibling = (other: Layer<Id>) => other.parent === layer.parent;
    const index = target && isSibling(target) ? this.layers.indexOf(target) : this.layers.findLastIndex(isSibling) + 1;
    this.layers.splice(index, 0, layer);

    this.init();
    this.emit();
  }

  get state(): LayersState {
    return {
      order: this.layers.map(layer => layer.id),
      active: this.layers.filter(layer => this.active.has(layer.id) && !layer.params.permanent).map(layer => layer.id)
    };
  }

  /** apply stored state: the content is already in the DOM, so nothing is drawn or erased */
  restore({ order, active }: LayersState): void {
    const ranks = new Map<string, number>();
    let previous = -1;
    for (const layer of this.layers) {
      const index = order.indexOf(layer.id);
      previous = index === -1 ? previous + 1e-3 : index;
      ranks.set(layer.id, previous);
    }

    this.layers.sort((a, b) => ranks.get(a.id)! - ranks.get(b.id)!);
    this.active = new Set(
      this.layers.filter(layer => layer.params.permanent || active.includes(layer.id)).map(layer => layer.id)
    );
    this.init();
    this.emit();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** flip the state and the visibility of the given layers, in layer order */
  private change(ids: readonly Id[], on: boolean): void {
    for (const layer of this.layers) {
      if (!ids.includes(layer.id)) continue;

      on ? this.active.add(layer.id) : this.active.delete(layer.id);
      this.setVisible(layer.getEl(), on);

      if (on) continue;
      if (layer.params.erase) layer.params.erase(layer);
      else if (!layer.params.keepContent) this.eraseContent(layer);
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  /** default teardown: drop the content, keeping the declared skeleton */
  private eraseContent(layer: Layer<Id>): void {
    const declared = layer.children.map(child => child.id);
    for (const child of Array.from(layer.getEl().children)) {
      if (declared.includes(child.id)) child.replaceChildren();
      else child.remove();
    }
  }

  /** write visibility, dropping the style attribute when it carries nothing else: keeps the saved svg clean */
  private setVisible(element: SVGGElement, visible: boolean): void {
    element.style.display = visible ? "" : "none";
    if (!element.getAttribute("style")) element.removeAttribute("style");
  }
}

// this order is the z-order, the init order and the draw order
const mapLayers = [
  new Layer({
    id: "ocean",
    parent: "viewbox",
    children: ["oceanLayers", "oceanPattern"].map(id => ({ id, tag: "g" })),
    permanent: true,
    draw: drawOcean,
    erase: removeOcean
  }),
  new Layer({ id: "landmass", parent: "viewbox", permanent: true, keepContent: true, draw: drawLandmass }),
  new Layer({ id: "texture", element: "texture", parent: "viewbox", draw: drawTexture }),
  new Layer({
    id: "heightmap",
    element: "terrs",
    parent: "viewbox",
    children: ["oceanHeights", "landHeights"].map(id => ({ id, tag: "g" })),
    draw: drawHeightmap
  }),
  new Layer({
    id: "lakes",
    parent: "viewbox",
    children: ["freshwater", "salt", "sinkhole", "frozen", "lava", "dry"].map(id => ({ id, tag: "g" })),
    keepContent: true,
    draw: drawLakes
  }),
  new Layer({ id: "biomes", parent: "viewbox", draw: drawBiomes }),
  new Layer({ id: "cells", parent: "viewbox", draw: drawCells }),
  new Layer({ id: "grid", element: "gridOverlay", parent: "viewbox", draw: drawGrid }),
  new Layer({ id: "coordinates", parent: "viewbox", draw: drawCoordinates }),
  new Layer({
    id: "compass",
    parent: "viewbox",
    children: [{ id: "compassRose", tag: "use", attrs: { href: "#defs-compass-rose" } }]
  }),
  new Layer({ id: "rivers", parent: "viewbox", draw: drawRivers }),
  new Layer({ id: "relief", element: "terrain", parent: "viewbox", draw: drawRelief, erase: removeRelief }),
  new Layer({ id: "religions", element: "relig", parent: "viewbox", draw: drawReligions }),
  new Layer({ id: "cultures", element: "cults", parent: "viewbox", draw: drawCultures }),
  new Layer({
    id: "states",
    element: "regions",
    parent: "viewbox",
    children: ["statesBody", "statesHalo"].map(id => ({ id, tag: "g" })),
    draw: drawStates
  }),
  new Layer({ id: "provinces", element: "provs", parent: "viewbox", draw: drawProvinces }),
  new Layer({ id: "zones", parent: "viewbox", draw: drawZones }),
  new Layer({
    id: "borders",
    parent: "viewbox",
    children: ["stateBorders", "provinceBorders"].map(id => ({ id, tag: "g" })),
    draw: drawBorders
  }),
  new Layer({
    id: "routes",
    parent: "viewbox",
    children: ["roads", "trails", "searoutes"].map(id => ({ id, tag: "g" })),
    draw: drawRoutes,
    erase: removeRoutes
  }),
  new Layer({ id: "temperature", parent: "viewbox", draw: drawTemperature }),
  new Layer({
    id: "coastline",
    parent: "viewbox",
    children: ["sea_island", "lake_island"].map(id => ({ id, tag: "g" })),
    permanent: true,
    keepContent: true,
    draw: drawCoastline
  }),
  new Layer({ id: "ice", parent: "viewbox", draw: drawIce }),
  new Layer({
    id: "goods",
    parent: "viewbox",
    children: ["goodsCells", "goodsIcons", "goodsBurgs"].map(id => ({ id, tag: "g" })),
    draw: drawGoods
  }),
  new Layer({ id: "markets", parent: "viewbox", draw: drawMarkets }),
  new Layer({
    id: "trade",
    element: "tradeAnimation",
    parent: "viewbox",
    keepContent: true,
    draw: () => tradeAnimation.start(),
    erase: () => tradeAnimation.stop()
  }),
  new Layer({
    id: "precipitation",
    element: "prec",
    parent: "viewbox",
    draw: drawPrecipitation,
    erase: removePrecipitation
  }),
  new Layer({
    id: "population",
    parent: "viewbox",
    children: ["rural", "urban"].map(id => ({ id, tag: "g" })),
    draw: drawPopulation
  }),
  new Layer({
    id: "emblems",
    parent: "viewbox",
    children: ["burgEmblems", "provinceEmblems", "stateEmblems"].map(id => ({ id, tag: "g" })),
    keepContent: true,
    draw: drawEmblems
  }),
  new Layer({
    id: "burgIcons",
    element: "icons",
    parent: "viewbox",
    children: ["burgIcons", "anchors"].map(id => ({ id, tag: "g" })),
    draw: drawBurgIcons,
    erase: removeBurgIcons
  }),
  new Layer({
    id: "labels",
    parent: "viewbox",
    attrs: { "font-size": "100px" },
    draw: drawLabels,
    erase: removeLabels
  }),
  new Layer({ id: "military", element: "armies", parent: "viewbox", draw: drawMilitary }),
  new Layer({ id: "markers", parent: "viewbox", draw: drawMarkers }),
  new Layer({ id: "fogging", parent: "viewbox", attrs: { mask: "url(#fog)" }, permanent: true, draw: drawFogging }),
  new Layer({ id: "rulers", element: "ruler", parent: "viewbox", draw: drawMeasurers }),
  new Layer({ id: "debug", parent: "viewbox", permanent: true, keepContent: true }),
  new Layer({ id: "scaleBar", parent: "map", draw: () => drawScaleBar(), erase: removeScaleBar }),
  new Layer({
    id: "vignette",
    parent: "map",
    attrs: { mask: "url(#vignette-mask)" },
    keepContent: true,
    draw: drawVignette
  }),
  new Layer({ id: "legend", parent: "map", permanent: true, keepContent: true, draw: redrawLegend })
];

export type LayerId = (typeof mapLayers)[number]["id"];

declare global {
  var Layers: LayersRegistry<LayerId>;
}

// biome-ignore lint/suspicious/noRedeclare: legacy seam for public/modules/**/*.js
export const Layers = new LayersRegistry(mapLayers);

window.Layers = Layers;


========================================
FILE: ./renderers/draw-ocean.ts
========================================

import { curveBasisClosed, line } from "d3";
import { Ocean } from "@/generators/ocean-generator";
import { ensureEl, rn, round } from "@/utils";

/** the ocean outline rings, stacked from the coast outwards so the overlap deepens the shade */
export function drawOcean(): void {
  const oceanLayers = ensureEl<SVGGElement>("oceanLayers");
  removeOcean();

  const limits = Ocean.getLimits(oceanLayers.getAttribute("layers") ?? "");
  if (!limits.length) return;

  TIME && console.time("drawOcean");

  const opacity = rn(0.4 / limits.length, 2);
  const lineGen = line().curve(curveBasisClosed);
  const paths = Ocean.generate(limits)
    .map(({ rings }) => rings.map(ring => round(lineGen(ring) || "")).join(""))
    .filter(Boolean)
    .map(path => /* html */ `<path d="${path}" fill="#ecf2f9" fill-opacity="${opacity}"></path>`);

  oceanLayers.insertAdjacentHTML("beforeend", paths.join(""));

  TIME && console.timeEnd("drawOcean");
}

/** drop the rings, keeping #oceanBase: the base rect is created once, at startup */
export function removeOcean(): void {
  for (const path of Array.from(document.querySelectorAll("#oceanLayers path"))) path.remove();
}


========================================
FILE: ./renderers/draw-temperature.ts
========================================

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
import { connectVertices, convertTemperature, ensureEl, round } from "../utils";

const temperatureRenderer = (): void => {
  TIME && console.time("drawTemperature");

  select("#temperature").selectAll("*").remove();
  const lineGen = line<[number, number]>().curve(curveBasisClosed);
  const scheme = scaleSequential(interpolateSpectral);

  const [tMin, tMax] = [-50, 50]; // supported temperature extremes
  const delta = tMax - tMin;

  const { cells, vertices } = grid;
  const n = cells.i.length;

  const checkedCells = new Uint8Array(n);
  const addToChecked = (cellId: number) => {
    checkedCells[cellId] = 1;
  };

  const minTemp = Number(min(cells.temp)) || 0;
  const maxTemp = Number(max(cells.temp)) || 0;
  const step = Math.max(Math.round(Math.abs(minTemp - maxTemp) / 5), 1);

  const isolines = range(minTemp + step, maxTemp, step);
  const chains: [number, [number, number][]][] = [];
  const labels: [number, number, number][] = []; // store label coordinates

  for (const cellId of cells.i) {
    const t = cells.temp[cellId];
    if (checkedCells[cellId] || !isolines.includes(t)) continue;

    const startingVertex = findStart(cellId, t);
    if (!startingVertex) continue;
    checkedCells[cellId] = 1;

    const ofSameType = (cellId: number) => cells.temp[cellId] >= t;
    const chain = connectVertices({
      vertices,
      startingVertex,
      ofSameType,
      addToChecked
    });
    const relaxed = chain.filter((v: number, i: number) => i % 4 === 0 || vertices.c[v].some((c: number) => c >= n));
    if (relaxed.length < 6) continue;

    const points: [number, number][] = relaxed.map((v: number) => vertices.p[v]);
    chains.push([t, points]);
    addLabel(points, t);
  }

  // min temp isoline covers all graph
  select("#temperature")
    .append("path")
    .attr("d", `M0,0 h${graphWidth} v${graphHeight} h${-graphWidth} Z`)
    .attr("fill", scheme(1 - (minTemp - tMin) / delta))
    .attr("stroke", "none");

  for (const t of isolines) {
    const path = chains
      .filter(c => c[0] === t)
      .map(c => round(lineGen(c[1]) || ""))
      .join("");
    if (!path) continue;
    const fill = scheme(1 - (t - tMin) / delta);
    const stroke = color(fill)!.darker(0.2);
    select("#temperature").append("path").attr("d", path).attr("fill", fill).attr("stroke", stroke.toString());
  }

  const scale = (ensureEl("temperatureScale") as HTMLSelectElement).value as Parameters<typeof convertTemperature>[1];

  const tempLabels = select("#temperature").append("g").attr("id", "tempLabels").attr("fill-opacity", 1);
  tempLabels
    .selectAll("text")
    .data(labels)
    .enter()
    .append("text")
    .attr("x", d => d[0])
    .attr("y", d => d[1])
    .text(d => convertTemperature(d[2], scale));

  // find cell with temp < isotherm and find vertex to start path detection
  function findStart(i: number, t: number): number | undefined {
    if (cells.b[i]) return cells.v[i].find((v: number) => vertices.c[v].some((c: number) => c >= n)); // map border cell
    return cells.v[i][cells.c[i].findIndex((c: number) => cells.temp[c] < t || !cells.temp[c])];
  }

  function addLabel(points: [number, number][], t: number): void {
    const xCenter = svgWidth / 2;

    // add label on isoline top center
    const tcIndex = leastIndex(
      points,
      (a: [number, number], b: [number, number]) =>
        a[1] - b[1] + (Math.abs(a[0] - xCenter) - Math.abs(b[0] - xCenter)) / 2
    );
    const tc = points[tcIndex!];
    pushLabel(tc[0], tc[1], t);

    // add label on isoline bottom center
    if (points.length > 20) {
      const bcIndex = leastIndex(
        points,
        (a: [number, number], b: [number, number]) =>
          b[1] - a[1] + (Math.abs(a[0] - xCenter) - Math.abs(b[0] - xCenter)) / 2
      );
      const bc = points[bcIndex!];
      const dist2 = (tc[1] - bc[1]) ** 2 + (tc[0] - bc[0]) ** 2; // square distance between this and top point
      if (dist2 > 100) pushLabel(bc[0], bc[1], t);
    }
  }

  function pushLabel(x: number, y: number, t: number): void {
    if (x < 20 || x > svgWidth - 20) return;
    if (y < 20 || y > svgHeight - 20) return;
    labels.push([x, y, t]);
  }

  TIME && console.timeEnd("drawTemperature");
};

export { temperatureRenderer as drawTemperature };


========================================
FILE: ./renderers/draw-rivers.ts
========================================

import { ensureEl } from "@/utils";

export function drawRivers(): void {
  TIME && console.time("drawRivers");

  const riverPaths = pack.rivers.map(({ cells, points, i, widthFactor, sourceWidth }) => {
    if (!cells || cells.length < 2) return "";

    if (points && points.length !== cells.length) {
      ERROR &&
        console.error(`River ${i} has ${cells.length} cells, but only ${points.length} points. Resetting points data`);
      points = undefined;
    }

    const meanderedPoints = Rivers.addMeandering(cells, points);
    return /* html */ `<path id="river${i}" d="${Rivers.getRiverPath(meanderedPoints, widthFactor, sourceWidth)}"/>`;
  });

  ensureEl("rivers").innerHTML = riverPaths.join("");

  TIME && console.timeEnd("drawRivers");
}


========================================
FILE: ./renderers/draw-precipitation.ts
========================================

import { easeSinIn, select, transition } from "d3";
import { ensureEl, rn } from "@/utils";

export function drawPrecipitation(): void {
  TIME && console.time("drawPrecipitation");
  const { cells, points } = grid;

  const prec = select(ensureEl<SVGGElement>("prec"));
  prec.selectAll("circle").remove();

  const show = transition().duration(800).ease(easeSinIn);
  prec.selectAll("text").attr("opacity", 0).transition(show).attr("opacity", 1);

  const cellsNumberModifier = (+ensureEl<HTMLInputElement>("pointsInput").dataset.cells! / 10000) ** 0.25;
  const data = Array.from(cells.i as ArrayLike<number>).filter(i => cells.h[i] >= 20 && cells.prec[i]);
  const getRadius = (precipitation: number) => rn(Math.sqrt(precipitation / 4) / cellsNumberModifier, 2);

  prec
    .selectAll("circle")
    .data(data)
    .enter()
    .append("circle")
    .attr("cx", cellId => points[cellId][0])
    .attr("cy", cellId => points[cellId][1])
    .attr("r", 0)
    .transition(show)
    .attr("r", cellId => getRadius(cells.prec[cellId]));

  TIME && console.timeEnd("drawPrecipitation");
}

/** drop the circles, keeping #wind: the wind direction arrows are written once, at map generation */
export function removePrecipitation(): void {
  select(ensureEl<SVGGElement>("prec")).selectAll("circle").remove();
}


========================================
FILE: ./renderers/draw-lakes.ts
========================================

import type { Layer } from "@/components/layers";

export function drawLakes(layer: Layer): void {
  const uses: Record<string, string[]> = {};

  for (const feature of pack.features) {
    if (!feature || feature.type !== "lake") continue;

    const group = feature.group || "freshwater";
    if (!uses[group]) uses[group] = [];
    uses[group].push(`<use href="#feature_${feature.i}" data-f="${feature.i}"></use>`);
  }

  for (const group of Array.from(layer.getEl().children)) group.innerHTML = uses[group.id]?.join("") || "";
}


========================================
FILE: ./generators/ocean-generator.ts
========================================

import { clipPoly } from "@/utils";

/**
 * Ocean outlines: closed rings traced around the coast at a given distance from it. `t` is the
 * distance-from-coast marker held in grid.cells.t, negative for water: -1 is the ring hugging the
 * coast, -2 the one behind it, and so on down to -9
 */
export interface OceanOutline {
  t: number;
  rings: [number, number][][];
}

class OceanModule {
  /** read the distances the `layers` attribute asks for: a preset list or none */
  getLimits(outline: string): number[] {
    if (!outline || outline === "none") return [];
    return outline.split(",").map(Number).filter(Boolean);
  }

  /** trace the ocean rings for the requested distances, clipped to the map */
  generate(limits: number[]): OceanOutline[] {
    TIME && console.time("generateOcean");

    const { cells, vertices } = grid;
    const pointsN = cells.i.length;
    const used = new Uint8Array(pointsN); // cells already covered by a traced ring
    const outlines = new Map<number, [number, number][][]>(limits.map(t => [t, []]));

    for (const i of cells.i) {
      const t = cells.t[i];
      if (t > 0 || used[i] || !outlines.has(t)) continue;

      const start = findStart(i, t);
      if (!start) continue;
      used[i] = 1;

      const chain = connectVertices(start, t);
      if (chain.length < 4) continue;

      // keep every n-th point, n growing with the distance from the coast, but never drop a border vertex
      const relax = 1 + t * -2;
      const relaxed = chain.filter((v, index) => !(index % relax) || vertices.c[v].some((c: number) => c >= pointsN));
      if (relaxed.length < 4) continue;

      const ring = clipPoly(
        relaxed.map(v => vertices.p[v]),
        graphWidth,
        graphHeight
      );
      outlines.get(t)!.push(ring);
    }

    TIME && console.timeEnd("generateOcean");

    // in limits order, so the renderer stacks the rings from the coast outwards
    return limits.map(t => ({ t, rings: outlines.get(t)! }));

    /** find the vertex of cell `i` to start tracing from: a map border one, or one facing shallower water */
    function findStart(i: number, t: number): number | undefined {
      if (cells.b[i]) return cells.v[i].find((v: number) => vertices.c[v].some((c: number) => c >= pointsN));
      return cells.v[i][cells.c[i].findIndex((c: number) => cells.t[c] < t || !cells.t[c])];
    }

    /** walk the border of the `t` area from `start` back to itself, collecting the vertices */
    function connectVertices(start: number, t: number): number[] {
      const chain: number[] = [];

      for (let i = 0, current = start; i === 0 || (current !== start && i < 10000); i++) {
        const prev = chain[chain.length - 1];
        chain.push(current);

        const c = vertices.c[current]; // cells adjacent to the vertex
        for (const cell of c) if (cells.t[cell] === t) used[cell] = 1;

        const v = vertices.v[current]; // neighbouring vertices
        const c0 = !cells.t[c[0]] || cells.t[c[0]] === t - 1;
        const c1 = !cells.t[c[1]] || cells.t[c[1]] === t - 1;
        const c2 = !cells.t[c[2]] || cells.t[c[2]] === t - 1;
        if (v[0] !== undefined && v[0] !== prev && c0 !== c1) current = v[0];
        else if (v[1] !== undefined && v[1] !== prev && c1 !== c2) current = v[1];
        else if (v[2] !== undefined && v[2] !== prev && c0 !== c2) current = v[2];

        if (current === chain[chain.length - 1]) {
          ERROR && console.error("Next vertex is not found");
          break;
        }
      }

      chain.push(chain[0]); // close the ring
      return chain;
    }
  }
}

export const Ocean = new OceanModule();


========================================
FILE: ./generators/features.ts
========================================

import Alea from "alea";
import { polygonArea } from "d3";
import {
  clipPoly,
  connectVertices,
  createTypedArray,
  distanceSquared,
  isLand,
  isWater,
  rn,
  TYPED_ARRAY_MAX
} from "../utils";

declare global {
  var Features: FeatureModule;
}

type FeatureType = "ocean" | "lake" | "island";

/* Pack features interface */
export interface Feature {
  i: number;
  type: FeatureType;
  land: boolean;
  border: boolean;
  cells: number;
  firstCell: number;
  vertices: number[];
  area: number;
  shoreline: number[];
  height: number;
  group: string;
  temp: number;
  flux: number;
  evaporation: number;
  name: string;

  // River related
  inlets?: number[];
  outlet?: number;
  river?: number;
  enteringFlux?: number;
  closed?: boolean;
  outCell?: number;
}

export interface GridFeature {
  i: number;
  land: boolean;
  border: boolean;
  type: FeatureType;
}

export const NON_NAVIGABLE_LAKE_GROUPS = new Set(["dry", "frozen", "lava"]);

class FeatureModule {
  private DEEPER_LAND = 3;
  private LANDLOCKED = 2;
  private LAND_COAST = 1;
  private UNMARKED = 0;
  private WATER_COAST = -1;
  private DEEP_WATER = -2;

  /**
   * calculate distance to coast for every cell
   */
  private markup({
    distanceField,
    neighbors,
    start,
    increment,
    limit = TYPED_ARRAY_MAX.INT8
  }: {
    distanceField: Int8Array;
    neighbors: number[][];
    start: number;
    increment: number;
    limit?: number;
  }) {
    for (let distance = start, marked = Infinity; marked > 0 && distance !== limit; distance += increment) {
      marked = 0;
      const prevDistance = distance - increment;
      for (let cellId = 0; cellId < neighbors.length; cellId++) {
        if (distanceField[cellId] !== prevDistance) continue;

        for (const neighborId of neighbors[cellId]) {
          if (distanceField[neighborId] !== this.UNMARKED) continue;
          distanceField[neighborId] = distance;
          marked++;
        }
      }
    }
  }

  /**
   * mark Grid features (ocean, lakes, islands) and calculate distance field
   */
  markupGrid() {
    TIME && console.time("markupGrid");
    Math.random = Alea(seed); // get the same result on heightmap edit in Erase mode

    const { h: heights, c: neighbors, b: borderCells, i } = grid.cells;
    const cellsNumber = i.length;
    const distanceField = new Int8Array(cellsNumber); // gird.cells.t
    const featureIds = new Uint16Array(cellsNumber); // gird.cells.f
    const features: GridFeature[] = [];

    const queue = [0];
    for (let featureId = 1; queue[0] !== -1; featureId++) {
      const firstCell = queue[0];
      featureIds[firstCell] = featureId;

      const land = heights[firstCell] >= 20;
      let border = false; // set true if feature touches map edge

      while (queue.length) {
        const cellId = queue.pop() as number;
        if (!border && borderCells[cellId]) border = true;

        for (const neighborId of neighbors[cellId]) {
          const isNeibLand = heights[neighborId] >= 20;

          if (land === isNeibLand && featureIds[neighborId] === this.UNMARKED) {
            featureIds[neighborId] = featureId;
            queue.push(neighborId);
          } else if (land && !isNeibLand) {
            distanceField[cellId] = this.LAND_COAST;
            distanceField[neighborId] = this.WATER_COAST;
          }
        }
      }

      const type = land ? "island" : border ? "ocean" : "lake";
      features.push({ i: featureId, land, border, type });

      queue[0] = featureIds.indexOf(this.UNMARKED); // find unmarked cell
    }

    // markup deep ocean cells
    this.markup({
      distanceField,
      neighbors,
      start: this.DEEP_WATER,
      increment: -1,
      limit: -10
    });
    grid.cells.t = distanceField;
    grid.cells.f = featureIds;
    grid.features = [0, ...features];

    TIME && console.timeEnd("markupGrid");
  }

  /**
   * mark PackedGraph features (oceans, lakes, islands) and calculate distance field
   */
  markupPack() {
    const defineHaven = (cellId: number) => {
      const waterCells = neighbors[cellId].filter((index: number) => isWater(index, pack));
      const distances = waterCells.map((neibCellId: number) => distanceSquared(cells.p[cellId], cells.p[neibCellId]));
      const closest = distances.indexOf(Math.min.apply(Math, distances));

      haven[cellId] = waterCells[closest];
      harbor[cellId] = waterCells.length;
    };

    const getCellsData = (featureType: string, firstCell: number): [number, number[]] => {
      if (featureType === "ocean") return [firstCell, []];

      const getType = (cellId: number) => featureIds[cellId];
      const type = getType(firstCell);
      const ofSameType = (cellId: number) => getType(cellId) === type;
      const ofDifferentType = (cellId: number) => getType(cellId) !== type;

      const startCell = findOnBorderCell(firstCell);
      const featureVertices = getFeatureVertices(startCell);
      return [startCell, featureVertices];

      function findOnBorderCell(firstCell: number) {
        const isOnBorder = (cellId: number) => borderCells[cellId] || neighbors[cellId].some(ofDifferentType);
        if (isOnBorder(firstCell)) return firstCell;

        const startCell = cells.i.filter(ofSameType).find(isOnBorder);
        if (startCell === undefined)
          throw new Error(`Markup: firstCell ${firstCell} is not on the feature or map border`);

        return startCell;
      }

      function getFeatureVertices(startCell: number) {
        const startingVertex = cells.v[startCell].find((v: number) => vertices.c[v].some(ofDifferentType));
        if (startingVertex === undefined) throw new Error(`Markup: startingVertex for cell ${startCell} is not found`);

        return connectVertices({
          vertices,
          startingVertex,
          ofSameType,
          closeRing: false
        });
      }
    };

    const addFeature = ({
      firstCell,
      land,
      border,
      featureId,
      totalCells
    }: {
      firstCell: number;
      land: boolean;
      border: boolean;
      featureId: number;
      totalCells: number;
    }): Feature => {
      const type = land ? "island" : border ? "ocean" : "lake";
      const [startCell, featureVertices] = getCellsData(type, firstCell);
      const points = clipPoly(
        featureVertices.map((vertex: number) => vertices.p[vertex]),
        graphWidth,
        graphHeight
      );
      const area = polygonArea(points); // feature perimiter area
      const absArea = Math.abs(rn(area));

      const feature: Partial<Feature> = {
        i: featureId,
        type,
        land,
        border,
        cells: totalCells,
        firstCell: startCell,
        vertices: featureVertices,
        area: absArea,
        shoreline: [],
        height: 0
      };

      if (type === "lake") {
        if (area > 0) feature.vertices = (feature.vertices as number[]).reverse();
        feature.shoreline = Lakes.defineShoreline(feature as Feature);
        feature.height = Lakes.getHeight(feature as Feature);
      }

      return {
        ...feature
      } as Feature;
    };

    TIME && console.time("markupPack");

    const { cells, vertices } = pack;
    const { c: neighbors, b: borderCells, i } = cells;
    const packCellsNumber = i.length;
    if (!packCellsNumber) return; // no cells -> there is nothing to do

    const distanceField = new Int8Array(packCellsNumber); // pack.cells.t
    const featureIds = new Uint16Array(packCellsNumber); // pack.cells.f
    const haven = createTypedArray({
      maxValue: packCellsNumber,
      length: packCellsNumber
    }); // haven: opposite water cell
    const harbor = new Uint8Array(packCellsNumber); // harbor: number of adjacent water cells
    const features: Feature[] = [];

    const queue = [0];
    for (let featureId = 1; queue[0] !== -1; featureId++) {
      const firstCell = queue[0];
      featureIds[firstCell] = featureId;

      const land = isLand(firstCell, pack);
      let border = Boolean(borderCells[firstCell]); // true if feature touches map border
      let totalCells = 1; // count cells in a feature

      while (queue.length) {
        const cellId = queue.pop() as number;
        if (borderCells[cellId]) border = true;

        for (const neighborId of neighbors[cellId]) {
          const isNeibLand = isLand(neighborId, pack);

          if (land && !isNeibLand) {
            distanceField[cellId] = this.LAND_COAST;
            distanceField[neighborId] = this.WATER_COAST;
            if (!haven[cellId]) defineHaven(cellId);
          } else if (land && isNeibLand) {
            if (distanceField[neighborId] === this.UNMARKED && distanceField[cellId] === this.LAND_COAST)
              distanceField[neighborId] = this.LANDLOCKED;
            else if (distanceField[cellId] === this.UNMARKED && distanceField[neighborId] === this.LAND_COAST)
              distanceField[cellId] = this.LANDLOCKED;
          }

          if (!featureIds[neighborId] && land === isNeibLand) {
            queue.push(neighborId);
            featureIds[neighborId] = featureId;
            totalCells++;
          }
        }
      }

      features.push(addFeature({ firstCell, land, border, featureId, totalCells }));
      queue[0] = featureIds.indexOf(this.UNMARKED); // find unmarked cell
    }

    this.markup({
      distanceField,
      neighbors,
      start: this.DEEPER_LAND,
      increment: 1
    }); // markup pack land
    this.markup({
      distanceField,
      neighbors,
      start: this.DEEP_WATER,
      increment: -1,
      limit: -10
    }); // markup pack water

    pack.cells.t = distanceField;
    pack.cells.f = featureIds;
    pack.cells.haven = haven;
    pack.cells.harbor = harbor;
    pack.features = [0 as unknown as Feature, ...features];
    TIME && console.timeEnd("markupPack");
  }

  /**
   * define feature groups (ocean, sea, gulf, continent, island, isle, freshwater lake, salt lake, etc.)
   */
  defineGroups() {
    const gridCellsNumber = grid.cells.i.length;
    const OCEAN_MIN_SIZE = gridCellsNumber / 25;
    const SEA_MIN_SIZE = gridCellsNumber / 1000;
    const CONTINENT_MIN_SIZE = gridCellsNumber / 10;
    const ISLAND_MIN_SIZE = gridCellsNumber / 1000;

    const defineIslandGroup = (feature: Feature) => {
      const prevFeature = pack.features[pack.cells.f[feature.firstCell - 1]];
      if (prevFeature && prevFeature.type === "lake") return "lake_island";
      if (feature.cells > CONTINENT_MIN_SIZE) return "continent";
      if (feature.cells > ISLAND_MIN_SIZE) return "island";
      return "isle";
    };

    const defineOceanGroup = (feature: Feature) => {
      if (feature.cells > OCEAN_MIN_SIZE) return "ocean";
      if (feature.cells > SEA_MIN_SIZE) return "sea";
      return "gulf";
    };

    const defineLakeGroup = (feature: Feature) => {
      if (feature.temp < -3) return "frozen";
      if (feature.height > 60 && feature.cells < 10 && feature.firstCell % 10 === 0) return "lava";

      if (!feature.inlets && !feature.outlet) {
        if (feature.evaporation > feature.flux * 4) return "dry";
        if (feature.cells < 3 && feature.firstCell % 10 === 0) return "sinkhole";
      }

      if (!feature.outlet && feature.evaporation > feature.flux) return "salt";

      return "freshwater";
    };

    const defineGroup = (feature: Feature) => {
      if (feature.type === "island") return defineIslandGroup(feature);
      if (feature.type === "ocean") return defineOceanGroup(feature);
      if (feature.type === "lake") return defineLakeGroup(feature);
      throw new Error(`Markup: unknown feature type ${feature.type}`);
    };

    for (const feature of pack.features) {
      if (!feature || feature.type === "ocean") continue;

      if (feature.type === "lake") feature.height = Lakes.getHeight(feature);
      feature.group = defineGroup(feature);
    }
  }
}

window.Features = new FeatureModule();


========================================
FILE: ./generators/river-generator.test.ts
========================================

import { beforeEach, describe, expect, it } from "vitest";
import { MIN_NAVIGABLE_FLUX } from "./river-generator";

describe("RiverModule helpers", () => {
  let Rivers: any;

  beforeEach(async () => {
    globalThis.TIME = false;
    globalThis.window = globalThis.window || ({} as any);
    globalThis.pack = {
      cells: { r: [], fl: [], f: [] },
      features: [],
      rivers: []
    } as any;

    await import("./river-generator");
    Rivers = (globalThis as any).Rivers;
  });

  function setCells(cells: { r?: number[]; fl?: number[]; f?: number[] }) {
    globalThis.pack.cells = { r: [], fl: [], f: [], ...cells } as any;
  }

  describe("isNavigable", () => {
    it("returns true when cell has a river and flux meets the threshold", () => {
      setCells({ r: [0, 1, 1], fl: [0, MIN_NAVIGABLE_FLUX, MIN_NAVIGABLE_FLUX + 50] });
      expect(Rivers.isNavigable(1)).toBe(true);
      expect(Rivers.isNavigable(2)).toBe(true);
    });

    it("returns false for cells with no river", () => {
      setCells({ r: [0, 0], fl: [500, 500] });
      expect(Rivers.isNavigable(0)).toBe(false);
    });

    it("returns false for river cells below the threshold", () => {
      setCells({ r: [0, 1], fl: [0, MIN_NAVIGABLE_FLUX - 1] });
      expect(Rivers.isNavigable(1)).toBe(false);
    });
  });

  describe("resolveDrainFeature", () => {
    it("returns the ocean feature id when river drains into the sea", () => {
      // cell 5 is the river-bearing land cell; cell 6 is the sea cell at the mouth
      setCells({ r: [0, 0, 0, 0, 0, 1, 0], f: [0, 0, 0, 0, 0, 0, 2] });
      globalThis.pack.features = [null, null, { i: 2, type: "ocean" }] as any;
      globalThis.pack.rivers = [{ i: 1, cells: [5, 6] }] as any;

      expect(Rivers.resolveDrainFeature(5)).toBe(2);
    });

    it("returns the closed lake feature id when river terminates in a closed lake", () => {
      setCells({ r: [0, 0, 1, 0], f: [0, 0, 0, 3] });
      globalThis.pack.features = [
        null,
        null,
        null,
        { i: 3, type: "lake" } // no outlet => closed
      ] as any;
      globalThis.pack.rivers = [{ i: 1, cells: [2, 3] }] as any;

      expect(Rivers.resolveDrainFeature(2)).toBe(3);
    });

    it("follows lake outlet onward to the final receiving sea", () => {
      // river 1 ends in lake (feature 3, has outlet to river 2); river 2 ends in ocean (feature 4)
      setCells({ r: [0, 1, 0, 2, 0], f: [0, 0, 3, 0, 4] });
      globalThis.pack.features = [null, null, null, { i: 3, type: "lake", outlet: 2 }, { i: 4, type: "ocean" }] as any;
      globalThis.pack.rivers = [
        { i: 1, cells: [1, 2] },
        { i: 2, cells: [3, 4] }
      ] as any;

      expect(Rivers.resolveDrainFeature(1)).toBe(4);
    });

    it("returns null when river leaves the map", () => {
      setCells({ r: [0, 1], f: [0, 0] });
      globalThis.pack.features = [null, null] as any;
      globalThis.pack.rivers = [{ i: 1, cells: [1, -1] }] as any;

      expect(Rivers.resolveDrainFeature(1)).toBeNull();
    });

    it("returns null for a cell with no river", () => {
      setCells({ r: [0, 0] });
      expect(Rivers.resolveDrainFeature(0)).toBeNull();
    });
  });

  describe("resolveLakeDrainFeature", () => {
    it("returns the ocean feature id when the lake outlet chain reaches the sea", () => {
      // lake feature 2 has outlet river 1; river 1 ends in ocean feature 3
      setCells({ r: [0, 1, 0], f: [0, 0, 3] });
      globalThis.pack.features = [null, null, { i: 2, type: "lake", outlet: 1 }, { i: 3, type: "ocean" }] as any;
      globalThis.pack.rivers = [{ i: 1, cells: [1, 2] }] as any;

      expect(Rivers.resolveLakeDrainFeature(2)).toBe(3);
    });

    it("follows a chain through an intermediate open lake to reach the ocean", () => {
      // lake 2 → river 1 → lake 3 (open) → river 2 → ocean 4
      setCells({ r: [0, 1, 0, 2, 0], f: [0, 0, 3, 0, 4] });
      globalThis.pack.features = [
        null,
        null,
        { i: 2, type: "lake", outlet: 1 },
        { i: 3, type: "lake", outlet: 2 },
        { i: 4, type: "ocean" }
      ] as any;
      globalThis.pack.rivers = [
        { i: 1, cells: [1, 2] }, // river 1 drains lake 2 into lake 3
        { i: 2, cells: [3, 4] } // river 2 drains lake 3 into ocean 4
      ] as any;

      expect(Rivers.resolveLakeDrainFeature(2)).toBe(4);
    });

    it("returns the closed downstream lake feature id when the chain terminates there", () => {
      // lake 2 (open) → river 1 → lake 3 (closed, no outlet)
      setCells({ r: [0, 1, 0], f: [0, 0, 3] });
      globalThis.pack.features = [
        null,
        null,
        { i: 2, type: "lake", outlet: 1 },
        { i: 3, type: "lake" } // no outlet — closed
      ] as any;
      globalThis.pack.rivers = [{ i: 1, cells: [1, 2] }] as any;

      expect(Rivers.resolveLakeDrainFeature(2)).toBe(3);
    });

    it("returns null when the outlet river exits the map", () => {
      setCells({ r: [0, 1], f: [0, 0] });
      globalThis.pack.features = [null, null, { i: 2, type: "lake", outlet: 1 }] as any;
      globalThis.pack.rivers = [{ i: 1, cells: [1, -1] }] as any;

      expect(Rivers.resolveLakeDrainFeature(2)).toBeNull();
    });

    it("returns the lake's own feature id when the lake has no outlet (closed lake)", () => {
      globalThis.pack.features = [null, null, { i: 2, type: "lake" }] as any;
      globalThis.pack.rivers = [] as any;

      expect(Rivers.resolveLakeDrainFeature(2)).toBe(2);
    });

    it("returns null for a non-lake feature id", () => {
      globalThis.pack.features = [null, null, { i: 2, type: "ocean" }] as any;
      globalThis.pack.rivers = [] as any;

      expect(Rivers.resolveLakeDrainFeature(2)).toBeNull();
    });

    it("returns null for an unknown feature id", () => {
      globalThis.pack.features = [null] as any;
      globalThis.pack.rivers = [] as any;

      expect(Rivers.resolveLakeDrainFeature(99)).toBeNull();
    });
  });
});


========================================
FILE: ./generators/ice-generator.ts
========================================

import Alea from "alea";
import { min } from "d3";
import { redrawGlacier, redrawIceberg } from "@/renderers/draw-ice";
import { clipPoly, getGridPolygon, getIsolines, lerp, minmax, normalize, P, ra, rand, rn } from "../utils";
import type { Point } from "./voronoi";

declare global {
  var Ice: IceModule;
}

export type Ice = Glacier | Iceberg;

interface Glacier {
  type: "glacier";
  i: number;
  points: Point[];
  offset?: Point;
}

interface Iceberg {
  type: "iceberg";
  i: number;
  points: Point[];
  cellId: number;
  size: number;
  offset?: Point;
}

class IceModule {
  public regenerate(): void {
    this.generate();
  }

  // Generate glaciers and icebergs based on temperature and height
  public generate() {
    this.clear();
    const { cells, features } = grid;
    const { temp, h } = cells;
    Math.random = Alea(seed);

    const ICEBERG_MAX_TEMP = 0;
    const GLACIER_MAX_TEMP = -8;
    const minMaxTemp = min<number>(temp)!;

    // Generate glaciers on cold land
    {
      const type: string = "iceShield";
      const getType = (cellId: number) => (h[cellId] >= 20 && temp[cellId] <= GLACIER_MAX_TEMP ? type : null);
      const isolines = getIsolines(grid, getType, { polygons: true });

      if (isolines[type]?.polygons) {
        isolines[type].polygons.forEach((points: Point[]) => {
          const clipped = clipPoly(points, graphWidth, graphHeight);
          const ice: Glacier = { i: this.getNextId(), points: clipped, type: "glacier" };
          pack.ice.push(ice);
        });
      }
    }

    // Generate icebergs on cold water
    for (const cellId of grid.cells.i) {
      const t = temp[cellId];
      if (h[cellId] >= 20) continue; // no icebergs on land
      if (t > ICEBERG_MAX_TEMP) continue; // too warm: no icebergs
      if (features[cells.f[cellId]].type === "lake") continue; // no icebergs on lakes
      if (P(0.8)) continue; // skip most of eligible cells

      const randomFactor = 0.8 + rand() * 0.4; // random size factor
      let baseSize = (1 - normalize(t, minMaxTemp, 1)) * 0.8; // size: 0 = zero, 1 = full
      if (cells.t[cellId] === -1) baseSize /= 1.3; // coastline: smaller icebergs
      const size = minmax(rn(baseSize * randomFactor, 2), 0.1, 1);

      const [cx, cy] = grid.points[cellId];
      const points = getGridPolygon(cellId, grid).map(([x, y]: Point) => [
        rn(lerp(cx, x, size), 2),
        rn(lerp(cy, y, size), 2)
      ]);

      const ice: Iceberg = { i: this.getNextId(), points, type: "iceberg", cellId, size };
      pack.ice.push(ice);
    }
  }

  // Find next available id for new ice element idealy filling gaps
  private getNextId() {
    if (pack.ice.length === 0) return 0;
    // find gaps in existing ids
    const existingIds = pack.ice.map(e => e.i).sort((a, b) => a - b);
    for (let id = 0; id < existingIds[existingIds.length - 1]; id++) {
      if (!existingIds.includes(id)) return id;
    }
    return existingIds[existingIds.length - 1] + 1;
  }

  private clear() {
    pack.ice = [];
  }

  addIceberg(cellId: number, size: number) {
    const [cx, cy] = grid.points[cellId];
    const points = getGridPolygon(cellId, grid).map(([x, y]: Point) => [
      rn(lerp(cx, x, size), 2),
      rn(lerp(cy, y, size), 2)
    ]);
    const id = this.getNextId();
    const ice: Iceberg = { i: id, points, type: "iceberg", cellId, size };
    pack.ice.push(ice);
    redrawIceberg(id);
  }

  removeIce(id: number) {
    const ice = pack.ice.find(ice => ice.i === id);
    if (ice) {
      const index = pack.ice.indexOf(ice);
      pack.ice.splice(index, 1);
      if (ice.type === "glacier") {
        redrawGlacier(id);
      } else {
        redrawIceberg(id);
      }
    }
  }

  randomizeIcebergShape(id: number) {
    const iceberg = pack.ice.find(ice => ice.i === id);
    if (!iceberg || iceberg.type !== "iceberg") return;

    const cellId = iceberg.cellId;
    const size = iceberg.size;
    const [cx, cy] = grid.points[cellId];

    // Get a different random cell for the polygon template
    const i: number = ra(grid.cells.i);
    const cn: [number, number] = grid.points[i];
    const poly = getGridPolygon(i, grid).map((p: [number, number]) => [p[0] - cn[0], p[1] - cn[1]]);
    const points = poly.map((p: [number, number]) => [rn(cx + p[0] * size, 2), rn(cy + p[1] * size, 2)]);

    iceberg.points = points;
  }

  changeIcebergSize(id: number, newSize: number) {
    const iceberg = pack.ice.find(ice => ice.i === id);
    if (!iceberg || iceberg.type !== "iceberg") return;

    const cellId = iceberg.cellId;
    const [cx, cy] = grid.points[cellId];
    const oldSize = iceberg.size;

    const pairs = iceberg.points;
    const poly = pairs.map(p => [(p[0] - cx) / oldSize, (p[1] - cy) / oldSize]);
    const points = poly.map(p => [rn(cx + p[0] * newSize, 2), rn(cy + p[1] * newSize, 2)] satisfies Point);

    iceberg.points = points;
    iceberg.size = newSize;
  }
}

window.Ice = new IceModule();


========================================
FILE: ./generators/lakes.ts
========================================

import { mean, min } from "d3";
import { ensureEl, isLand, rn, unique } from "../utils";
import type { Feature } from "./features";

declare global {
  var Lakes: LakesModule;
}

export class LakesModule {
  private LAKE_ELEVATION_DELTA = 0.1;

  getHeight(feature: Feature) {
    const heights = pack.cells.h;
    const minShoreHeight = min(feature.shoreline.map(cellId => heights[cellId])) || 20;
    return rn(minShoreHeight - this.LAKE_ELEVATION_DELTA, 2);
  }

  defineNames() {
    pack.features.forEach((feature: Feature) => {
      if (feature.type !== "lake") return;
      feature.name = this.getName(feature);
    });
  }

  getName(feature: Feature): string {
    const landCell = feature.shoreline[0];
    const culture = pack.cells.culture[landCell];
    return Names.getCulture(culture);
  }

  cleanupLakeData = () => {
    for (const feature of pack.features) {
      if (feature.type !== "lake") continue;
      delete feature.river;
      delete feature.enteringFlux;
      delete feature.outCell;
      delete feature.closed;
      feature.height = rn(feature.height, 3);

      const inlets = feature.inlets?.filter(r => pack.rivers.find(river => river.i === r));
      if (!inlets?.length) delete feature.inlets;
      else feature.inlets = inlets;

      const outlet = feature.outlet && pack.rivers.find(river => river.i === feature.outlet);
      if (!outlet) delete feature.outlet;
    }
  };

  defineClimateData(heights: number[] | Uint8Array) {
    const { cells, features } = pack;
    const lakeOutCells = new Uint16Array(cells.i.length);

    const getFlux = (lake: Feature) => {
      return lake.shoreline.reduce((acc, c) => acc + grid.cells.prec[cells.g[c]], 0);
    };

    const getLakeTemp = (lake: Feature) => {
      if (lake.cells < 6) return grid.cells.temp[cells.g[lake.firstCell]];
      return rn(mean(lake.shoreline.map(c => grid.cells.temp[cells.g[c]])) as number, 1);
    };

    const getLakeEvaporation = (lake: Feature) => {
      const height = (lake.height - 18) ** Number(heightExponentInput.value); // height in meters
      const evaporation = ((700 * (lake.temp + 0.006 * height)) / 50 + 75) / (80 - lake.temp); // based on Penman formula, [1-11]
      return rn(evaporation * lake.cells);
    };

    const getLowestShoreCell = (lake: Feature) => {
      return lake.shoreline.reduce((minCell, c) => (heights[c] < heights[minCell] ? c : minCell));
    };

    features.forEach(feature => {
      if (feature.type !== "lake") return;
      feature.flux = getFlux(feature);
      feature.temp = getLakeTemp(feature);
      feature.evaporation = getLakeEvaporation(feature);
      if (feature.closed) return; // no outlet for lakes in depressed areas

      feature.outCell = getLowestShoreCell(feature);
      lakeOutCells[feature.outCell as number] = feature.i;
    });

    return lakeOutCells;
  }

  // check if lake can be potentially open (not in deep depression)
  detectCloseLakes(h: number[] | Uint8Array) {
    const { cells } = pack;
    const ELEVATION_LIMIT = +(ensureEl("lakeElevationLimitOutput") as HTMLInputElement)?.value;

    pack.features.forEach(feature => {
      if (feature.type !== "lake") return;
      delete feature.closed;

      const MAX_ELEVATION = feature.height + ELEVATION_LIMIT;
      if (MAX_ELEVATION > 99) {
        feature.closed = false;
        return;
      }

      let isDeep = true;
      const lowestShorelineCell = feature.shoreline.reduce((minCell, c) => (h[c] < h[minCell] ? c : minCell));
      const queue = [lowestShorelineCell];
      const checked = [];
      checked[lowestShorelineCell] = true;

      while (queue.length && isDeep) {
        const cellId: number = queue.pop() as number;

        for (const neibCellId of cells.c[cellId]) {
          if (checked[neibCellId]) continue;
          if (h[neibCellId] >= MAX_ELEVATION) continue;

          if (h[neibCellId] < 20) {
            const nFeature = pack.features[cells.f[neibCellId]];
            if (nFeature.type === "ocean" || feature.height > nFeature.height) isDeep = false;
          }

          checked[neibCellId] = true;
          queue.push(neibCellId);
        }
      }

      feature.closed = isDeep;
    });
  }

  defineShoreline(feature: Feature) {
    return unique(
      feature.vertices.flatMap(vertexIndex => pack.vertices.c[vertexIndex].filter(index => isLand(index, pack)))
    );
  }
}

window.Lakes = new LakesModule();


========================================
FILE: ./generators/biomes-generator.ts
========================================

import { mean } from "d3";
import { rn } from "../utils";

export interface Biome {
  i: number;
  name: string;
  color: string;
  habitability: number;
  iconsDensity: number;
  icons: string[];
  cost: number;
  removed?: boolean;
}

function getDefaultBiomes(): Biome[] {
  const name = [
    "Marine",
    "Hot desert",
    "Cold desert",
    "Savanna",
    "Grassland",
    "Tropical seasonal forest",
    "Temperate deciduous forest",
    "Tropical rainforest",
    "Temperate rainforest",
    "Taiga",
    "Tundra",
    "Glacier",
    "Wetland"
  ];

  const color = [
    "#466eab",
    "#fbe79f",
    "#b5b887",
    "#d2d082",
    "#c8d68f",
    "#b6d95d",
    "#29bc56",
    "#7dcb35",
    "#409c43",
    "#4b6b32",
    "#96784b",
    "#d5e7eb",
    "#0b9131"
  ];
  const habitability = [0, 4, 10, 22, 30, 50, 100, 80, 90, 12, 4, 0, 12];
  const iconsDensity = [0, 3, 2, 120, 120, 120, 120, 150, 150, 100, 5, 0, 250];
  const weightedIcons: Record<string, number>[] = [
    {},
    { dune: 3, cactus: 6, deadTree: 1 },
    { dune: 9, deadTree: 1 },
    { acacia: 1, grass: 9 },
    { grass: 1 },
    { acacia: 8, palm: 1 },
    { deciduous: 1 },
    { acacia: 5, palm: 3, deciduous: 1, swamp: 1 },
    { deciduous: 6, swamp: 1 },
    { conifer: 1 },
    { grass: 1 },
    {},
    { swamp: 1 }
  ];
  const cost = [10, 200, 150, 60, 50, 70, 70, 80, 90, 200, 1000, 5000, 150];
  const icons = weightedIcons.map(iconWeights =>
    Object.entries(iconWeights).flatMap(([icon, weight]) => Array<string>(weight).fill(icon))
  );

  return name.map((name, i) => ({
    i,
    name,
    color: color[i],
    habitability: habitability[i],
    iconsDensity: iconsDensity[i],
    icons: icons[i],
    cost: cost[i]
  }));
}

// hot ↔ cold [>19°C; <-4°C]; dry ↕ wet
const biomesMatrix = [
  new Uint8Array([1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 10]),
  new Uint8Array([3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 9, 9, 9, 9, 10, 10, 10]),
  new Uint8Array([5, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 9, 9, 9, 9, 9, 10, 10, 10]),
  new Uint8Array([5, 6, 6, 6, 6, 6, 6, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 9, 9, 9, 9, 9, 9, 10, 10, 10]),
  new Uint8Array([7, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 9, 9, 9, 9, 9, 9, 9, 10, 10])
];

declare global {
  var Biomes: BiomesGenerator;
}

class BiomesGenerator {
  private MIN_LAND_HEIGHT = 20;

  getDefault(): Biome[] {
    return getDefaultBiomes();
  }

  generate(): void {
    pack.biomes = this.getDefault();
    this.define();
  }

  define(): void {
    TIME && console.time("defineBiomes");
    if (!pack.biomes?.length) pack.biomes = this.getDefault();

    const { fl: flux, r: riverIds, h: heights, c: neighbors, g: gridReference } = pack.cells;
    const { temp, prec } = grid.cells;
    pack.cells.biome = new Uint8Array(pack.cells.i.length); // biomes array

    const calculateMoisture = (cellId: number) => {
      let moisture = prec[gridReference[cellId]];
      if (riverIds[cellId]) moisture += Math.max(flux[cellId] / 10, 2);

      const moistAround = neighbors[cellId]
        .filter((neibCellId: number) => heights[neibCellId] >= this.MIN_LAND_HEIGHT)
        .map((c: number) => prec[gridReference[c]])
        .concat([moisture]);
      return rn(4 + (mean(moistAround) as number));
    };

    for (let cellId = 0; cellId < heights.length; cellId++) {
      const height = heights[cellId];
      const moisture = height < this.MIN_LAND_HEIGHT ? 0 : calculateMoisture(cellId);
      const temperature = temp[gridReference[cellId]];
      pack.cells.biome[cellId] = this.getId(moisture, temperature, height, Boolean(riverIds[cellId]));
    }

    TIME && console.timeEnd("defineBiomes");
  }

  getId(moisture: number, temperature: number, height: number, hasRiver: boolean) {
    if (height < 20) return 0; // all water cells: marine biome
    if (temperature < -5) return 11; // too cold: permafrost biome
    if (temperature >= 25 && !hasRiver && moisture < 8) return 1; // too hot and dry: hot desert biome
    if (this.isWetland(moisture, temperature, height)) return 12; // too wet: wetland biome

    const moistureBand = Math.min((moisture / 5) | 0, 4); // [0-4]
    const temperatureBand = Math.min(Math.max(20 - temperature, 0), 25); // [0-25]
    return biomesMatrix[moistureBand][temperatureBand];
  }

  private isWetland(moisture: number, temperature: number, height: number) {
    if (temperature <= -2) return false; // too cold
    if (moisture > 40 && height < 25) return true; // near coast
    if (moisture > 24 && height > 24 && height < 60) return true; // off coast
    return false;
  }
}

window.Biomes = new BiomesGenerator();


========================================
FILE: ./generators/resample.ts
========================================

import { mean, quadtree } from "d3";
import { clipPolyline } from "lineclip";
import { Measurers } from "@/generators/measurers-generator";
import type { PackedGraph } from "../types/PackedGraph";
import {
  findAllCellsInRadius,
  findClosestCell,
  generateGrid,
  getPolesOfInaccessibility,
  isWater,
  rn,
  unique
} from "../utils";
import type { River } from "./river-generator";
import type { Point } from "./voronoi";

declare global {}

interface ResamplerProcessOptions {
  projection: (x: number, y: number) => [number, number];
  inverse: (x: number, y: number) => [number, number];
  scale: number;
}

type ParentMapDefinition = {
  grid: any;
  pack: PackedGraph;
  notes: any[];
};

class Resampler {
  private saveRiversData(parentRivers: PackedGraph["rivers"]) {
    return parentRivers.map(river => {
      const meanderedPoints = Rivers.addMeandering(river.cells, river.points);
      return { ...river, meanderedPoints };
    });
  }

  private smoothHeightmap() {
    grid.cells.h.forEach((height: number, newGridCell: number) => {
      const heights = [height, ...grid.cells.c[newGridCell].map((c: number) => grid.cells.h[c])];
      const meanHeight = mean(heights) as number;
      grid.cells.h[newGridCell] = isWater(newGridCell, grid) ? Math.min(meanHeight, 19) : Math.max(meanHeight, 20);
    });
  }

  private resamplePrimaryGridData(
    parentMap: ParentMapDefinition,
    inverse: (x: number, y: number) => [number, number],
    scale: number
  ) {
    grid.cells.h = new Uint8Array(grid.points.length);
    grid.cells.temp = new Int8Array(grid.points.length);
    grid.cells.prec = new Uint8Array(grid.points.length);

    const parentPackQ = quadtree(parentMap.pack.cells.p.map(([x, y], i) => [x, y, i]));
    grid.points.forEach(([x, y]: [number, number], newGridCell: number) => {
      const [parentX, parentY] = inverse(x, y);
      const parentPackCell = parentPackQ.find(parentX, parentY, Infinity)?.[2];
      if (parentPackCell === undefined) return;
      const parentGridCell = parentMap.pack.cells.g[parentPackCell];

      grid.cells.h[newGridCell] = parentMap.grid.cells.h[parentGridCell];
      grid.cells.temp[newGridCell] = parentMap.grid.cells.temp[parentGridCell];
      grid.cells.prec[newGridCell] = parentMap.grid.cells.prec[parentGridCell];
    });

    if (scale >= 2) this.smoothHeightmap();
  }

  private groupCellsByType(graph: PackedGraph) {
    return graph.cells.p.reduce(
      (acc, [x, y], cellId) => {
        const group = isWater(cellId, graph) ? "water" : "land";
        acc[group].push([x, y, cellId]);
        return acc;
      },
      { land: [], water: [] } as Record<string, [number, number, number][]>
    );
  }

  private isInMap(x: number, y: number) {
    return x >= 0 && x <= graphWidth && y >= 0 && y <= graphHeight;
  }

  private restoreCellData(
    parentMap: ParentMapDefinition,
    inverse: (x: number, y: number) => [number, number],
    scale: number
  ) {
    pack.biomes = parentMap.pack.biomes;
    pack.cells.biome = new Uint8Array(pack.cells.i.length);
    pack.cells.fl = new Uint16Array(pack.cells.i.length);
    pack.cells.s = new Int16Array(pack.cells.i.length);
    pack.cells.pop = new Float32Array(pack.cells.i.length);
    pack.cells.culture = new Uint16Array(pack.cells.i.length);
    pack.cells.state = new Uint16Array(pack.cells.i.length);
    pack.cells.burg = new Uint16Array(pack.cells.i.length);
    pack.cells.religion = new Uint16Array(pack.cells.i.length);
    pack.cells.province = new Uint16Array(pack.cells.i.length);
    pack.cells.good = new Uint16Array(pack.cells.i.length);

    const parentPackCellGroups = this.groupCellsByType(parentMap.pack);
    const parentPackLandCellsQuadtree = quadtree(parentPackCellGroups.land);

    for (const newPackCell of pack.cells.i) {
      const [x, y] = inverse(...pack.cells.p[newPackCell]);
      if (isWater(newPackCell, pack)) continue;

      const parentPackCell = parentPackLandCellsQuadtree.find(x, y, Infinity)?.[2];
      if (parentPackCell === undefined) continue;
      const parentCellArea = parentMap.pack.cells.area[parentPackCell];
      // parentCellArea may be 0 for tiny boundary cells truncated by Uint16 storage;
      // fall back to 1 to avoid 0 * Infinity = NaN in cells.pop (Float32Array)
      const areaRatio = pack.cells.area[newPackCell] / (parentCellArea || 1);
      const scaleRatio = areaRatio / scale;

      pack.cells.biome[newPackCell] = parentMap.pack.cells.biome[parentPackCell];
      pack.cells.fl[newPackCell] = parentMap.pack.cells.fl[parentPackCell];
      pack.cells.s[newPackCell] = parentMap.pack.cells.s[parentPackCell] * scaleRatio;
      pack.cells.pop[newPackCell] = parentMap.pack.cells.pop[parentPackCell] * scaleRatio;
      pack.cells.culture[newPackCell] = parentMap.pack.cells.culture[parentPackCell];
      pack.cells.state[newPackCell] = parentMap.pack.cells.state[parentPackCell];
      pack.cells.religion[newPackCell] = parentMap.pack.cells.religion[parentPackCell];
      pack.cells.province[newPackCell] = parentMap.pack.cells.province[parentPackCell];
      pack.cells.good[newPackCell] = parentMap.pack.cells.good?.[parentPackCell] || 0;
    }
  }

  private restoreEconomy(parentMap: ParentMapDefinition) {
    pack.goods = parentMap.pack.goods;

    // Drop markets whose center burg is no longer on the map.
    pack.markets = (parentMap.pack.markets || []).filter(market => {
      const burg = pack.burgs[market.centerBurgId];
      return Boolean(burg && !burg.removed);
    });
    Production.regenerateEconomy();
  }

  private restoreRivers(
    riversData: (River & { meanderedPoints?: [number, number, number][] })[],
    projection: (x: number, y: number) => [number, number],
    scale: number
  ) {
    pack.cells.r = new Uint16Array(pack.cells.i.length);
    pack.cells.conf = new Uint8Array(pack.cells.i.length);

    pack.rivers = riversData
      .map(river => {
        let wasInMap = true;
        const points: Point[] = [];

        river.meanderedPoints?.forEach(([parentX, parentY]) => {
          const [x, y] = projection(parentX, parentY);
          const inMap = this.isInMap(x, y);
          if (inMap || wasInMap) points.push([rn(x, 2), rn(y, 2)]);
          wasInMap = inMap;
        });
        if (points.length < 2) return null;

        const cells = points
          .map(point => findClosestCell(...point, Infinity, pack))
          .filter(cellId => cellId !== undefined);
        cells.forEach(cellId => {
          if (pack.cells.r[cellId]) pack.cells.conf[cellId] = 1;
          pack.cells.r[cellId] = river.i;
        });

        const widthFactor = river.widthFactor * scale;
        delete river.meanderedPoints;
        return {
          ...river,
          cells,
          points,
          source: cells.at(0) as number,
          mouth: cells.at(-2) as number,
          widthFactor
        };
      })
      .filter(river => river !== null);

    pack.rivers.forEach(river => {
      river.parent = Rivers.getParent(river.i);
      river.basin = Rivers.getBasin(river.i);
      river.length = Rivers.getApproximateLength(river.points);
    });
  }

  private restoreCultures(parentMap: ParentMapDefinition, projection: (x: number, y: number) => [number, number]) {
    const validCultures = new Set(pack.cells.culture);
    const culturePoles = getPolesOfInaccessibility(pack, cellId => pack.cells.culture[cellId]);
    pack.cultures = parentMap.pack.cultures.map(culture => {
      if (!culture.i || culture.removed) return culture;
      if (!validCultures.has(culture.i)) return { ...culture, removed: true, lock: false };

      const parentCoords = parentMap.pack.cells.p[culture.center!];
      const [xp, yp] = projection(parentCoords[0], parentCoords[1]);
      const [x, y] = [rn(xp, 2), rn(yp, 2)];
      const [centerX, centerY] = this.isInMap(x, y) ? [x, y] : culturePoles[culture.i];
      const center = findClosestCell(centerX, centerY, Infinity, pack);
      return { ...culture, center };
    });
  }

  private getBurgCoordinates(
    burg: PackedGraph["burgs"][number],
    closestCell: number,
    cell: number,
    xp: number,
    yp: number
  ): Point {
    const haven = pack.cells.haven[cell];
    if (burg.port && haven) return this.getCloseToEdgePoint(cell, haven);

    if (closestCell !== cell) return pack.cells.p[cell];
    return [rn(xp, 2), rn(yp, 2)];
  }

  private getCloseToEdgePoint(cell1: number, cell2: number): Point {
    const { cells, vertices } = pack;

    const [x0, y0] = cells.p[cell1];
    const commonVertices = cells.v[cell1].filter(vertex => vertices.c[vertex].some(cell => cell === cell2));
    const [x1, y1] = vertices.p[commonVertices[0]];
    const [x2, y2] = vertices.p[commonVertices[1]];
    const xEdge = (x1 + x2) / 2;
    const yEdge = (y1 + y2) / 2;

    const x = rn(x0 + 0.95 * (xEdge - x0), 2);
    const y = rn(y0 + 0.95 * (yEdge - y0), 2);

    return [x, y];
  }

  private restoreBurgs(
    parentMap: ParentMapDefinition,
    projection: (x: number, y: number) => [number, number],
    scale: number
  ) {
    const packLandCellsQuadtree = quadtree(this.groupCellsByType(pack).land);
    const findLandCell = (x: number, y: number) => packLandCellsQuadtree.find(x, y, Infinity)?.[2];

    pack.burgs = parentMap.pack.burgs.map(burg => {
      if (!burg.i || burg.removed) return burg;
      burg.population! *= scale; // adjust for populationRate change

      const [xp, yp] = projection(burg.x, burg.y);
      if (!this.isInMap(xp, yp)) return { ...burg, removed: true, lock: false };

      const closestCell = findClosestCell(xp, yp, Infinity, pack) as number;
      const cell = isWater(closestCell, pack) ? (findLandCell(xp, yp) as number) : closestCell;

      if (pack.cells.burg[cell]) {
        WARN && console.warn(`Cell ${cell} already has a burg. Removing burg ${burg.name} (${burg.i})`);
        return { ...burg, removed: true, lock: false };
      }

      pack.cells.burg[cell] = burg.i;
      const [x, y] = this.getBurgCoordinates(burg, closestCell, cell, xp, yp);
      return { ...burg, cell, x, y };
    });
  }

  private restoreStates(parentMap: ParentMapDefinition, projection: (x: number, y: number) => [number, number]) {
    const validStates = new Set(pack.cells.state);
    pack.states = parentMap.pack.states.map(state => {
      if (!state.i || state.removed) return state;
      if (validStates.has(state.i)) return state;
      return { ...state, removed: true, lock: false };
    });

    States.getPoles();

    pack.states = pack.states.map(state => {
      if (!state.i || state.removed) return state;

      const capital = pack.burgs[state.capital];
      const [poleX, poleY] = state.pole as Point;
      state.center = !capital || capital.removed ? findClosestCell(poleX, poleY, Infinity, pack)! : capital.cell;

      const military = state.military!.reduce(
        (acc, regiment) => {
          const [xPos, yPos] = projection(regiment.x, regiment.y);

          if (!this.isInMap(xPos, yPos)) {
            const noteIndex = notes.findIndex(n => n.id === `regiment${state.i}-${regiment.i}`);
            if (noteIndex !== -1) notes.splice(noteIndex, 1);
            return acc;
          }

          const cellCoords = projection(...parentMap.pack.cells.p[regiment.cell]);
          const cell = this.isInMap(...cellCoords) ? findClosestCell(...cellCoords, Infinity, pack)! : state.center;

          const [xBase, yBase] = projection(regiment.bx, regiment.by);
          const [xCell, yCell] = pack.cells.p[cell];

          const name = regiment.name.replace("[relocated] ", "");
          const pos = { x: rn(xPos, 2), y: rn(yPos, 2) };
          const base = this.isInMap(xBase, yBase) ? { bx: rn(xBase, 2), by: rn(yBase, 2) } : { bx: xCell, by: yCell };

          acc.push({ ...regiment, cell, name, ...base, ...pos });
          return acc;
        },
        [] as NonNullable<typeof state.military>
      );

      const neighbors = state.neighbors!.filter(stateId => validStates.has(stateId));
      return { ...state, neighbors, military };
    });
  }

  private restoreRoutes(parentMap: ParentMapDefinition, projection: (x: number, y: number) => [number, number]) {
    pack.routes = parentMap.pack.routes
      .map(route => {
        let wasInMap = true;
        const points: Point[] = [];

        route.points.forEach(([parentX, parentY]) => {
          const [x, y] = projection(parentX, parentY);
          const inMap = this.isInMap(x, y);
          if (inMap || wasInMap) points.push([rn(x, 2), rn(y, 2)]);
          wasInMap = inMap;
        });
        if (points.length < 2) return null;

        const bbox: [number, number, number, number] = [0, 0, graphWidth, graphHeight];
        // @types/lineclip is incorrect - lineclip returns Point[][] (array of line segments), not Point[]
        const clippedSegments = clipPolyline(points, bbox) as unknown as Point[][];
        if (!clippedSegments[0]?.length) return null;
        const clipped = clippedSegments[0].map(
          ([x, y]) => [rn(x, 2), rn(y, 2), findClosestCell(x, y, Infinity, pack) as number] as [number, number, number]
        );
        const firstCell = clipped[0][2];
        const feature = pack.cells.f[firstCell];
        return { ...route, feature, points: clipped };
      })
      .filter(route => route !== null);

    pack.cells.routes = Routes.buildLinks(pack.routes);
  }

  private restoreReligions(parentMap: ParentMapDefinition, projection: (x: number, y: number) => [number, number]) {
    const validReligions = new Set(pack.cells.religion);
    const religionPoles = getPolesOfInaccessibility(pack, cellId => pack.cells.religion[cellId]);

    pack.religions = parentMap.pack.religions.map(religion => {
      if (!religion.i || religion.removed) return religion;
      if (!validReligions.has(religion.i)) return { ...religion, removed: true, lock: false };

      const [xp, yp] = projection(...parentMap.pack.cells.p[religion.center]);
      const [x, y] = [rn(xp, 2), rn(yp, 2)];
      const [centerX, centerY] = this.isInMap(x, y) ? [x, y] : religionPoles[religion.i];
      const center = findClosestCell(centerX, centerY, Infinity, pack) as number;
      return { ...religion, center };
    });
  }

  private restoreProvinces(parentMap: ParentMapDefinition) {
    const validProvinces = new Set(pack.cells.province);
    pack.provinces = parentMap.pack.provinces.map(province => {
      if (!province.i || province.removed) return province;
      if (!validProvinces.has(province.i)) return { ...province, removed: true, lock: false };

      return province;
    });

    Provinces.getPoles();

    pack.provinces.forEach(province => {
      if (!province.i || province.removed) return;
      const capital = pack.burgs[province.burg];
      const [poleX, poleY] = province.pole as Point;
      province.center = !capital?.removed ? capital.cell : findClosestCell(poleX, poleY, Infinity, pack)!;
    });
  }

  private restoreFeatureDetails(parentMap: ParentMapDefinition, inverse: (x: number, y: number) => [number, number]) {
    const parentPackQ = quadtree(parentMap.pack.cells.p.map(([x, y], i) => [x, y, i]));
    pack.features.forEach(feature => {
      if (!feature) return;
      const [x, y] = pack.cells.p[feature.firstCell];
      const [parentX, parentY] = inverse(x, y);
      const parentCell = parentPackQ.find(parentX, parentY, Infinity)?.[2];
      if (parentCell === undefined) return;
      const parentFeature = parentMap.pack.features[parentMap.pack.cells.f[parentCell]];

      if (parentFeature.group) feature.group = parentFeature.group;
      if (parentFeature.name) feature.name = parentFeature.name;
      if (parentFeature.height) feature.height = parentFeature.height;
    });
  }

  private restoreMarkers(parentMap: ParentMapDefinition, projection: (x: number, y: number) => [number, number]) {
    pack.markers = parentMap.pack.markers;
    pack.markers.forEach(marker => {
      const [x, y] = projection(marker.x, marker.y);
      if (!this.isInMap(x, y)) Markers.deleteMarker(marker.i);

      const cell = findClosestCell(x, y, Infinity, pack) as number;
      marker.x = rn(x, 2);
      marker.y = rn(y, 2);
      marker.cell = cell;
    });
  }

  private restoreZones(
    parentMap: ParentMapDefinition,
    projection: (x: number, y: number) => [number, number],
    scale: number
  ) {
    const getSearchRadius = (cellId: number) => Math.sqrt(parentMap.pack.cells.area[cellId] / Math.PI) * scale;

    pack.zones = parentMap.pack.zones.map(zone => {
      const cells = zone.cells.flatMap(cellId => {
        const [newX, newY] = projection(...parentMap.pack.cells.p[cellId]);
        if (!this.isInMap(newX, newY)) return [];
        return findAllCellsInRadius(newX, newY, getSearchRadius(cellId), pack);
      });

      return { ...zone, cells: unique(cells) };
    });
  }

  process(options: ResamplerProcessOptions): void {
    const { projection, inverse, scale } = options;
    const parentMap = {
      grid: structuredClone(grid),
      pack: structuredClone(pack),
      notes: structuredClone(notes)
    };
    const riversData = this.saveRiversData(pack.rivers);

    grid = generateGrid(seed, graphWidth, graphHeight);
    pack = {} as PackedGraph;
    notes = parentMap.notes;

    this.resamplePrimaryGridData(parentMap, inverse, scale);

    Features.markupGrid();
    addLakesInDeepDepressions();
    openNearSeaLakes();

    Layers.draw("ocean");
    calculateMapCoordinates();
    generateAeroHydro();
    calculateTemperatures();

    reGraph();
    Features.markupPack();
    Ice.generate();
    Measurers.createDefaultRuler();

    this.restoreCellData(parentMap, inverse, scale);
    this.restoreRivers(riversData, projection, scale);
    this.restoreCultures(parentMap, projection);
    this.restoreBurgs(parentMap, projection, scale);
    this.restoreStates(parentMap, projection);
    this.restoreRoutes(parentMap, projection);
    this.restoreReligions(parentMap, projection);
    this.restoreProvinces(parentMap);
    this.restoreFeatureDetails(parentMap, inverse);
    this.restoreMarkers(parentMap, projection);
    this.restoreZones(parentMap, projection, scale);
    this.restoreEconomy(parentMap);
    for (const state of pack.states) {
      if (state.label) state.label.pathPoints = undefined;
    }
    pack.addedLabels = (parentMap.pack.addedLabels || []).map(addedLabel => {
      const [x, y] = projection(addedLabel.x, addedLabel.y);
      return {
        ...addedLabel,
        x,
        y,
        label: { ...addedLabel.label, pathPoints: addedLabel.label.pathPoints?.map(([x, y]) => projection(x, y)) }
      };
    });

    showStatistics();
  }
}

export const Resample = new Resampler();


========================================
FILE: ./generators/river-generator.ts
========================================

import Alea from "alea";
import { curveBasis, curveCatmullRom, line, mean, min, select, sum } from "d3";
import { each, rn, round, rw } from "../utils";
import { meander, projectToNearestEdge } from "../utils/pathUtils";
import type { Label } from "./labels-generator";
import type { Point } from "./voronoi";

export const MIN_NAVIGABLE_FLUX = 100;

export interface River {
  i: number; // river id
  source: number; // source cell index
  mouth: number; // mouth cell index
  parent: number; // parent river id
  basin: number; // basin river id
  length: number; // river length
  discharge: number; // river discharge in m3/s
  width: number; // mouth width in km
  widthFactor: number; // width scaling factor
  sourceWidth: number; // source width in km
  name: string; // river name
  type: string; // river type
  cells: number[]; // cells forming the river path
  points?: Point[]; // river points (for meandering)
  label?: Label;
}

class RiverModule {
  private FLUX_FACTOR = 500;
  private MAX_FLUX_WIDTH = 1;
  private LENGTH_FACTOR = 200;
  private LENGTH_STEP_WIDTH = 1 / this.LENGTH_FACTOR;
  private LENGTH_PROGRESSION = [1, 1, 2, 3, 5, 8, 13, 21, 34].map(n => n / this.LENGTH_FACTOR);
  private lineGen = line().curve(curveBasis);

  riverTypes = {
    main: {
      big: { River: 1 },
      small: { Creek: 9, River: 3, Brook: 3, Stream: 1 }
    },
    fork: {
      big: { Fork: 1 },
      small: { Branch: 1 }
    }
  };

  smallLength: number | null = null;

  regenerate(): void {
    this.generate();
    this.specify();
    Features.defineGroups();
    Lakes.defineNames();
  }

  addDownhill(initialCell: number): { error?: string } {
    const { cells, rivers } = pack;
    let cell = initialCell;
    const riverCells: number[] = [];
    let riverId = this.getNextId(rivers);
    let parent = riverId;

    cells.fl[cell] = grid.cells.prec[cells.g[cell]];
    const heights = this.alterHeights();
    this.resolveDepressions(heights);

    while (cell) {
      cells.r[cell] = riverId;
      riverCells.push(cell);

      const nextCell: number = cells.c[cell].sort((a, b) => heights[a] - heights[b])[0];
      if (heights[cell] <= heights[nextCell]) {
        return { error: `Cell ${cell} is depressed, river cannot flow further` };
      }

      if (heights[nextCell] < 20) {
        riverCells.push(nextCell);
        const feature = pack.features[cells.f[nextCell]];
        if (feature.type === "lake") {
          if (feature.outlet) parent = feature.outlet;
          if (feature.inlets) feature.inlets.push(riverId);
          else feature.inlets = [riverId];
        }
        break;
      }

      if (cells.b[nextCell]) {
        cells.fl[nextCell] += cells.fl[cell];
        riverCells.push(-1);
        break;
      }

      if (!cells.r[nextCell]) {
        cells.fl[nextCell] += cells.fl[cell];
        cell = nextCell;
        continue;
      }

      const oldRiverId = cells.r[nextCell];
      const oldRiver = rivers.find(river => river.i === oldRiverId);
      const oldRiverCells = oldRiver?.cells || cells.i.filter(cellId => cells.r[cellId] === oldRiverId);
      const oldRiverCellsUpper = oldRiverCells.filter(cellId => heights[cellId] > heights[nextCell]);

      if (riverCells.length <= oldRiverCellsUpper.length) {
        cells.conf[nextCell] += cells.fl[cell];
        riverCells.push(nextCell);
        parent = oldRiverId;
        break;
      }

      riverCells.forEach(riverCell => {
        cells.r[riverCell] = oldRiverId;
      });
      oldRiverCells.forEach(oldCell => {
        if (heights[oldCell] > heights[nextCell]) {
          cells.r[oldCell] = 0;
          cells.fl[oldCell] = grid.cells.prec[cells.g[oldCell]];
        } else {
          riverCells.push(oldCell);
          cells.fl[oldCell] += cells.fl[cell];
        }
      });
      riverId = oldRiverId;
      break;
    }

    const river = rivers.find(candidate => candidate.i === riverId);
    const source = riverCells[0];
    const mouth = riverCells[riverCells.length - 2];
    const defaultWidthFactor = rn(1 / (grid.points.length / 10000) ** 0.25, 2);
    const widthFactor =
      river?.widthFactor || (!parent || parent === riverId ? defaultWidthFactor * 1.2 : defaultWidthFactor);
    const sourceWidth = river?.sourceWidth || this.getSourceWidth(cells.fl[source]);
    const meanderedPoints = this.addMeandering(riverCells);
    const discharge = cells.fl[mouth];
    const length = this.getApproximateLength(meanderedPoints.map(([x, y]) => [x, y]));
    const width = this.getWidth(
      this.getOffset({ flux: discharge, pointIndex: meanderedPoints.length, widthFactor, startingWidth: sourceWidth })
    );

    if (river) {
      Object.assign(river, { source, length, discharge, width, cells: riverCells });
    } else {
      const basin = this.getBasin(parent);
      const name = this.getName(mouth);
      const type = this.getType({ i: riverId, length, parent } as River);
      rivers.push({
        i: riverId,
        source,
        mouth,
        discharge,
        length,
        width,
        widthFactor,
        sourceWidth,
        parent,
        cells: riverCells,
        basin,
        name,
        type
      });
    }

    return {};
  }

  generate(allowErosion = true) {
    TIME && console.time("generateRivers");
    Math.random = Alea(seed);
    const { cells, features } = pack;

    const riversData: { [riverId: number]: number[] } = {};
    const riverParents: { [key: number]: number } = {};

    const addCellToRiver = (cellId: number, riverId: number) => {
      if (!riversData[riverId]) riversData[riverId] = [cellId];
      else riversData[riverId].push(cellId);
    };

    const drainWater = () => {
      const MIN_FLUX_TO_FORM_RIVER = 30;
      const cellsNumberModifier = ((pointsInput.dataset.cells as any) / 10000) ** 0.25;

      const prec = grid.cells.prec;
      const land = cells.i.filter((i: number) => h[i] >= 20).sort((a: number, b: number) => h[b] - h[a]);
      const lakeOutCells = Lakes.defineClimateData(h);

      for (const i of land) {
        cells.fl[i] += prec[cells.g[i]] / cellsNumberModifier; // add flux from precipitation

        // create lake outlet if lake is not in deep depression and flux > evaporation
        const lakes = lakeOutCells[i]
          ? features.filter((feature: any) => i === feature.outCell && feature.flux > feature.evaporation)
          : [];
        for (const lake of lakes) {
          const lakeCell = cells.c[i].find((c: number) => h[c] < 20 && cells.f[c] === lake.i)!;
          cells.fl[lakeCell] += Math.max(lake.flux - lake.evaporation, 0); // not evaporated lake water drains to outlet

          // allow chain lakes to retain identity
          if (cells.r[lakeCell] !== lake.river) {
            const sameRiver = cells.c[lakeCell].some((c: number) => cells.r[c] === lake.river);

            if (sameRiver) {
              cells.r[lakeCell] = lake.river as number;
              addCellToRiver(lakeCell, lake.river as number);
            } else {
              cells.r[lakeCell] = riverNext;
              addCellToRiver(lakeCell, riverNext);
              riverNext++;
            }
          }

          lake.outlet = cells.r[lakeCell];
          flowDown(i, cells.fl[lakeCell], lake.outlet);
        }

        // assign all tributary rivers to outlet basin
        const outlet = lakes[0]?.outlet;
        for (const lake of lakes) {
          if (!Array.isArray(lake.inlets)) continue;
          for (const inlet of lake.inlets) {
            riverParents[inlet] = outlet as number;
          }
        }

        // near-border cell: pour water out of the screen
        if (cells.b[i] && cells.r[i]) {
          addCellToRiver(-1, cells.r[i]);
          continue;
        }

        // downhill cell (make sure it's not in the source lake)
        let min = null;
        if (lakeOutCells[i]) {
          const filtered = cells.c[i].filter((c: number) => !lakes.map((lake: any) => lake.i).includes(cells.f[c]));
          min = filtered.sort((a: number, b: number) => h[a] - h[b])[0];
        } else if (cells.haven[i]) {
          min = cells.haven[i];
        } else {
          min = cells.c[i].reduce((minCell, c) => (h[c] < h[minCell] ? c : minCell));
        }

        // cells is depressed
        if (h[i] <= h[min]) continue;

        // debug
        //   .append("line")
        //   .attr("x1", pack.cells.p[i][0])
        //   .attr("y1", pack.cells.p[i][1])
        //   .attr("x2", pack.cells.p[min][0])
        //   .attr("y2", pack.cells.p[min][1])
        //   .attr("stroke", "#333")
        //   .attr("stroke-width", 0.2);

        if (cells.fl[i] < MIN_FLUX_TO_FORM_RIVER) {
          // flux is too small to operate as a river
          if (h[min] >= 20) cells.fl[min] += cells.fl[i];
          continue;
        }

        // proclaim a new river
        if (!cells.r[i]) {
          cells.r[i] = riverNext;
          addCellToRiver(i, riverNext);
          riverNext++;
        }

        flowDown(min, cells.fl[i], cells.r[i]);
      }
    };

    const flowDown = (toCell: number, fromFlux: number, river: number) => {
      const toFlux = cells.fl[toCell] - cells.conf[toCell];
      const toRiver = cells.r[toCell];

      if (toRiver) {
        // downhill cell already has river assigned
        if (fromFlux > toFlux) {
          cells.conf[toCell] += cells.fl[toCell]; // mark confluence
          if (h[toCell] >= 20) riverParents[toRiver] = river; // min river is a tributary of current river
          cells.r[toCell] = river; // re-assign river if downhill part has less flux
        } else {
          cells.conf[toCell] += fromFlux; // mark confluence
          if (h[toCell] >= 20) riverParents[river] = toRiver; // current river is a tributary of min river
        }
      } else cells.r[toCell] = river; // assign the river to the downhill cell

      if (h[toCell] < 20) {
        // pour water to the water body
        const waterBody = features[cells.f[toCell]];
        if (waterBody.type === "lake") {
          if (!waterBody.river || fromFlux > (waterBody.enteringFlux as number)) {
            waterBody.river = river;
            waterBody.enteringFlux = fromFlux;
          }
          waterBody.flux = waterBody.flux + fromFlux;
          if (!waterBody.inlets) waterBody.inlets = [river];
          else waterBody.inlets.push(river);
        }
      } else {
        // propagate flux and add next river segment
        cells.fl[toCell] += fromFlux;
      }

      addCellToRiver(toCell, river);
    };

    const defineRivers = () => {
      // re-initialize rivers and confluence arrays
      cells.r = new Uint16Array(cells.i.length);
      cells.conf = new Uint16Array(cells.i.length);
      pack.rivers = [];

      const defaultWidthFactor = rn(1 / ((pointsInput.dataset.cells as any) / 10000) ** 0.25, 2);
      const mainStemWidthFactor = defaultWidthFactor * 1.2;

      for (const key in riversData) {
        const riverCells = riversData[key];
        if (riverCells.length < 3) continue; // exclude tiny rivers

        const riverId = +key;
        for (const cell of riverCells) {
          if (cell < 0 || cells.h[cell] < 20) continue;

          // mark real confluences and assign river to cells
          if (cells.r[cell]) cells.conf[cell] = 1;
          else cells.r[cell] = riverId;
        }

        const source = riverCells[0];
        const mouth = riverCells[riverCells.length - 2];
        const parent = riverParents[key] || 0;

        const widthFactor = !parent || parent === riverId ? mainStemWidthFactor : defaultWidthFactor;
        const meanderedPoints = this.addMeandering(riverCells);
        const discharge = cells.fl[mouth]; // m3 in second
        const length = this.getApproximateLength(meanderedPoints.map(([x, y]) => [x, y]));
        const sourceWidth = this.getSourceWidth(cells.fl[source]);
        const width = this.getWidth(
          this.getOffset({
            flux: discharge,
            pointIndex: meanderedPoints.length,
            widthFactor,
            startingWidth: sourceWidth
          })
        );

        pack.rivers.push({
          i: riverId,
          source,
          mouth,
          discharge,
          length,
          width,
          widthFactor,
          sourceWidth,
          parent,
          cells: riverCells
        } as River);
      }
    };

    const downcutRivers = () => {
      const MAX_DOWNCUT = 5;

      for (const i of pack.cells.i) {
        if (cells.h[i] < 35) continue; // don't donwcut lowlands
        if (!cells.fl[i]) continue;

        const higherCells = cells.c[i].filter((c: number) => cells.h[c] > cells.h[i]);
        const higherFlux = higherCells.reduce((acc: number, c: number) => acc + cells.fl[c], 0) / higherCells.length;
        if (!higherFlux) continue;

        const downcut = Math.floor(cells.fl[i] / higherFlux);
        if (downcut) cells.h[i] -= Math.min(downcut, MAX_DOWNCUT);
      }
    };

    const calculateConfluenceFlux = () => {
      for (const i of cells.i) {
        if (!cells.conf[i]) continue;

        const sortedInflux = cells.c[i]
          .filter((c: number) => cells.r[c] && h[c] > h[i])
          .map((c: number) => cells.fl[c])
          .sort((a: number, b: number) => b - a);
        cells.conf[i] = sortedInflux.reduce(
          (acc: number, flux: number, index: number) => (index ? acc + flux : acc),
          0
        );
      }
    };

    cells.fl = new Uint16Array(cells.i.length); // water flux array
    cells.r = new Uint16Array(cells.i.length); // rivers array
    cells.conf = new Uint8Array(cells.i.length); // confluences array
    let riverNext = 1; // first river id is 1

    const h = this.alterHeights();
    Lakes.detectCloseLakes(h);
    this.resolveDepressions(h);
    drainWater();
    defineRivers();

    calculateConfluenceFlux();
    Lakes.cleanupLakeData();

    if (allowErosion) {
      cells.h = Uint8Array.from(h); // apply gradient
      downcutRivers(); // downcut river beds
    }

    TIME && console.timeEnd("generateRivers");
  }

  alterHeights(): number[] {
    const { h, c, t } = pack.cells as {
      h: Uint8Array;
      c: number[][];
      t: Uint8Array;
    };
    return Array.from(h).map((h, i) => {
      if (h < 20 || t[i] < 1) return h;
      return h + t[i] / 100 + (mean(c[i].map(c => t[c])) as number) / 10000;
    });
  }

  // depression filling algorithm (for a correct water flux modeling)
  resolveDepressions(h: number[]) {
    const { cells, features } = pack;
    const maxIterations = +(document.getElementById("resolveDepressionsStepsOutput") as HTMLInputElement)?.value;
    const checkLakeMaxIteration = maxIterations * 0.85;
    const elevateLakeMaxIteration = maxIterations * 0.75;

    const height = (i: number) => features[cells.f[i]].height || h[i]; // height of lake or specific cell

    const lakes = features.filter(feature => feature.type === "lake");
    const land = cells.i.filter((i: number) => h[i] >= 20 && !cells.b[i]); // exclude near-border cells
    land.sort((a: number, b: number) => h[a] - h[b]); // lowest cells go first

    const progress = [];
    let depressions = Infinity;
    let prevDepressions = null;
    for (let iteration = 0; depressions && iteration < maxIterations; iteration++) {
      if (progress.length > 5 && sum(progress) > 0) {
        // bad progress, abort and set heights back
        h = this.alterHeights();
        depressions = progress[0];
        break;
      }

      depressions = 0;

      if (iteration < checkLakeMaxIteration) {
        for (const l of lakes) {
          if (l.closed) continue;
          const minHeight = min(l.shoreline.map((s: number) => h[s])) as number;
          if (minHeight >= 100 || l.height > minHeight) continue;

          if (iteration > elevateLakeMaxIteration) {
            l.shoreline.forEach((i: number) => {
              h[i] = cells.h[i];
            });
            l.height = (min(l.shoreline.map((s: number) => h[s])) as number) - 1;
            l.closed = true;
            continue;
          }

          depressions++;
          l.height = (minHeight as number) + 0.2;
        }
      }

      for (const i of land) {
        const minHeight = min(cells.c[i].map((c: number) => height(c))) as number;
        if (minHeight >= 100 || h[i] > minHeight) continue;

        depressions++;
        h[i] = minHeight + 0.1;
      }

      prevDepressions !== null && progress.push(depressions - prevDepressions);
      prevDepressions = depressions;
    }

    depressions && WARN && console.warn(`Unresolved depressions: ${depressions}. Edit heightmap to fix`);
  }

  addMeandering(riverCells: number[], riverPoints: Point[] | null = null): [number, number, number][] {
    const { fl, h, p } = pack.cells;
    const { points, anchorIndices } = meander(riverCells, p, {
      anchors: riverPoints ?? undefined,
      meandering: 0.5,
      startStep: h[riverCells[0]] < 20 ? 1 : 10,
      isWaterCell: riverCells.map(c => c !== -1 && h[c] < 20),
      bounds: { width: graphWidth, height: graphHeight }
    });

    const flux: number[] = new Array(points.length).fill(0);
    anchorIndices.forEach((pointIndex, anchorIndex) => {
      const cellId = riverCells[anchorIndex];
      const fluxCell = cellId === -1 ? riverCells[anchorIndex - 1] : cellId;
      flux[pointIndex] = fl[fluxCell] || 0;
    });

    return points.map(([x, y], idx) => [x, y, flux[idx]]);
  }

  // anchor positions per river cell (cell centers, or override anchors), with -1 cells resolved to the map edge
  getRiverPoints(riverCells: number[], riverPoints: Point[] | null = null): Point[] {
    if (riverPoints) return riverPoints;

    const { p } = pack.cells;
    return riverCells.map((cell, i) => {
      if (cell === -1) return projectToNearestEdge(p[riverCells[i - 1]], graphWidth, graphHeight);
      return p[cell];
    });
  }

  getOffset({
    flux,
    pointIndex,
    widthFactor,
    startingWidth
  }: {
    flux: number;
    pointIndex: number;
    widthFactor: number;
    startingWidth: number;
  }) {
    if (pointIndex === 0) return startingWidth;

    const fluxWidth = Math.min(flux ** 0.7 / this.FLUX_FACTOR, this.MAX_FLUX_WIDTH);
    const lengthWidth =
      pointIndex * this.LENGTH_STEP_WIDTH +
      (this.LENGTH_PROGRESSION[pointIndex] || (this.LENGTH_PROGRESSION.at(-1) as number));
    return widthFactor * (lengthWidth + fluxWidth) + startingWidth;
  }

  getSourceWidth(flux: number) {
    return rn(Math.min(flux ** 0.9 / this.FLUX_FACTOR, this.MAX_FLUX_WIDTH), 2);
  }

  // build polygon from a list of points and calculated offset (width)
  getRiverPath(points: [number, number, number][], widthFactor: number, startingWidth: number) {
    this.lineGen.curve(curveCatmullRom.alpha(0.1));
    const riverPointsLeft: [number, number][] = [];
    const riverPointsRight: [number, number][] = [];
    let flux = 0;

    for (let pointIndex = 0; pointIndex < points.length; pointIndex++) {
      const [x0, y0] = points[pointIndex - 1] || points[pointIndex];
      const [x1, y1, pointFlux] = points[pointIndex];
      const [x2, y2] = points[pointIndex + 1] || points[pointIndex];
      if (pointFlux > flux) flux = pointFlux;

      const offset = this.getOffset({
        flux,
        pointIndex,
        widthFactor,
        startingWidth
      });
      const angle = Math.atan2(y0 - y2, x0 - x2);
      const sinOffset = Math.sin(angle) * offset;
      const cosOffset = Math.cos(angle) * offset;

      riverPointsLeft.push([x1 - sinOffset, y1 + cosOffset]);
      riverPointsRight.push([x1 + sinOffset, y1 - cosOffset]);
    }

    const right = this.lineGen(riverPointsRight.reverse());
    let left = this.lineGen(riverPointsLeft) || "";
    left = left.substring(left.indexOf("C"));

    return round(right + left, 1);
  }

  specify() {
    const rivers = pack.rivers;
    if (!rivers.length) return;

    for (const river of rivers) {
      river.parent = this.getParent(river.i);
      river.basin = this.getBasin(river.i);
      river.name = this.getName(river.mouth);
      river.type = this.getType(river);
    }
  }

  getName(cell: number) {
    return Names.getCulture(pack.cells.culture[cell]);
  }

  getType({ i, length, parent }: River) {
    if (this.smallLength === null) {
      const threshold = Math.ceil(pack.rivers.length * 0.15);
      this.smallLength = pack.rivers.map(r => r.length || 0).sort((a: number, b: number) => a - b)[threshold];
    }

    const isSmall: boolean = length < (this.smallLength as number);
    const isFork = each(3)(i) && parent && parent !== i;
    return rw(this.riverTypes[isFork ? "fork" : "main"][isSmall ? "small" : "big"]);
  }

  getApproximateLength(points: Point[] = []) {
    const length = points.reduce((s, v, i, p) => s + (i ? Math.hypot(v[0] - p[i - 1][0], v[1] - p[i - 1][1]) : 0), 0);
    return rn(length, 2);
  }

  // Real mouth width examples: Amazon 6000m, Volga 6000m, Dniepr 3000m, Mississippi 1300m, Themes 900m,
  // Danube 800m, Daugava 600m, Neva 500m, Nile 450m, Don 400m, Wisla 300m, Pripyat 150m, Bug 140m, Muchavets 40m
  getWidth(offset: number) {
    return rn((offset / 1.5) ** 1.8, 2); // mouth width in km
  }

  // remove river and all its tributaries
  remove(id: number) {
    const cells = pack.cells;
    const riversToRemove = pack.rivers.filter(r => r.i === id || r.parent === id || r.basin === id).map(r => r.i);
    riversToRemove.forEach(r => {
      select("#rivers").select(`#river${r}`).remove();
    });
    cells.r.forEach((r, i) => {
      if (!r || !riversToRemove.includes(r)) return;
      cells.r[i] = 0;
      cells.fl[i] = grid.cells.prec[cells.g[i]];
      cells.conf[i] = 0;
    });
    pack.rivers = pack.rivers.filter(r => !riversToRemove.includes(r.i));
  }

  getParent(r: number): number {
    const parent = pack.rivers.find(river => river.i === r)?.parent;
    if (!parent || parent === r) return r;
    if (!pack.rivers.some(river => river.i === parent)) return r;
    return parent;
  }

  getBasin(r: number): number {
    const parent = this.getParent(r);
    if (parent === r) return r;
    return this.getBasin(parent);
  }

  getNextId(rivers: { i: number }[]) {
    return rivers.length ? Math.max(...rivers.map(r => r.i)) + 1 : 1;
  }

  isNavigable(cellId: number): boolean {
    const { r, fl } = pack.cells;
    return Boolean(r[cellId]) && fl[cellId] >= MIN_NAVIGABLE_FLUX;
  }

  // Walk an outlet chain starting from a lake feature
  resolveLakeDrainFeature(lakeFeatureId: number): number | null {
    const { features, rivers, cells } = pack;
    const lake = features[lakeFeatureId];
    if (!lake || lake.type !== "lake") return null;
    if (!lake.outlet) return lakeFeatureId; // closed lake: return itself

    const riverById = new Map(rivers.map(r => [r.i, r]));
    const visited = new Set<number>();
    let river = riverById.get(lake.outlet);
    while (river && !visited.has(river.i)) {
      visited.add(river.i);
      const lastCell = river.cells[river.cells.length - 1];
      if (lastCell < 0) return null; // outlet exits the map

      const feature = features[cells.f[lastCell]];
      if (!feature) return null;
      if (feature.type === "ocean") return feature.i;
      if (feature.type !== "lake") return null;
      if (!feature.outlet) return feature.i; // closed downstream lake
      river = riverById.get(feature.outlet);
    }
    return null;
  }

  // Walk a river chain downstream through lakes until we reach the final receiving body
  resolveDrainFeature(cellId: number): number | null {
    const { cells, features, rivers } = pack;
    const startRiver = cells.r[cellId];
    if (!startRiver) return null;

    const riverById = new Map(rivers.map(r => [r.i, r]));
    let river = riverById.get(startRiver);
    const visited = new Set<number>();
    while (river && !visited.has(river.i)) {
      visited.add(river.i);
      const lastCell = river.cells[river.cells.length - 1];
      if (lastCell < 0) return null; // off-map exit

      const feature = features[cells.f[lastCell]];
      if (!feature) return null;
      if (feature.type === "ocean") return feature.i;
      if (feature.type !== "lake") return null;

      if (!feature.outlet) return feature.i; // closed lake terminus
      river = riverById.get(feature.outlet);
    }
    return null;
  }
}

declare global {
  var Rivers: RiverModule;
}

window.Rivers = new RiverModule();


========================================
FILE: ./types/PackedGraph.ts
========================================

import type { AddedLabel } from "@/generators/added-labels";
import type { Biome } from "@/generators/biomes-generator";
import type { Burg } from "@/generators/burgs-generator";
import type { Culture } from "@/generators/cultures-generator";
import type { Feature } from "@/generators/features";
import type { Good } from "@/generators/goods-generator";
import type { Ice } from "@/generators/ice-generator";
import type { Marker } from "@/generators/markers-generator";
import type { Deal, Market } from "@/generators/markets-generator";
import type { Measurer } from "@/generators/measurers-generator";
import type { Province } from "@/generators/provinces-generator";
import type { ReliefIcon } from "@/generators/relief-generator";
import type { Religion } from "@/generators/religions-generator";
import type { River } from "@/generators/river-generator";
import type { Route } from "@/generators/routes-generator";
import type { State } from "@/generators/states-generator";
import type { Zone } from "@/generators/zones-generator";

export type TypedArray = Uint8Array | Uint16Array | Uint32Array | Int8Array | Int16Array | Float32Array | Float64Array;

export interface PackedGraph {
  cells: {
    i: number[]; // cell indices
    c: number[][]; // neighboring cells
    v: number[][]; // neighboring vertices
    p: [number, number][]; // cell polygon points
    b: boolean[]; // cell is on border
    h: TypedArray; // cell heights
    t: TypedArray; // cell terrain types
    r: TypedArray; // river id passing through cell
    f: TypedArray; // feature id occupying cell
    fl: TypedArray; // flux presence in cell
    s: TypedArray; // cell suitability
    pop: TypedArray; // cell population
    conf: TypedArray; // cell water confidence
    haven: TypedArray; // cell is a haven
    g: number[]; // cell ground type
    culture: TypedArray; // cell culture id
    biome: TypedArray; // cell biome id
    harbor: TypedArray; // cell harbour presence
    burg: TypedArray; // cell burg id
    religion: TypedArray; // cell religion id
    state: TypedArray; // cell state id
    area: TypedArray; // cell area
    province: TypedArray; // cell province id
    good: Uint16Array; // cell good id
    market: Uint16Array; // cell market id
    routes: Record<number, Record<number, number>>;
  };
  vertices: {
    i: number[]; // vertex indices
    c: [number, number, number][]; // neighboring cells
    v: number[][]; // neighboring vertices
    x: number[]; // x coordinates
    y: number[]; // y coordinates
    p: [number, number][]; // vertex points
  };
  rivers: River[];
  relief: ReliefIcon[];
  biomes: Biome[];
  features: Feature[];
  flowFeatures?: any[];
  burgs: Burg[];
  states: State[];
  cultures: Culture[];
  routes: Route[];
  religions: Religion[];
  zones: Zone[];
  markers: Marker[];
  ice: Ice[];
  provinces: Province[];
  goods: Good[];
  markets: Market[];
  deals: Deal[];
  measurers: Measurer[];
  addedLabels: AddedLabel[];
}


========================================
FILE: ./types/global.ts
========================================

import type { LabelGroup } from "@/generators/labels-generator";
import type { ThreeDOptions } from "../data/view-3d-options";
import type { GoodsModule } from "../generators/goods-generator";
import type { MarketsModule } from "../generators/markets-generator";
import type { ProductionModule } from "../generators/production-generator";
import type { BurgGroup } from "./burg-groups";
import type { PackedGraph } from "./PackedGraph";
import type { Style } from "./style";

declare global {
  var MOBILE: boolean;

  /**
   * Migrated helpers, reachable ONLY as `window.X` — deliberately not `var`, so that bare `X`
   * in a bundled module is a compile error. src/ imports what it calls; these entries exist so
   * the owning module can register the bridge and classic public/ code can keep calling it.
   * When the last classic caller of one is gone, delete the entry and its `window.X =` line.
   */
  interface Window {
    tip: typeof import("../components/tooltips").tip;
    clearMainTip: typeof import("../components/tooltips").clearMainTip;
    showDataTip: typeof import("../components/tooltips").showDataTip;
    showElementLockTip: typeof import("../components/tooltips").showElementLockTip;
    lock: typeof import("../utils/preferences").lock;
    unlock: typeof import("../utils/preferences").unlock;
    stored: typeof import("../utils/preferences").stored;
    applyDefaultViewboxEvents: typeof import("../components/viewbox-events").applyDefaultViewboxEvents;
    fitLegendBox: typeof import("../renderers/draw-legend").fitLegendBox;
    clearLegend: typeof import("../renderers/draw-legend").clearLegend;
    unfog: typeof import("../renderers/overlays/fogging").unfog;
    showInfo: typeof import("../components/app-info").showInfo;
    applyOption: typeof import("../utils").applyOption;
    closeDialogs: typeof import("../components/dialog/dialog-helpers").closeDialogs;
    confirmationDialog: typeof import("../components/dialog/dialog-helpers").confirmationDialog;
    downloadFile: typeof import("../utils").downloadFile;
    uploadFile: typeof import("../utils").uploadFile;
    getPrecipitation: typeof import("../utils").getPrecipitation;
    panMap: typeof import("../components/zoom").panMap;
    setMapZoom: typeof import("../components/zoom").setMapZoom;
    changeMapZoom: typeof import("../components/zoom").changeMapZoom;
    setZoomExtent: typeof import("../components/zoom").setZoomExtent;
    setTranslateExtent: typeof import("../components/zoom").setTranslateExtent;
  }

  var mapId: number;
  var seed: string;
  var pack: PackedGraph;
  var grid: any;
  var graphHeight: number;
  var graphWidth: number;
  var TIME: boolean;
  var INFO: boolean;
  var WARN: boolean;
  var ERROR: boolean;
  var DEBUG: { stateLabels?: boolean; [key: string]: boolean | undefined };
  var options: Options;

  var Goods: GoodsModule;
  var Production: ProductionModule;
  var Markets: MarketsModule;
  var populationRate: number;
  var urbanDensity: number;
  var urbanization: number;
  var distanceScale: number;

  var pointsInput: HTMLInputElement;
  var culturesInput: HTMLInputElement;
  var culturesSet: HTMLSelectElement;
  var heightExponentInput: HTMLInputElement;
  var alertMessage: HTMLElement;
  var mapName: HTMLInputElement;
  var religionsNumber: HTMLInputElement;
  var distanceUnitInput: HTMLInputElement;
  var heightUnit: HTMLSelectElement;
  var areaUnit: HTMLInputElement;
  var stylePreset: HTMLSelectElement;
  var temperatureScale: HTMLSelectElement;

  // Global variables defined in main.js
  var scale: number;
  var viewX: number;
  var viewY: number;

  var getColorScheme: (scheme: string | null) => (t: number) => string;
  var getColor: (height: number, scheme: (t: number) => string) => string;
  var svgWidth: number;
  var svgHeight: number;

  var notes: any[]; // TODO: correct type
  var style: Style;

  // IO / loading helpers defined in classic public/ scripts
  var ldb: {
    get: (key: string) => Promise<Blob | undefined>;
    set: (key: string, value: Blob) => Promise<void>;
  };
  var Dropbox: any; // dropbox-sdk global, loaded on demand from libs/dropbox-sdk.min.js
  var mapHistory: { created: number; [key: string]: unknown }[];
  var customPresetPrefix: string;

  var focusOn: () => void;
  var fitMapToScreen: () => void;
  var regenerateMap: (reason?: string) => void;
  var generateMapOnLoad: () => void;
  var addCustomColorScheme: (scheme: string) => void;
  var updateTextureSelectValue: (href: string) => void;
  var calculateFriendlyGridSize: () => void;
  // heightmap editor globals
  var color: (value: number) => string;
  var edits: any; // heightmap edit history: Uint8Array[] with an extra .n cursor
  var undraw: () => void;
  var rankCells: () => void;
  var generatePrecipitation: () => void;
  var generateAeroHydro: () => void;
  var AeroHydro: any;
  var changeViewMode: (event?: Event) => void;
  var resetZoom: (duration?: number) => void;
  var RgbQuant: any; // external RgbQuant image-quantization lib

  var shiftCompass: () => void;

  var invokeActiveZooming: () => void;
  var FlatQueue: any;

  var THREE: any; // lazy-loaded

  var $: (selector: any) => any;
  var changeFont: () => void;
  var addLakesInDeepDepressions: () => void;
  var openNearSeaLakes: () => void;
  var calculateMapCoordinates: () => void;
  var calculateTemperatures: () => void;
  var reGraph: () => void;
  var showStatistics: () => void;
  var applyGraphSize: () => void;
  var cellsDensityMap: Record<number, number>;
  var changeCellsDensity: (value: string) => void;
  var getCellsDensityColor: (cells: number) => string;
  var showExportPane: () => void;
  var customization: number;
  var zoomTo: (x: number, y: number, zoom?: number, duration?: number) => void;
  var modules: Record<string, boolean>;

  // Legacy UI globals
  var toggleOptions: (event?: Event) => void;
  var hideOptions: (event?: Event) => void;
  var isCtrlClick: (event: MouseEvent) => boolean;
  var editStyle: (layer: string, group?: string) => void;
  var capitalize: (str: string) => string;
  var rn: (value: number, decimals?: number) => number;
  var openURL: (url: string) => void;
  var findCell: (x: number, y: number, radius?: number) => number | undefined;

  var tinymce:
    | {
        _setBaseUrl: (url: string) => void;
        init: (config: Record<string, unknown>) => void;
        remove: () => void;
        activeEditor?: { getContent: () => string; setContent: (content: string) => void };
      }
    | undefined;

  var aleaPRNG: (seed: string | number) => () => number;
  var heightmapColorSchemes: Record<string, unknown>;
  var regeneratePrompt: (options?: { seed?: string; graph?: any }) => void;

  type MilitaryUnit = {
    icon: string;
    name: string;
    rural: number;
    urban: number;
    crew: number;
    power: number;
    type: string;
    separate: number;
    biomes?: number[];
    states?: number[];
    cultures?: number[];
    religions?: number[];
  };
}

type Options = {
  year: number;
  era: string;
  eraShort: string;
  pinNotes: boolean;
  winds: number[];
  temperatureEquator: number;
  temperatureNorthPole: number;
  temperatureSouthPole: number;
  mapSize: number; // map size in % of the world
  latitude: number; // North-South map shift in %, 50 is centered on equator
  longitude: number; // West-East map shift in %, 50 is centered on prime meridian
  prec: number; // precipitation modifier in %
  showBurgPreview: boolean;
  burgs: { groups: BurgGroup[] };
  labels: { resizeOnZoom: boolean; showAll: boolean; groups: LabelGroup[] };
  military: MilitaryUnit[];
  trade: {
    animation: ReturnType<typeof TradeAnimation.getDefaultOptions>;
  };
  threeD: ThreeDOptions;
};

export type Point = [number, number];
