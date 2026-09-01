/**
 * Serializacja stanu fizycznego Aero-Hydro do formatu .map (sekcja data[52]).
 *
 * Problem, który rozwiązuje: `save.ts` przechowuje tylko legacy tablice
 * (temp/prec/biome) oraz flowFeatures. Pola fizyczne Float32Array generowane
 * przez silniki Aero-Hydro (pressure, windU/V, oceanU/V, sstAnomaly,
 * sstLandInfluence, moisture) były tracone przy zapisie — każde wczytanie
 * mapy startowało od zera i traciło sub-jednostkową precyzję pola wilgoci
 * (kwantyzacja Uint8 w `prec` nie oddaje cienia fenowego).
 *
 * Format sekcji (JSON):
 *   { "v": 1, "fields": { "pressure": "<base64 Float32>", ... } }
 *
 * Konfiguracja silników (options.atmosphere, options.oceanCurrents, centers
 * baryczne) NIE jest tu duplikowana — serializuje ją standardowy zapis
 * `options` w sekcji settings (data[1], indeks 19).
 *
 * Kompatybilność wstecz: starsze pliki nie mają sekcji 52 — loader traktuje
 * ją jako opcjonalną. Sekcja jest pomijana (""), gdy żadne pole nie istnieje
 * lub jest w całości zerowe, żeby nie puchnąć zapisów z wyłączonym klimatem.
 *
 * `windSpeed` jest celowo nieserializowany — pochodna |V| z windU/windV.
 *
 * @module services/io/aero-hydro-state
 */

const AERO_HYDRO_STATE_VERSION = 1;

const SERIALIZED_FIELDS = [
  "pressure",
  "windU",
  "windV",
  "oceanU",
  "oceanV",
  "sstAnomaly",
  "sstLandInfluence",
  "moisture"
] as const;

type SerializedFieldName = (typeof SERIALIZED_FIELDS)[number];

export interface AeroHydroState {
  v: number;
  fields: Partial<Record<SerializedFieldName, string>>;
}

/** Encoding chunku dla String.fromCharCode (limit bezpieczeństwa silnika JS) */
const B64_CHUNK = 0x8000;

function float32ToBase64(arr: Float32Array): string {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let binary = "";
  for (let i = 0; i < bytes.length; i += B64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + B64_CHUNK));
  }
  return btoa(binary);
}

function base64ToFloat32(b64: string): Float32Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

function isEffectivelyZero(field: Float32Array): boolean {
  for (let i = 0; i < field.length; i++) {
    if (field[i] !== 0) return false;
  }
  return true;
}

/**
 * Buduje JSON-owy stan pól fizycznych Aero-Hydro z globalnego gridu.
 * Zwraca "" gdy nie ma czego serializować (sekcja pusta).
 */
export function serializeAeroHydroState(): string {
  const grid = (globalThis as any).grid;
  const cells = grid?.cells;
  if (!cells?.i?.length) return "";

  const fields: Partial<Record<SerializedFieldName, string>> = {};
  for (const name of SERIALIZED_FIELDS) {
    const field = cells[name];
    if (!(field instanceof Float32Array) || field.length !== cells.i.length) continue;
    if (isEffectivelyZero(field)) continue;
    fields[name] = float32ToBase64(field);
  }

  if (Object.keys(fields).length === 0) return "";
  const state: AeroHydroState = { v: AERO_HYDRO_STATE_VERSION, fields };
  return JSON.stringify(state);
}

/**
 * Odtwarza pola fizyczne Aero-Hydro z zapisu do globalnego gridu.
 * Zwraca true, gdy przywrócono co najmniej jedno pole.
 * Pola o niezgodnej długości (zmieniony grid) są pomijane z ostrzeżeniem.
 */
export function restoreAeroHydroState(raw: unknown): boolean {
  const state = raw as AeroHydroState | null;
  if (!state || typeof state !== "object" || !state.fields || state.v !== AERO_HYDRO_STATE_VERSION) {
    return false;
  }

  const grid = (globalThis as any).grid;
  const cells = grid?.cells;
  if (!cells?.i?.length) return false;

  let restored = 0;
  for (const name of SERIALIZED_FIELDS) {
    const encoded = state.fields[name];
    if (!encoded) continue;

    try {
      const field = base64ToFloat32(encoded);
      if (field.length !== cells.i.length) {
        typeof WARN !== "undefined" &&
          WARN &&
          console.warn(`[Aero-Hydro] Field ${name} length mismatch (${field.length} vs ${cells.i.length}), skipping`);
        continue;
      }
      cells[name] = field;
      restored++;
    } catch (error) {
      typeof ERROR !== "undefined" && ERROR && console.error(`[Aero-Hydro] Failed to decode field ${name}:`, error);
    }
  }

  return restored > 0;
}