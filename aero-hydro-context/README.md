# Aero-Hydro 2.0: Pakiet Kontekstowy i Zestawienie Plików

> **Cel pakietu:** Zbiór dokumentacji projektowej, bazy architektonicznej FMG 2.0, kodu źródłowego (stan obecny) oraz powiązanych generatorów/rendererów potrzebnych do zaprojektowania i wdrożenia fizycznego silnika wiatrów 2D, prądów oceanicznych, termodynamiki wilgoci i hydrauliki rzecznej.

---

## ⚠️ Kluczowe Wyjaśnienie: Stan Obecny (*As-Is*) vs. Architektura Docelowa (*To-Be*)

Częstym źródłem nieporozumień jest poszukiwanie plików takich jak:
- `src/generators/wind-generator.ts`
- `src/generators/ocean-currents-generator.ts`
- `src/generators/temperature-generator.ts`
- `src/generators/precipitation-generator.ts`
- `src/renderers/draw-wind.ts`
- `src/renderers/draw-ocean-currents.ts`
- `src/controllers/ocean-currents-editor.ts`
- `src/controllers/wind-currents-editor.ts`

**Te pliki NIE ISTNIEJĄ jeszcze w kodzie źródłowym repozytorium.**  
Są one **specyfikacją docelową (zielone pole / Greenfield)** zdefiniowaną w dokumentach projektowych (`docs/2026-08-14-wind-and-ocean-currents-engine.md` oraz `docs/aero_hydro_complete_system_redesign.md`).

### Gdzie znajduje się REALNY kod w stanie obecnym:
1. **Wiatry i Opady:** `public/main.js` $\to$ funkcja `generatePrecipitation()` (1D kąty wiatru `options.winds`, liniowy marsz `passWind()`, rysowanie strzałek `\u21C7` do `#prec`).
2. **Temperatury:** `public/main.js` $\to$ funkcja `calculateTemperatures()` (strefowa temperatura poziomu morza + spadek $6.5^\circ\text{C}/\text{km}$).
3. **Prądy Morskie:** FMG **nie posiadał** dotąd symulacji prądów morskich ani wektorów oceanicznych (istnieją jedynie obrysy wybrzeża `grid.cells.t` w `src/generators/ocean-generator.ts` i `src/renderers/draw-ocean.ts`).
4. **Rzeki i Zlewnie:** `src/generators/river-generator.ts` $\to$ akumulacja `cells.fl` i szerokość rzeki w `getOffset()`.
5. **Jeziora:** `src/generators/lakes.ts` $\to$ proste jeziora z odpływem lub bez.
6. **Biomy:** `src/generators/biomes-generator.ts` $\to$ matryca 84 biomów na podstawie `cells.temp` i `cells.prec`.

---

## 1. Dokumentacja Architektoniczna i Projektowa (`docs/`)

W folderze `docs/` znajdują się wszystkie oficjalne dokumenty projektowe repozytorium:

- **[`docs/architecture.md`](./docs/architecture.md)**: Główny blueprint architektoniczny FMG 2.0 (podział: State $\to$ Generators $\to$ Editors $\to$ Renderers, zasada niemutowania danych przez renderery, zarządzanie pamięcią).
- **[`docs/data_model.md`](./docs/data_model.md)** & **[`docs/future_data_model.md`](./docs/future_data_model.md)**: Struktura danych `grid` (Voronoi) i `pack` (świat gry), typowane tablice, konwencje jednostek.
- **[`docs/glossary.md`](./docs/glossary.md)**: Słownik pojęć domenowych (Burg, Feature, Cell, Basin, Voronoi itd.).
- **[`docs/migration_guide.md`](./docs/migration_guide.md)**: Wytyczne migracji z monolitycznego JavaScript do TypeScript i modułów.
- **[`docs/generation_pipeline.md`](./docs/generation_pipeline.md)**: 16 faz generowania mapy (Faza 4 = klimat/położenie globu, Faza 6 = rzeki/biomy).
- **[`docs/aero_hydro_complete_system_redesign.md`](./docs/aero_hydro_complete_system_redesign.md)**: Kompletna specyfikacja fizyczno-matematyczna Aero-Hydro 2.0 (ciśnienie $P(x,y)$, Coriolis, monsuny, $\vec{\tau}$ napędzające gyres, Clausius-Clapeyron, orografia, Leopold-Maddock $W = a \cdot Q^{0.5}$, Strahler, Priority-Flood, Lagrangian Streamlines).
- **[`docs/2026-08-14-wind-and-ocean-currents-engine.md`](./docs/2026-08-14-wind-and-ocean-currents-engine.md)**: 10-krokowy plan wdrożenia TDD.

---

