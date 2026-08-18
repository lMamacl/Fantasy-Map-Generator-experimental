# Plan Realizacji: Zaawansowany Silnik Wiatrów i Prądów Morskich (Aero-Hydro 2.0)

> **Dla Agenta Realizującego:** WYMAGANA SUB-UMIEJĘTNOŚĆ: Użyj `superpowers:executing-plans` lub `subagent-driven-development`, aby wdrażać ten plan zadanie po zadaniu w rygorze TDD.

**Cel:** Stworzenie fizycznie wiarygodnego, zintegrowanego modelu wiatrów 2D i powierzchniowych prądów morskich, oddziałującego na orografię, cieśniny, temperaturę, opady i biomy, wraz z ultra-wydajną wizualizacją wstęg strumieniowych (Lagrangian Streamlines).

**Architektura:** Dwuwymiarowe pole ciśnienia barycznego $P(x,y)$ z siłą Coriolisa i kontrastem ląd-morze $\rightarrow$ wektory wiatru $\vec{V}_{\text{wind}}$ modyfikowane orograficznie (odchylenie wzdłuż łańcuchów górskich i przyspieszenie Venturiego w cieśninach) $\rightarrow$ naprężenie wiatru napędzające pętle oceaniczne (*gyres*) $\vec{V}_{\text{ocean}}$ $\rightarrow$ anomalie SST i parowania $\rightarrow$ adwekcja wilgoci 2D $\rightarrow$ deszcz orograficzny, cień opadowy i biomy. Wizualizacja: wstęgi całkowe oparte na śledzeniu cząstek (*Lagrangian Streamlines*), bez zaśmiecania mapy tysiącami strzałek.

**Stos Technologiczny:** TypeScript, Vitest (TDD), SVG (DOM/Path interpolation), Float32Array (SIMD-friendly typed arrays), D3-geo / Bezier smoothing.

---

## Mapa Zadań (Task Breakdown)

```
[Task 1: Typy i Pola Grid] ──► [Task 2: Generator Ciśnienia i Wiatru 2D] ──► [Task 3: Orografia i Cieśniny Venturiego]
                                                                                     │
[Task 5: Sprzężenie z Klimatem i Opadami 2D] ◄── [Task 4: Sprzężenie z Prądami Morskimi i SST]
         │
         ├──► [Task 6: Renderer Wstęg Wiatru]
         ├──► [Task 7: Renderer Wstęg Prądów Morskich]
         └──► [Task 8: Integracja z Pipeline FMG] ──► [Task 9: Kontroler i Edytor UI] ──► [Task 10: Weryfikacja i Testy]
```

---

### Zadanie 1: Model Danych i Typy dla Wiatrów i Ciśnienia

**Pliki do modyfikacji:**
- Modyfikacja: `src/types/global.ts`
- Modyfikacja: `src/generators/ocean-currents-generator.ts`

**Krok 1: Definicja struktur danych**
Rozszerz interfejs `Grid` w `src/types/global.ts` o pola wektorowe i skalarne:
* `pressure`: `Float32Array` (ciśnienie atmosferyczne w hPa)
* `windU`: `Float32Array` (składowa X wektora wiatru)
* `windV`: `Float32Array` (składowa Y wektora wiatru)
* `windSpeed`: `Float32Array` (prędkość wiatru w m/s)
* `oceanU`: `Float32Array` (składowa X prądu morskiego)
* `oceanV`: `Float32Array` (składowa Y prądu morskiego)
* `sstAnomaly`: `Float32Array` (anomalia temperatury oceanu w °C)
* `evapBoost`: `Float32Array` (mnożnik parowania z oceanu)

**Krok 2: Weryfikacja typowania**
Uruchom: `npm run lint`  
Oczekiwany rezultat: Brak błędów typowania.

---

### Zadanie 2: Generator Pola Ciśnienia i Wiatrów 2D (TDD)

