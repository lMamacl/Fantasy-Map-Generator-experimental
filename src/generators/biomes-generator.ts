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
  minHeight?: number;
  maxHeight?: number;
  minTemp?: number;
  maxTemp?: number;
  minPrec?: number;
  maxPrec?: number;
  removed?: boolean;
}

const EXTENDED_BIOMES = [
  { i: 0, name: 'Marine', color: '#466eab', habitability: 0, iconsDensity: 0, icons: [], cost: 10, minHeight: 0, maxHeight: 19, minTemp: -100, maxTemp: 100, minPrec: 0, maxPrec: 9999 },
  { i: 1, name: 'Glaciers', color: '#f2f1ef', habitability: 0, iconsDensity: 0, icons: [], cost: 5000, minHeight: 20, maxHeight: 69, minTemp: -50, maxTemp: -1, minPrec: 0, maxPrec: 9999 },
  { i: 2, name: 'Polar deserts', color: '#f4eee1', habitability: 5, iconsDensity: 5, icons: ["dune", "dune", "cactus", "deadTree"], cost: 150, minHeight: 20, maxHeight: 69, minTemp: 0, maxTemp: 1, minPrec: 0, maxPrec: 124 },
  { i: 3, name: 'Subpolar deserts', color: '#f6ebd2', habitability: 10, iconsDensity: 5, icons: ["dune", "dune", "cactus", "deadTree"], cost: 150, minHeight: 20, maxHeight: 69, minTemp: 2, maxTemp: 3, minPrec: 0, maxPrec: 124 },
  { i: 4, name: 'Continental deserts', color: '#f7e9c4', habitability: 15, iconsDensity: 5, icons: ["dune", "dune", "cactus", "deadTree"], cost: 150, minHeight: 20, maxHeight: 69, minTemp: 4, maxTemp: 6, minPrec: 0, maxPrec: 124 },
  { i: 5, name: 'Oceanic deserts', color: '#f7e6b5', habitability: 20, iconsDensity: 5, icons: ["dune", "dune", "cactus", "deadTree"], cost: 150, minHeight: 20, maxHeight: 69, minTemp: 7, maxTemp: 12, minPrec: 0, maxPrec: 124 },
  { i: 6, name: 'Temperate deserts', color: '#f7e4a7', habitability: 25, iconsDensity: 5, icons: ["dune", "dune", "cactus", "deadTree"], cost: 150, minHeight: 20, maxHeight: 69, minTemp: 13, maxTemp: 17, minPrec: 0, maxPrec: 124 },
  { i: 7, name: 'Subtropical deserts', color: '#f6e199', habitability: 30, iconsDensity: 5, icons: ["dune", "dune", "cactus", "deadTree"], cost: 150, minHeight: 20, maxHeight: 69, minTemp: 18, maxTemp: 23, minPrec: 0, maxPrec: 124 },
  { i: 8, name: 'Tropical deserts', color: '#f4df8a', habitability: 25, iconsDensity: 5, icons: ["dune", "dune", "cactus", "deadTree"], cost: 150, minHeight: 20, maxHeight: 69, minTemp: 24, maxTemp: 30, minPrec: 0, maxPrec: 124 },
  { i: 9, name: 'Ultratropical deserts', color: '#f2dd7b', habitability: 20, iconsDensity: 5, icons: ["dune", "dune", "cactus", "deadTree"], cost: 150, minHeight: 20, maxHeight: 69, minTemp: 31, maxTemp: 50, minPrec: 0, maxPrec: 124 },
  { i: 10, name: 'Polar shrublands', color: '#dedacd', habitability: 40, iconsDensity: 50, icons: ["acacia", "grass"], cost: 60, minHeight: 20, maxHeight: 69, minTemp: 0, maxTemp: 1, minPrec: 125, maxPrec: 9999 },
  { i: 11, name: 'Subpolar shrublands', color: '#dfd7bf', habitability: 45, iconsDensity: 50, icons: ["acacia", "grass"], cost: 60, minHeight: 20, maxHeight: 69, minTemp: 2, maxTemp: 3, minPrec: 125, maxPrec: 249 },
  { i: 12, name: 'Continental shrublands', color: '#ded6b1', habitability: 50, iconsDensity: 50, icons: ["acacia", "grass"], cost: 60, minHeight: 20, maxHeight: 69, minTemp: 4, maxTemp: 6, minPrec: 125, maxPrec: 249 },
  { i: 13, name: 'Oceanic shrublands', color: '#ddd3a3', habitability: 55, iconsDensity: 50, icons: ["acacia", "grass"], cost: 60, minHeight: 20, maxHeight: 69, minTemp: 7, maxTemp: 12, minPrec: 125, maxPrec: 249 },
  { i: 14, name: 'Temperate shrublands', color: '#dcd195', habitability: 60, iconsDensity: 50, icons: ["acacia", "grass"], cost: 60, minHeight: 20, maxHeight: 69, minTemp: 13, maxTemp: 17, minPrec: 125, maxPrec: 249 },
  { i: 15, name: 'Subtropical shrublands', color: '#dacf87', habitability: 65, iconsDensity: 50, icons: ["acacia", "grass"], cost: 60, minHeight: 20, maxHeight: 69, minTemp: 18, maxTemp: 23, minPrec: 125, maxPrec: 249 },
  { i: 16, name: 'Tropical shrublands', color: '#d3ca76', habitability: 60, iconsDensity: 50, icons: ["acacia", "grass"], cost: 60, minHeight: 20, maxHeight: 69, minTemp: 24, maxTemp: 30, minPrec: 125, maxPrec: 249 },
  { i: 17, name: 'Ultratropical shrublands', color: '#cac664', habitability: 55, iconsDensity: 50, icons: ["acacia", "grass"], cost: 60, minHeight: 20, maxHeight: 69, minTemp: 31, maxTemp: 50, minPrec: 125, maxPrec: 249 },
  { i: 18, name: 'Subpolar grasslands', color: '#c8c4ac', habitability: 80, iconsDensity: 120, icons: ["grass"], cost: 50, minHeight: 20, maxHeight: 69, minTemp: 2, maxTemp: 3, minPrec: 250, maxPrec: 9999 },
  { i: 19, name: 'Continental grasslands', color: '#c6c39f', habitability: 85, iconsDensity: 120, icons: ["grass"], cost: 50, minHeight: 20, maxHeight: 69, minTemp: 4, maxTemp: 6, minPrec: 250, maxPrec: 499 },
  { i: 20, name: 'Oceanic grasslands', color: '#c4c191', habitability: 90, iconsDensity: 120, icons: ["grass"], cost: 50, minHeight: 20, maxHeight: 69, minTemp: 7, maxTemp: 12, minPrec: 250, maxPrec: 499 },
  { i: 21, name: 'Temperate grasslands', color: '#c2bf84', habitability: 95, iconsDensity: 120, icons: ["grass"], cost: 50, minHeight: 20, maxHeight: 69, minTemp: 13, maxTemp: 17, minPrec: 250, maxPrec: 499 },
  { i: 22, name: 'Subtropical grasslands', color: '#bfbd76', habitability: 100, iconsDensity: 120, icons: ["grass"], cost: 50, minHeight: 20, maxHeight: 69, minTemp: 18, maxTemp: 23, minPrec: 250, maxPrec: 499 },
  { i: 23, name: 'Tropical grasslands', color: '#b2b663', habitability: 95, iconsDensity: 120, icons: ["grass"], cost: 50, minHeight: 20, maxHeight: 69, minTemp: 24, maxTemp: 30, minPrec: 250, maxPrec: 499 },
  { i: 24, name: 'Ultratropical grasslands', color: '#a4af50', habitability: 90, iconsDensity: 120, icons: ["grass"], cost: 50, minHeight: 20, maxHeight: 69, minTemp: 31, maxTemp: 50, minPrec: 250, maxPrec: 499 },
  { i: 25, name: 'Continental woodlands', color: '#afb08d', habitability: 80, iconsDensity: 80, icons: ["deciduous", "acacia"], cost: 65, minHeight: 20, maxHeight: 69, minTemp: 4, maxTemp: 6, minPrec: 500, maxPrec: 9999 },
  { i: 26, name: 'Oceanic woodlands', color: '#acae80', habitability: 85, iconsDensity: 80, icons: ["deciduous", "acacia"], cost: 65, minHeight: 20, maxHeight: 69, minTemp: 7, maxTemp: 12, minPrec: 500, maxPrec: 999 },
  { i: 27, name: 'Temperate woodlands', color: '#a8ad73', habitability: 90, iconsDensity: 80, icons: ["deciduous", "acacia"], cost: 65, minHeight: 20, maxHeight: 69, minTemp: 13, maxTemp: 17, minPrec: 500, maxPrec: 999 },
  { i: 28, name: 'Subtropical woodlands', color: '#a4ab66', habitability: 95, iconsDensity: 80, icons: ["deciduous", "acacia"], cost: 65, minHeight: 20, maxHeight: 69, minTemp: 18, maxTemp: 23, minPrec: 500, maxPrec: 999 },
  { i: 29, name: 'Tropical woodlands', color: '#92a252', habitability: 90, iconsDensity: 80, icons: ["deciduous", "acacia"], cost: 65, minHeight: 20, maxHeight: 69, minTemp: 24, maxTemp: 30, minPrec: 500, maxPrec: 999 },
  { i: 30, name: 'Ultratropical woodlands', color: '#7e983d', habitability: 85, iconsDensity: 80, icons: ["deciduous", "acacia"], cost: 65, minHeight: 20, maxHeight: 69, minTemp: 31, maxTemp: 50, minPrec: 500, maxPrec: 999 },
  { i: 31, name: 'Oceanic forests', color: '#949c70', habitability: 80, iconsDensity: 120, icons: ["acacia", "palm", "deciduous"], cost: 75, minHeight: 20, maxHeight: 69, minTemp: 7, maxTemp: 12, minPrec: 1000, maxPrec: 9999 },
  { i: 32, name: 'Temperate forests', color: '#8f9b64', habitability: 85, iconsDensity: 120, icons: ["deciduous", "conifer"], cost: 75, minHeight: 20, maxHeight: 69, minTemp: 13, maxTemp: 17, minPrec: 1000, maxPrec: 1999 },
  { i: 33, name: 'Subtropical forests', color: '#8a9a57', habitability: 90, iconsDensity: 120, icons: ["acacia", "palm", "deciduous"], cost: 75, minHeight: 20, maxHeight: 69, minTemp: 18, maxTemp: 23, minPrec: 1000, maxPrec: 1999 },
  { i: 34, name: 'Tropical forests', color: '#738e42', habitability: 85, iconsDensity: 120, icons: ["acacia", "palm", "deciduous"], cost: 75, minHeight: 20, maxHeight: 69, minTemp: 24, maxTemp: 30, minPrec: 1000, maxPrec: 1999 },
  { i: 35, name: 'Ultratropical forests', color: '#59812d', habitability: 80, iconsDensity: 120, icons: ["acacia", "palm", "deciduous"], cost: 75, minHeight: 20, maxHeight: 69, minTemp: 31, maxTemp: 50, minPrec: 1000, maxPrec: 1999 },
  { i: 36, name: 'Temperate rainforests', color: '#778955', habitability: 80, iconsDensity: 120, icons: ["deciduous", "conifer"], cost: 75, minHeight: 20, maxHeight: 69, minTemp: 13, maxTemp: 17, minPrec: 2000, maxPrec: 9999 },
  { i: 37, name: 'Subtropical rainforests', color: '#718849', habitability: 85, iconsDensity: 120, icons: ["acacia", "palm", "deciduous"], cost: 75, minHeight: 20, maxHeight: 69, minTemp: 18, maxTemp: 23, minPrec: 2000, maxPrec: 3999 },
  { i: 38, name: 'Tropical rainforests', color: '#547a33', habitability: 80, iconsDensity: 120, icons: ["acacia", "palm", "deciduous"], cost: 75, minHeight: 20, maxHeight: 69, minTemp: 24, maxTemp: 30, minPrec: 2000, maxPrec: 3999 },
  { i: 39, name: 'Ultratropical rainforests', color: '#346a1e', habitability: 75, iconsDensity: 120, icons: ["acacia", "palm", "deciduous"], cost: 75, minHeight: 20, maxHeight: 69, minTemp: 31, maxTemp: 50, minPrec: 2000, maxPrec: 3999 },
  { i: 40, name: 'Subtropical jungles', color: '#58773c', habitability: 80, iconsDensity: 200, icons: ["acacia", "palm", "swamp"], cost: 100, minHeight: 20, maxHeight: 69, minTemp: 18, maxTemp: 23, minPrec: 4000, maxPrec: 9999 },
  { i: 41, name: 'Tropical jungles', color: '#366626', habitability: 75, iconsDensity: 200, icons: ["acacia", "palm", "swamp"], cost: 100, minHeight: 20, maxHeight: 69, minTemp: 24, maxTemp: 30, minPrec: 4000, maxPrec: 9999 },
  { i: 42, name: 'Ultratropical jungles', color: '#005411', habitability: 70, iconsDensity: 200, icons: ["acacia", "palm", "swamp"], cost: 100, minHeight: 20, maxHeight: 69, minTemp: 31, maxTemp: 50, minPrec: 4000, maxPrec: 9999 },
  { i: 43, name: 'Montane glaciers', color: '#fffefc', habitability: 0, iconsDensity: 0, icons: [], cost: 5000, minHeight: 70, maxHeight: 100, minTemp: -50, maxTemp: -1, minPrec: 0, maxPrec: 9999 },
  { i: 44, name: 'Montane polar deserts', color: '#fffdf0', habitability: 3, iconsDensity: 5, icons: ["dune", "dune", "cactus", "deadTree"], cost: 150, minHeight: 70, maxHeight: 100, minTemp: 0, maxTemp: 1, minPrec: 0, maxPrec: 124 },
  { i: 45, name: 'Montane subpolar deserts', color: '#fffbe3', habitability: 7, iconsDensity: 5, icons: ["dune", "dune", "cactus", "deadTree"], cost: 150, minHeight: 70, maxHeight: 100, minTemp: 2, maxTemp: 3, minPrec: 0, maxPrec: 124 },
  { i: 46, name: 'Montane continental deserts', color: '#fffbd7', habitability: 10, iconsDensity: 5, icons: ["dune", "dune", "cactus", "deadTree"], cost: 150, minHeight: 70, maxHeight: 100, minTemp: 4, maxTemp: 6, minPrec: 0, maxPrec: 124 },
  { i: 47, name: 'Montane oceanic deserts', color: '#fffaca', habitability: 13, iconsDensity: 5, icons: ["dune", "dune", "cactus", "deadTree"], cost: 150, minHeight: 70, maxHeight: 100, minTemp: 7, maxTemp: 12, minPrec: 0, maxPrec: 124 },
  { i: 48, name: 'Montane temperate deserts', color: '#fff9be', habitability: 17, iconsDensity: 5, icons: ["dune", "dune", "cactus", "deadTree"], cost: 150, minHeight: 70, maxHeight: 100, minTemp: 13, maxTemp: 17, minPrec: 0, maxPrec: 124 },
  { i: 49, name: 'Montane subtropical deserts', color: '#fff9b2', habitability: 20, iconsDensity: 5, icons: ["dune", "dune", "cactus", "deadTree"], cost: 150, minHeight: 70, maxHeight: 100, minTemp: 18, maxTemp: 23, minPrec: 0, maxPrec: 124 },
  { i: 50, name: 'Montane tropical deserts', color: '#fff9a5', habitability: 17, iconsDensity: 5, icons: ["dune", "dune", "cactus", "deadTree"], cost: 150, minHeight: 70, maxHeight: 100, minTemp: 24, maxTemp: 30, minPrec: 0, maxPrec: 124 },
  { i: 51, name: 'Montane ultratropical deserts', color: '#fff999', habitability: 13, iconsDensity: 5, icons: ["dune", "dune", "cactus", "deadTree"], cost: 150, minHeight: 70, maxHeight: 100, minTemp: 31, maxTemp: 50, minPrec: 0, maxPrec: 124 },
  { i: 52, name: 'Montane polar shrublands', color: '#f8f1dd', habitability: 27, iconsDensity: 50, icons: ["acacia", "grass"], cost: 60, minHeight: 70, maxHeight: 100, minTemp: 0, maxTemp: 1, minPrec: 125, maxPrec: 9999 },
  { i: 53, name: 'Montane subpolar shrublands', color: '#f5f0d1', habitability: 30, iconsDensity: 50, icons: ["acacia", "grass"], cost: 60, minHeight: 70, maxHeight: 100, minTemp: 2, maxTemp: 3, minPrec: 125, maxPrec: 249 },
  { i: 54, name: 'Montane continental shrublands', color: '#f3f0c5', habitability: 34, iconsDensity: 50, icons: ["acacia", "grass"], cost: 60, minHeight: 70, maxHeight: 100, minTemp: 4, maxTemp: 6, minPrec: 125, maxPrec: 249 },
  { i: 55, name: 'Montane oceanic shrublands', color: '#f2f0b9', habitability: 37, iconsDensity: 50, icons: ["acacia", "grass"], cost: 60, minHeight: 70, maxHeight: 100, minTemp: 7, maxTemp: 12, minPrec: 125, maxPrec: 249 },
  { i: 56, name: 'Montane temperate shrublands', color: '#f0efad', habitability: 40, iconsDensity: 50, icons: ["acacia", "grass"], cost: 60, minHeight: 70, maxHeight: 100, minTemp: 13, maxTemp: 17, minPrec: 125, maxPrec: 249 },
  { i: 57, name: 'Montane subtropical shrublands', color: '#efefa1', habitability: 44, iconsDensity: 50, icons: ["acacia", "grass"], cost: 60, minHeight: 70, maxHeight: 100, minTemp: 18, maxTemp: 23, minPrec: 125, maxPrec: 249 },
  { i: 58, name: 'Montane tropical shrublands', color: '#eaee92', habitability: 40, iconsDensity: 50, icons: ["acacia", "grass"], cost: 60, minHeight: 70, maxHeight: 100, minTemp: 24, maxTemp: 30, minPrec: 125, maxPrec: 249 },
  { i: 59, name: 'Montane ultratropical shrublands', color: '#e5ed83', habitability: 37, iconsDensity: 50, icons: ["acacia", "grass"], cost: 60, minHeight: 70, maxHeight: 100, minTemp: 31, maxTemp: 50, minPrec: 125, maxPrec: 249 },
  { i: 60, name: 'Montane subpolar grasslands', color: '#ebe6bf', habitability: 54, iconsDensity: 120, icons: ["grass"], cost: 50, minHeight: 70, maxHeight: 100, minTemp: 2, maxTemp: 3, minPrec: 250, maxPrec: 9999 },
  { i: 61, name: 'Montane continental grasslands', color: '#e7e6b4', habitability: 57, iconsDensity: 120, icons: ["grass"], cost: 50, minHeight: 70, maxHeight: 100, minTemp: 4, maxTemp: 6, minPrec: 250, maxPrec: 499 },
  { i: 62, name: 'Montane oceanic grasslands', color: '#e4e6a8', habitability: 60, iconsDensity: 120, icons: ["grass"], cost: 50, minHeight: 70, maxHeight: 100, minTemp: 7, maxTemp: 12, minPrec: 250, maxPrec: 499 },
  { i: 63, name: 'Montane temperate grasslands', color: '#e1e69c', habitability: 64, iconsDensity: 120, icons: ["grass"], cost: 50, minHeight: 70, maxHeight: 100, minTemp: 13, maxTemp: 17, minPrec: 250, maxPrec: 499 },
  { i: 64, name: 'Montane subtropical grasslands', color: '#dee691', habitability: 67, iconsDensity: 120, icons: ["grass"], cost: 50, minHeight: 70, maxHeight: 100, minTemp: 18, maxTemp: 23, minPrec: 250, maxPrec: 499 },
  { i: 65, name: 'Montane tropical grasslands', color: '#d4e480', habitability: 64, iconsDensity: 120, icons: ["grass"], cost: 50, minHeight: 70, maxHeight: 100, minTemp: 24, maxTemp: 30, minPrec: 250, maxPrec: 499 },
  { i: 66, name: 'Montane ultratropical grasslands', color: '#c9e170', habitability: 60, iconsDensity: 120, icons: ["grass"], cost: 50, minHeight: 70, maxHeight: 100, minTemp: 31, maxTemp: 50, minPrec: 250, maxPrec: 499 },
  { i: 67, name: 'Montane continental woodlands', color: '#dbdca3', habitability: 54, iconsDensity: 80, icons: ["deciduous", "acacia"], cost: 65, minHeight: 70, maxHeight: 100, minTemp: 4, maxTemp: 6, minPrec: 500, maxPrec: 9999 },
  { i: 68, name: 'Montane oceanic woodlands', color: '#d5dc98', habitability: 57, iconsDensity: 80, icons: ["deciduous", "acacia"], cost: 65, minHeight: 70, maxHeight: 100, minTemp: 7, maxTemp: 12, minPrec: 500, maxPrec: 999 },
  { i: 69, name: 'Montane temperate woodlands', color: '#d0dd8d', habitability: 60, iconsDensity: 80, icons: ["deciduous", "acacia"], cost: 65, minHeight: 70, maxHeight: 100, minTemp: 13, maxTemp: 17, minPrec: 500, maxPrec: 999 },
  { i: 70, name: 'Montane subtropical woodlands', color: '#cbdd82', habitability: 64, iconsDensity: 80, icons: ["deciduous", "acacia"], cost: 65, minHeight: 70, maxHeight: 100, minTemp: 18, maxTemp: 23, minPrec: 500, maxPrec: 999 },
  { i: 71, name: 'Montane tropical woodlands', color: '#bcd96f', habitability: 60, iconsDensity: 80, icons: ["deciduous", "acacia"], cost: 65, minHeight: 70, maxHeight: 100, minTemp: 24, maxTemp: 30, minPrec: 500, maxPrec: 999 },
  { i: 72, name: 'Montane ultratropical woodlands', color: '#acd65e', habitability: 57, iconsDensity: 80, icons: ["deciduous", "acacia"], cost: 65, minHeight: 70, maxHeight: 100, minTemp: 31, maxTemp: 50, minPrec: 500, maxPrec: 999 },
  { i: 73, name: 'Montane oceanic forests', color: '#c6d388', habitability: 54, iconsDensity: 120, icons: ["acacia", "palm", "deciduous"], cost: 75, minHeight: 70, maxHeight: 100, minTemp: 7, maxTemp: 12, minPrec: 1000, maxPrec: 9999 },
  { i: 74, name: 'Montane temperate forests', color: '#bfd47d', habitability: 57, iconsDensity: 120, icons: ["deciduous", "conifer"], cost: 75, minHeight: 70, maxHeight: 100, minTemp: 13, maxTemp: 17, minPrec: 1000, maxPrec: 1999 },
  { i: 75, name: 'Montane subtropical forests', color: '#b8d473', habitability: 60, iconsDensity: 120, icons: ["acacia", "palm", "deciduous"], cost: 75, minHeight: 70, maxHeight: 100, minTemp: 18, maxTemp: 23, minPrec: 1000, maxPrec: 1999 },
  { i: 76, name: 'Montane tropical forests', color: '#a3cf60', habitability: 57, iconsDensity: 120, icons: ["acacia", "palm", "deciduous"], cost: 75, minHeight: 70, maxHeight: 100, minTemp: 24, maxTemp: 30, minPrec: 1000, maxPrec: 1999 },
  { i: 77, name: 'Montane ultratropical forests', color: '#8bca4e', habitability: 54, iconsDensity: 120, icons: ["acacia", "palm", "deciduous"], cost: 75, minHeight: 70, maxHeight: 100, minTemp: 31, maxTemp: 50, minPrec: 1000, maxPrec: 1999 },
  { i: 78, name: 'Montane temperate rainforests', color: '#adcb6f', habitability: 54, iconsDensity: 120, icons: ["deciduous", "conifer"], cost: 75, minHeight: 70, maxHeight: 100, minTemp: 13, maxTemp: 17, minPrec: 2000, maxPrec: 9999 },
  { i: 79, name: 'Montane subtropical rainforests', color: '#a4cc66', habitability: 57, iconsDensity: 120, icons: ["acacia", "palm", "deciduous"], cost: 75, minHeight: 70, maxHeight: 100, minTemp: 18, maxTemp: 23, minPrec: 2000, maxPrec: 3999 },
  { i: 80, name: 'Montane tropical rainforests', color: '#88c552', habitability: 54, iconsDensity: 120, icons: ["acacia", "palm", "deciduous"], cost: 75, minHeight: 70, maxHeight: 100, minTemp: 24, maxTemp: 30, minPrec: 2000, maxPrec: 3999 },
  { i: 81, name: 'Montane ultratropical rainforests', color: '#67bf41', habitability: 50, iconsDensity: 120, icons: ["acacia", "palm", "deciduous"], cost: 75, minHeight: 70, maxHeight: 100, minTemp: 31, maxTemp: 50, minPrec: 2000, maxPrec: 3999 },
  { i: 82, name: 'Montane subtropical jungles', color: '#8fc359', habitability: 54, iconsDensity: 200, icons: ["acacia", "palm", "swamp"], cost: 100, minHeight: 70, maxHeight: 100, minTemp: 18, maxTemp: 23, minPrec: 4000, maxPrec: 9999 },
  { i: 83, name: 'Montane tropical jungles', color: '#6abb46', habitability: 50, iconsDensity: 200, icons: ["acacia", "palm", "swamp"], cost: 100, minHeight: 70, maxHeight: 100, minTemp: 24, maxTemp: 30, minPrec: 4000, maxPrec: 9999 },
  { i: 84, name: 'Montane ultratropical jungles', color: '#36b336', habitability: 47, iconsDensity: 200, icons: ["acacia", "palm", "swamp"], cost: 100, minHeight: 70, maxHeight: 100, minTemp: 31, maxTemp: 50, minPrec: 4000, maxPrec: 9999 },
];

