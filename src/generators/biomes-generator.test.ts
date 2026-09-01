import { describe, expect, it } from "vitest";
import { BiomesGenerator } from "./biomes-generator";

describe("BiomesGenerator", () => {
  const biomesGen = new BiomesGenerator();

  it("TEST-B1: Hot and dry cells (Egipt / Sahara) are classified as Tropical/Subtropical Deserts", () => {
    // T = 25°C (Tropical), prec = 1 (55 mm/rok, < 125mm), h = 25 (Lowland)
    const desertTropical = biomesGen.getId(1, 25, 25, false);
    expect(desertTropical).toBe(8); // Tropical deserts

    // T = 20°C (Subtropical), prec = 1, h = 25
    const desertSubtropical = biomesGen.getId(1, 20, 25, false);
    expect(desertSubtropical).toBe(7); // Subtropical deserts

    // T = 15°C (Temperate), prec = 1, h = 25
    const desertTemperate = biomesGen.getId(1, 15, 25, false);
    expect(desertTemperate).toBe(6); // Temperate deserts
  });

  it("TEST-B2: Mediterranean hills and mountains do NOT receive Glaciers (ID 43)", () => {
    // T = 16.5°C na poziomie morza, wzgórze h = 75 (Montane), T_cell = 5°C, prec = 12 (660 mm)
    const biomeMontane = biomesGen.getId(12, 5, 75, false);
    expect(biomeMontane).not.toBe(43); // Nie lodowiec!
    expect(biomeMontane).toBe(67); // Montane continental woodlands

    // Subtropikalne góry: T = 19°C, h = 80, prec = 15
    const biomeSubtropicalMountain = biomesGen.getId(15, 19, 80, false);
    expect(biomeSubtropicalMountain).toBe(70); // Montane subtropical woodlands
  });

  it("TEST-B3: Desert river cell receives riparian shrubland/woodland upgrade (Nile Valley / Oasis)", () => {
    // Pustynia T=25°C, bazowy prec=1 (55 mm), ale rzeka podbija wilgoć o +3 -> moisture = 4 (220 mm)
    const oasisBiome = biomesGen.getId(4, 25, 25, true);
    expect(oasisBiome).toBe(16); // Tropical shrublands (Oasis / Green Nile valley)
  });

  it("TEST-B4: Central Europe temperate cells receive deciduous/mixed forests and woodlands", () => {
    // Polska/Niemcy: T = 9°C (Oceanic/Temperate), prec = 13 (715 mm), h = 25
    const centralEuropeBiome = biomesGen.getId(13, 9, 25, false);
    expect(centralEuropeBiome).toBe(26); // Oceanic woodlands

    // Cieplejszy las liściasty: T = 14°C, prec = 20 (1100 mm), h = 30
    const temperateForest = biomesGen.getId(20, 14, 30, false);
    expect(temperateForest).toBe(32); // Temperate forests
  });

  it("TEST-B5: Marine cells (h < 20) are always Marine (ID 0)", () => {
    expect(biomesGen.getId(0, 25, 10, false)).toBe(0);
    expect(biomesGen.getId(50, -10, 0, false)).toBe(0);
  });
});