**Pliki:**
- Tworzenie: `src/generators/wind-generator.test.ts`
- Tworzenie: `src/generators/wind-generator.ts`

**Krok 1: Napisanie testu jednostkowego (Red)**
```typescript
// src/generators/wind-generator.test.ts
import { beforeEach, describe, expect, it } from "vitest";

describe("WindGenerator", () => {
  let windGenerator: any;

  beforeEach(async () => {
    globalThis.TIME = false;
    globalThis.mapCoordinates = { latN: 60, latS: 0, latT: 60, lonW: -30, lonE: 30, lonT: 60 } as any;
    globalThis.options = { winds: [225, 45, 225, 315, 135, 315] } as any;

    const n = 100; // 10x10 grid
    globalThis.grid = {
      cellsX: 10,
      cellsY: 10,
      spacing: 10,
      cells: {
        i: Array.from({ length: n }, (_, i) => i),
        h: new Uint8Array(n).fill(10), // water
        temp: new Int8Array(n).fill(15)
      }
    } as any;

    const { WindGenerator } = await import("./wind-generator");
    windGenerator = WindGenerator;
  });

  it("generates 2D pressure and continuous wind vector field", () => {
    windGenerator.generate();
    expect(globalThis.grid.pressure).toBeDefined();
    expect(globalThis.grid.windU).toBeDefined();
    expect(globalThis.grid.windV).toBeDefined();
    expect(globalThis.grid.windSpeed).toBeDefined();
    expect(globalThis.grid.pressure.length).toBe(100);
    // Westerlies should have eastward (positive U) component in mid latitudes
    expect(globalThis.grid.windU.some((u: number) => Math.abs(u) > 0)).toBe(true);
  });
});
```

**Krok 2: Uruchomienie testu i weryfikacja niepowodzenia**
Uruchom: `npm test src/generators/wind-generator.test.ts`  
Oczekiwany rezultat: FAIL (moduł nie istnieje).

**Krok 3: Implementacja minimalnego kodu (Green)**
W `src/generators/wind-generator.ts`:
* Obliczanie strefowego profilu ciśnienia $P_{\text{zonal}}(\phi)$ na podstawie szerokości geograficznej (Hadley/Ferrel/Polar).
* Wyznaczanie gradientu ciśnienia 2D: $\nabla P = (\partial P/\partial x, \partial P/\partial y)$.
* Obliczenie wektorów wiatru geostroficznego $U = -\frac{1}{\rho f}\frac{\partial P}{\partial y}, V = \frac{1}{\rho f}\frac{\partial P}{\partial x}$ z kątem odchylenia tarciowego.

**Krok 4: Uruchomienie testu i weryfikacja powodzenia**
Uruchom: `npm test src/generators/wind-generator.test.ts`  
Oczekiwany rezultat: PASS.

---

### Zadanie 3: Interakcja Wiatru z Orografią i Efekt Cieśnin Venturiego (TDD)

**Pliki:**
- Modyfikacja: `src/generators/wind-generator.test.ts`
- Modyfikacja: `src/generators/wind-generator.ts`

**Krok 1: Napisanie testu jednostkowego dla cieśnin i pasm górskich**
```typescript
it("accelerates wind in narrow straits (Venturi effect) and deflects along mountains", () => {
  // Setup a narrow strait between two landmasses
  const h = new Uint8Array(100).fill(10); // water
  // Left and right barriers leaving row 5 as a narrow channel
  for (let y = 0; y < 10; y++) {
    if (y !== 4 && y !== 5) {
      h[y * 10 + 4] = 60; // Mountain on left
      h[y * 10 + 6] = 60; // Mountain on right
    }
  }
  globalThis.grid.cells.h = h;

  windGenerator.generate();

  const straitCell = 5 * 10 + 5;
  const openOceanCell = 0 * 10 + 0;

  // Strait wind speed should be amplified by Venturi factor
  expect(globalThis.grid.windSpeed[straitCell]).toBeGreaterThan(globalThis.grid.windSpeed[openOceanCell] * 0.9);
});
```