## 2. Architektura i Wywołania Strukturalne (Entry Points)

- **[`public/main.js`](./public/main.js)**:
  - Faza 4 generowania mapy (linie 439–444):
    ```javascript
    defineMapSize();
    calculateMapCoordinates();
    generateAeroHydro();
    calculateTemperatures();
    generatePrecipitation();
    ```
  - Legacy funkcje klimatyczne: `calculateTemperatures()` (linie 714–760) oraz `generatePrecipitation()` (linie 763–850+).
- **[`src/controllers/world-configurator.ts`](./src/controllers/world-configurator.ts)**:
  - Konfiguracja parametrów globu i wiatrów; wywołania rekalkulacji klimatu.
- **[`src/controllers/heightmap-editor.ts`](./src/controllers/heightmap-editor.ts)**:
  - Narzędzie rzeźbienia terenu; `regenerateErasedData()` i `restoreRiskedData()` po zmianie wysokości.
- **[`src/generators/resample.ts`](./src/generators/resample.ts)**:
  - Skalowanie i tworzenie submap.

---

## 3. Typy Danych i Układ Pamięci (`src/types/`)

- **[`src/types/global.ts`](./src/types/global.ts)**: Deklaracje globalne `grid`, `pack`, `options.winds`, `mapCoordinates`, `generateAeroHydro`.
- **[`src/types/PackedGraph.ts`](./src/types/PackedGraph.ts)**: Interfejs `pack` (`cells`, `vertices`, `rivers`, `features`, `flowFeatures`).

---

## 4. Powiązane Generatory (`src/generators/`)

- **[`src/generators/river-generator.ts`](./src/generators/river-generator.ts)** & **[`river-generator.test.ts`](./src/generators/river-generator.test.ts)**:
  Generowanie rzek, zlewni, depresji i szerokości koryta.
- **[`src/generators/lakes.ts`](./src/generators/lakes.ts)**:
  Zarządzanie jeziorami i bilans dopływów.
- **[`src/generators/biomes-generator.ts`](./src/generators/biomes-generator.ts)**:
  Klasyfikacja 84 biomów na podstawie `temp` i `prec`.
- **[`src/generators/ice-generator.ts`](./src/generators/ice-generator.ts)**:
  Generowanie lodu morskiego i czap lodowych na biegunach.
- **[`src/generators/ocean-generator.ts`](./src/generators/ocean-generator.ts)**:
  Obrysy wybrzeża i odległości szelfowe (`cells.t`).
- **[`src/generators/features.ts`](./src/generators/features.ts)**:
  Klasyfikacja lądów, mórz i jezior na siatce Voronoi.

---

## 5. System Warstw i Renderery (`src/components/` & `src/renderers/`)

> **Kluczowa zasada FMG 2.0:** Wszystkie warstwy SVG są zarządzane przez `LayersRegistry` w [`src/components/layers.ts`](./src/components/layers.ts). Każda nowa warstwa (`wind`, `oceanCurrents`) musi być zdefiniowana jako instancja `Layer` w `mapLayers`.

- **[`src/components/layers.ts`](./src/components/layers.ts)**: Rejestr warstw, kolejność DOM, cykl życia (`draw`, `erase`, `permanent`, `keepContent`).
- **[`src/components/tools.ts`](./src/components/tools.ts)**: Obsługa przycisków menu narzędziowego (w tym `editAeroHydroButton`).
- **[`src/renderers/draw-temperature.ts`](./src/renderers/draw-temperature.ts)**: Renderer izoterm i temperatur.
- **[`src/renderers/draw-precipitation.ts`](./src/renderers/draw-precipitation.ts)**: Renderer opadów i strzałek wiatru.
- **[`src/renderers/draw-ocean.ts`](./src/renderers/draw-ocean.ts)**: Renderer warstw oceanicznych (izobaty).
- **[`src/renderers/draw-rivers.ts`](./src/renderers/draw-rivers.ts)**: Renderer koryt rzecznych w SVG.
- **[`src/renderers/draw-lakes.ts`](./src/renderers/draw-lakes.ts)**: Renderer tafli jezior.

---

## 6. Serializacja i Kompatybilność Wsteczna (`src/services/io/`)

- **[`src/services/io/save.ts`](./src/services/io/save.ts)**: Serializacja 52 linii pliku `.map` (linia 50 = stan `layers`, linia 51 = `flowFeatures`).
- **[`src/services/io/load.ts`](./src/services/io/load.ts)**: Parsowanie pliku `.map` i odtwarzanie grafu Voronoi.
- **[`src/services/io/auto-update.ts`](./src/services/io/auto-update.ts)**: Migracja starszych wersji map do bieżącego standardu.