function getDefaultBiomes(): Biome[] {
  return EXTENDED_BIOMES;
}

declare global {
  var Biomes: BiomesGenerator;
}

const PRECIP_SCALE_FACTOR = 55; // Used to convert relative moisture to mm/year

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
    if (!pack.biomes || pack.biomes.length !== EXTENDED_BIOMES.length) {
      pack.biomes = this.getDefault();
    }

    const { fl: flux, r: riverIds, h: heights, c: neighbors, g: gridReference } = pack.cells;
    const { temp, prec } = grid.cells;
    pack.cells.biome = new Uint8Array(pack.cells.i.length);

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

  getId(moisture: number, temperature: number, height: number, _hasRiver: boolean): number {
    if (height < 20) return 0; // Marine

    const precipMm = moisture * PRECIP_SCALE_FACTOR;
    const isMontane = height >= 70;
    const offset = isMontane ? 42 : 0;

    // 1. Glaciers (T < 0°C)
    if (temperature < 0) return 1 + offset;

    // 2. Polar (0 <= T < 2°C)
    if (temperature < 2) {
      return (precipMm < 125 ? 2 : 10) + offset;
    }

    // 3. Subpolar (2 <= T < 4°C)
    if (temperature < 4) {
      if (precipMm < 125) return 3 + offset;
      if (precipMm < 250) return 11 + offset;
      return 18 + offset;
    }

    // 4. Continental (4 <= T < 7°C)
    if (temperature < 7) {
      if (precipMm < 125) return 4 + offset;
      if (precipMm < 250) return 12 + offset;
      if (precipMm < 500) return 19 + offset;
      return 25 + offset;
    }

    // 5. Oceanic (7 <= T < 13°C)
    if (temperature < 13) {
      if (precipMm < 125) return 5 + offset;
      if (precipMm < 250) return 13 + offset;
      if (precipMm < 500) return 20 + offset;
      if (precipMm < 1000) return 26 + offset;
      return 31 + offset;
    }

    // 6. Temperate (13 <= T < 18°C)
    if (temperature < 18) {
      if (precipMm < 125) return 6 + offset;
      if (precipMm < 250) return 14 + offset;
      if (precipMm < 500) return 21 + offset;
      if (precipMm < 1000) return 27 + offset;
      if (precipMm < 2000) return 32 + offset;
      return 36 + offset;
    }

    // 7. Subtropical (18 <= T < 24°C)
    if (temperature < 24) {
      if (precipMm < 125) return 7 + offset;
      if (precipMm < 250) return 15 + offset;
      if (precipMm < 500) return 22 + offset;
      if (precipMm < 1000) return 28 + offset;
      if (precipMm < 2000) return 33 + offset;
      if (precipMm < 4000) return 37 + offset;
      return 40 + offset;
    }

    // 8. Tropical (24 <= T < 31°C)
    if (temperature < 31) {
      if (precipMm < 125) return 8 + offset;
      if (precipMm < 250) return 16 + offset;
      if (precipMm < 500) return 23 + offset;
      if (precipMm < 1000) return 29 + offset;
      if (precipMm < 2000) return 34 + offset;
      if (precipMm < 4000) return 38 + offset;
      return 41 + offset;
    }

    // 9. Ultratropical (T >= 31°C)
    if (precipMm < 125) return 9 + offset;
    if (precipMm < 250) return 17 + offset;
    if (precipMm < 500) return 24 + offset;
    if (precipMm < 1000) return 30 + offset;
    if (precipMm < 2000) return 35 + offset;
    if (precipMm < 4000) return 39 + offset;
    return 42 + offset;
  }
}

window.Biomes = new BiomesGenerator();