**Krok 2: Implementacja algorytmów orograficznych w `wind-generator.ts`**
* Obliczanie wektora normalnego do terenu i rozkład prędkości na składową styczną i prostopadłą do pasma górskiego.
* Detekcja szerokości przesmyków (*gap width*) i mnożnik Venturiego $k_{\text{venturi}} = 1.0 + 1.8 \cdot (1.0 - W/W_{\max})^2$.

**Krok 3: Uruchomienie testów**
Uruchom: `npm test src/generators/wind-generator.test.ts`  
Oczekiwany rezultat: PASS.

---

### Zadanie 4: Sprzężenie z Prądami Morskimi i Anomaliami SST (TDD)

**Pliki:**
- Modyfikacja: `src/generators/ocean-currents-generator.test.ts`
- Modyfikacja: `src/generators/ocean-currents-generator.ts`

**Krok 1: Napisanie testu jednostkowego**
```typescript
it("generates wind-driven ocean gyres with positive SST anomaly for poleward currents", () => {
  oceanCurrentsGenerator.generate();
  expect(globalThis.grid.oceanU).toBeDefined();
  expect(globalThis.grid.oceanV).toBeDefined();
  expect(globalThis.grid.sstAnomaly).toBeDefined();
  expect(globalThis.grid.evapBoost).toBeDefined();
  // Warm poleward currents have positive SST anomaly
  expect(globalThis.grid.sstAnomaly.some((t: number) => t > 0)).toBe(true);
});
```

**Krok 2: Refaktoryzacja `OceanCurrentsModule`**
* Przekształcenie naprężenia wiatru $\vec{\tau}$ w prąd powierzchniowy w komórkach wody ($h < 20$).
* Rzutowanie wektorów na wektory styczne do wybrzeża $\vec{T}_{\text{coast}}$ (prądy wzdłużbrzeżne).
* Wyznaczanie transportu termicznego: woda płynąca z równika ku biegunom niesie anomalię $\Delta T \in [+1.5, +5.5]^\circ\text{C}$ (ciepły prąd), a woda spływająca z biegunów niesie $\Delta T \in [-1.5, -4.5]^\circ\text{C}$ (zimny prąd).
* Obliczenie wskaźnika stymulacji parowania `evapBoost`.

**Krok 3: Uruchomienie testów**
Uruchom: `npm test src/generators/ocean-currents-generator.test.ts`  
Oczekiwany rezultat: PASS.

---

### Zadanie 5: Sprzężenie z Temperaturą i Opadami 2D (TDD)

**Pliki:**
- Modyfikacja: `src/generators/temperature-generator.ts`
- Modyfikacja: `src/generators/precipitation-generator.ts`
- Modyfikacja: `src/generators/precipitation-generator.test.ts`

**Krok 1: Integracja temperatury SST z `temperature-generator.ts`**
* Odczyt `grid.sstAnomaly[cellId]` i dodanie go do temperatury poziomu morza.

**Krok 2: Adwekcja wilgoci 2D w `precipitation-generator.ts`**
* Zastąpienie 1D liniowych pętli równoleżnikowych wielokrokową adwekcją wilgoci wzdłuż wektorów `(windU, windV)`.
* Obliczenie zrzutu deszczu orograficznego przy wznoszeniu ($\vec{V} \cdot \nabla h > 0$) oraz cienia opadowego za szczytami ($h \ge 70$).
* Uwzględnienie wzmocnienia parowania z ciepłych prądów morskich (`grid.evapBoost`).

**Krok 3: Uruchomienie testów**
Uruchom: `npm test src/generators/precipitation-generator.test.ts`  
Oczekiwany rezultat: PASS.

---

### Zadanie 6: Nowoczesny Renderer Wstęg Wiatru (Lagrangian Streamlines)

**Pliki:**
- Tworzenie: `src/renderers/draw-wind.ts`
- Modyfikacja: `src/renderers/index.ts`

**Krok 1: Implementacja algorytmu wstęg prądu (Streamlines)**
* Algorytm nasion cząstek (*Streamline Seeding*) z kontrolą minimalnego odstępu $d_{\text{sep}}$.
* Całkowanie Runge-Kutta 2 rzędu (RK2) wzdłuż wektorów `windU, windV`.
* Wygładzanie krzywymi Beziera/Catmull-Rom.
* Kodowanie kolorystyczne:
  * Wilgotne masy morskie: lodowy błękit / cyjan (`#38bdf8` - `#0284c7`).
  * Suche masy lądowe i feny: ciepłe złoto / bursztyn (`#f59e0b` - `#d97706`).
* Opcjonalna subtelna animacja `stroke-dasharray` w CSS.

---

### Zadanie 7: Nowoczesny Renderer Wstęg Prądów Morskich

**Pliki:**
- Modyfikacja: `src/renderers/draw-ocean-currents.ts`

**Krok 1: Wdrożenie wielopasmowych wstęg (Ribbon Bundles)**
* Tracing wstęg wzdłuż wektorów prądów morskich `oceanU, oceanV`.
* Meandrowanie w głębokim oceanie i zwężenie w cieśninach (Gibraltar, Gallipoli).
* Paleta barwna:
  * Ciepłe prądy: Szkarłat / Złoto / Szmaragd (`#ef4444`, `#f59e0b`, `#10b981`).
  * Zimne prądy: Lodowy Cyjan / Indygo / Granat (`#38bdf8`, `#1e3a8a`, `#0f172a`).

---

### Zadanie 8: Integracja z Pipeline FMG 2.0 i Warstwami

**Pliki:**
- Modyfikacja: `public/main.js` (Faza 4 w `generate()`)
- Modyfikacja: `src/controllers/heightmap-editor.ts` (`regenerateErasedData` & `restoreRiskedData`)
- Modyfikacja: `src/generators/resample.ts` (`Resampler.process`)
- Modyfikacja: `src/renderers/viewport/viewport-renderer.ts` (obsługa warstw `toggleWind`, `toggleOceanCurrents`)

**Krok 1: Wpięcie wywołania generatorów**
* Kolejność wywołań w Fazie 4:
  1. `WindGenerator.generate()`
  2. `OceanCurrentsGenerator.generate()`
  3. `TemperatureGenerator.generate()`
  4. `PrecipitationGenerator.generate()`

---

### Zadanie 9: Kontroler i Edytor Wiatrów i Prądów

**Pliki:**
- Tworzenie: `src/controllers/wind-currents-editor.ts`
- Modyfikacja: `src/controllers/index.ts`
- Modyfikacja: `src/controllers/ocean-currents-editor.ts`

**Krok 1: Interfejs dialogowy**
* Suwaki intensywności komórek ciśnienia (Hadley/Ferrel, monsuny).
* Przełącznik podglądu warstwy wiatru i prądów.
* Interaktywne dodawanie i przesuwanie punktów wyżów/niżów na mapie.
* Przycisk natychmiastowej rekalkulacji klimatu i biomów.

---

### Zadanie 10: Weryfikacja Końcowa, Testy i Optymalizacja

**Krok 1: Uruchomienie pełnego zestawu testów**
Uruchom: `npm test`  
Oczekiwany rezultat: Wszystkie testy przechodzą pomyślnie.

**Krok 2: Linting i weryfikacja standardów kodu**
Uruchom: `npm run lint`  
Oczekiwany rezultat: Brak błędów lintera Biome.

**Krok 3: Profilowanie wydajnościowe**
Sprawdzenie w konsoli czasu `generateWind` + `generateOceanCurrents` ($< 25\text{ ms}$).
