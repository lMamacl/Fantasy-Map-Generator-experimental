# Testy Aero-Hydro 2.0 - Kompletny Plan Weryfikacji
## System Testów Jednostkowych, Integracyjnych i Jakościowych

**Data:** 19 sierpnia 2026  
**Status:** gotowy do wdrożenia  
**Cel:** Zapobieganie typowym błędom agentów, zapewnienie mierzalnych kryteriów, analiza jakości

---

# 1. WYKRYTE WZORCE Z ISTNIEJĄCYCH TESTÓW

## 1.1. Pattern 1: Minimalne Mock Data
**Źródło:** `src/generators/river-generator.test.ts`, `src/generators/burgs-generator.test.ts`

```typescript
// Wzorzec: definiowanie minimalnych struktur danych
const BASE_CELLS = {
  haven: [0, 4, 4, 0, 0, 0],
  harbor: [0, 1, 1, 0, 0, 0],
  f: [0, 0, 0, 0, 1, 2],
  fl: [0, 0, 0, 0, 0, 0],
  p: [[0, 0], [0, 5], [10, 5], [0, 0], [5, 5], [20, 5]],
  v: [[], [0, 1], [2, 3], [], [], []]
};
```

**Zastosowanie w Aero-Hydro:**
```typescript
// Definicja minimalnego pola ciśnienia dla testów atmosfery
const BASE_PRESSURE = new Float32Array(100);
// Wypełnij prostym gradientem: 1013 hPa na zachodzie, 990 hPa na wschodzie
for (let x = 0; x < 10; x++) {
  for (let y = 0; y < 10; y++) {
    BASE_PRESSURE[x * 10 + y] = 1013 - x * 2.3;
  }
}
```

## 1.2. Pattern 2: beforeEach + Re-import
**Źródło:** Wszystkie testy w `src/generators/`

```typescript
beforeEach(async () => {
  globalThis.TIME = false;
  globalThis.window = globalThis.window || ({} as any);
  globalThis.pack = { cells: { r: [], fl: [], f: [] }, features: [], rivers: [] } as any;
  globalThis.grid = { cells: { temp: new Array(10).fill(20) } } as any;

  await import("./river-generator");
  Rivers = (globalThis as any).Rivers;
});
```

**Zastosowanie w Aero-Hydro:**
```typescript
beforeEach(async () => {
  globalThis.TIME = false;
  // Reset all climate state
  globalThis.grid = {
    cells: {
      h: new Uint8Array(100),
      temp: new Int8Array(100),
      prec: new Uint8Array(100),
      pressure: new Float32Array(100),
      windU: new Float32Array(100),
      windV: new Float32Array(100),
      moisture: new Float32Array(100)
    },
    vertices: { c: [], p: [] }
  } as any;
  globalThis.pack = {
    cells: { r: [], fl: [], f: [], g: [] },
    features: [],
    rivers: []
  } as any;

  await import("./aero-hydro/atmosphere-engine");
  AtmosphereEngine = (globalThis as any).AtmosphereEngine;
});
```

## 1.3. Pattern 3: Test Edge Cases Explicitly
**Źródło:** `src/generators/river-generator.test.ts`

```typescript
// Testy przypadków granicznych
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
```

**Zastosowanie w Aero-Hydro:**
```typescript
// Testy przypadków granicznych dla klimatu
it("returns zero wind for cells outside the map bounds", () => {
  // Testuj wektory wiatru na granicach
});

it("handles NaN values in pressure field gracefully", () => {
  // Testuj, co się dzieje gdy ciśnienie jest NaN
});
```

---

# 2. TYPOWE BŁĘDY AGENTÓW I JAK IM ZAPOBIEC

## 2.1. Błąd Agentów #1: Uproszczenie Fizyki

### Problem
Agenty często implementują **zbyt proste modele fizyczne**, które wyglądają poprawnie w prostych przypadkach, ale failują w złożonych scenariuszach.

### Przykłady:
- **Zbyt prosty model opadów:** `precipitation = wind_speed * humidity` (brak efektu orograficznego)
- **Zbyt prosty model wiatrów:** `wind = gradient_pressure * constant` (brak efektu Coriolisa)
- **Zbyt prosty model temperatury:** `temperature = latitude * constant` (brak gradientu wysokościowego)

### Jak Zapobiec - Testy:

```typescript
// test-plan/aero-hydro/physics-safeguards.test.ts
describe('Zabezpieczenia przed uproszczeniem fizyki', () => {
  test('model opadów uwzględnia efekt orograficzny', () => {
    // Scenariusz: góra 80 jednostek w centrum mapy, wiatr wieje od zachodu
    const grid = createGrid(100, 100);

    // Wypełnij górę
    for (let x = 40; x < 60; x++) {
      for (let y = 40; y < 60; y++) {
        grid.cells.h[grid.index(x, y)] = 80;
      }
    }

    // Ustaw wiatr od zachodu
    grid.cells.windU = new Float32Array(10000).fill(5); // 5 m/s od zachodu
    grid.cells.moisture = new Float32Array(10000).fill(10); // 10 g/kg

    generateAeroHydro(grid);

    // Sprawdź, że po zawietrznej stronie (prawej) opady spadły
    const precipWindward = grid.cells.prec.slice(400, 600); // Lewa strona góry
    const precipLeeward = grid.cells.prec.slice(600, 800); // Prawa strona góry

    const avgWindward = precipWindward.reduce((a, b) => a + b, 0) / precipWindward.length;
    const avgLeeward = precipLeeward.reduce((a, b) => a + b, 0) / precipLeeward.length;

    // Cień deszczowy powinien zmniejszyć opady o > 30%
    expect(avgLeeward).toBeLessThan(avgWindward * 0.7);

    // Komentarz: Jeśli test pada, agent prawdopodobnie zaimplementował
    // model bez efektu orograficznego lub z zbytnim uproszczeniem
    console.log(`✅ Efekt orograficzny: ${((1 - avgLeeward / avgWindward) * 100).toFixed(1)}% redukcji`);
  });

  test('model wiatrów uwzględnia efekt Coriolisa', () => {
    // Scenariusz: prosty gradient ciśnienia zachód-wschód
    const grid = createGrid(100, 100);
    grid.cells.pressure = new Float32Array(10000);
    for (let x = 0; x < 100; x++) {
      for (let y = 0; y < 100; y++) {
        grid.cells.pressure[grid.index(x, y)] = 1013 - x * 1.5;
      }
    }

    generateAeroHydro(grid);

    // Sprawdź, że wiatr nie jest równoległy do gradientu ciśnienia
    // (co byłoby błędem bez efektu Coriolisa)
    const windAtEquator = grid.cells.windU.slice(5000, 5100); // Równik
    const windAtMidLat = grid.cells.windU.slice(2500, 2600); // 45° N

    // Na równiku efekt Coriolisa jest zerowy, wiatr powinien być prostopadły do gradientu
    // Na średnich szerokościach efekt Coriolisa powoduje odchylenie
    const equatorWindAngle = Math.atan2(windAtEquator.reduce((a, b) => a + b, 0) / windAtEquator.length, 
                                        windAtEquator.reduce((a, b) => a + b, 0) / windAtEquator.length);
    const midLatWindAngle = Math.atan2(windAtMidLat.reduce((a, b) => a + b, 0) / windAtMidLat.length,
                                       windAtMidLat.reduce((a, b) => a + b, 0) / windAtMidLat.length);

    // Różnica kątów powinna być znacząca (> 15°)
    expect(Math.abs(equatorWindAngle - midLatWindAngle) * 180 / Math.PI).toBeGreaterThan(15);

    // Komentarz: Jeśli test pada, agent prawdopodobnie zaimplementował
    // model bez efektu Coriolisa lub z zbytnim uproszczeniem
    console.log(`✅ Efekt Coriolisa: zmiana kąta o ${Math.abs(equatorWindAngle - midLatWindAngle) * 180 / Math.PI.toFixed(1)}°`);
  });

  test('model temperatury uwzględnia gradient wysokościowy', () => {
    // Scenariusz: góra 80 jednostek, nizinna okolica 20 jednostek
    const grid = createGrid(100, 100);

    // Wypełnij góry
    for (let x = 40; x < 60; x++) {
      for (let y = 40; y < 60; y++) {
        grid.cells.h[grid.index(x, y)] = 80;
        grid.cells.temp[grid.index(x, y)] = 20; // Bazowa temperatura
      }
    }

    generateAeroHydro(grid);

    // Sprawdź, że temperatura na górze jest niższa niż w dolinie
    const tempMountain = grid.cells.temp.slice(2400, 2600); // Wierzchołek góry
    const tempValley = grid.cells.temp.slice(0, 100); // Dolina

    const avgMountain = tempMountain.reduce((a, b) => a + b, 0) / tempMountain.length;
    const avgValley = tempValley.reduce((a, b) => a + b, 0) / tempValley.length;

    // Różnica powinna być > 10°C (standardowy gradient: 6.5°C/km)
    expect(avgValley - avgMountain).toBeGreaterThan(10);

    // Komentarz: Jeśli test pada, agent prawdopodobnie zaimplementował
    // model bez gradientu wysokościowego lub z zbytnim uproszczeniem
    console.log(`✅ Gradient wysokościowy: ${((avgValley - avgMountain)).toFixed(1)}°C różnicy`);
  });
});
```

## 2.2. Błąd Agentów #2: Ignorowanie Warunków Brzegowych

### Problem
Agenty często implementują algorytmy **bez uwzględnienia warunków brzegowych**, co prowadzi do artefaktów na krawędziach mapy.

### Przykłady:
- **Ciągłość cylindryczna:** Wiatr na zachodniej krawędzi nie łączy się z wschodnią
- **Prąd morskie na brzegu:** Prąd wchodzi na ląd lub znika na krawędzi
- **Opady na granicy:** Nagłe skoki opadów na krawędziach mapy

### Jak Zapobiec - Testy:

```typescript
// test-plan/aero-hydro/boundary-conditions.test.ts
describe('Zabezpieczenia przed ignorowaniem warunków brzegowych', () => {
  test('wiatr jest ciągły na granicach cylindrycznych', () => {
    const grid = createGrid(100, 100);
    grid.cells.pressure = new Float32Array(10000);
    // Prostý gradient
    for (let x = 0; x < 100; x++) {
      for (let y = 0; y < 100; y++) {
        grid.cells.pressure[grid.index(x, y)] = 1013 - x * 1.5;
      }
    }

    generateAeroHydro(grid);

    // Sprawdź, że wektor wiatru na zachodniej krawędzi jest równy wektorowi na wschodniej
    const windWest = grid.cells.windU.filter((_, i) => i % 100 === 0);
    const windEast = grid.cells.windU.filter((_, i) => i % 100 === 99);

    const avgWest = windWest.reduce((a, b) => a + b, 0) / windWest.length;
    const avgEast = windEast.reduce((a, b) => a + b, 0) / windEast.length;

    // Różnica powinna być < 0.5 m/s (praktycznie ciągła)
    expect(Math.abs(avgWest - avgEast)).toBeLessThan(0.5);

    // Komentarz: Jeśli test pada, agent prawdopodobnie nie zaimplementował
    // cylindrycznego zawijania lub zrobił to niepoprawnie
    console.log(`✅ Ciągłość cylindryczna: różnica ${Math.abs(avgWest - avgEast).toFixed(3)} m/s`);
  });

  test('prądy morskie szanują kontury lądu', () => {
    const grid = createGrid(100, 100);

    // Stwórz prosty kontynent w centrum
    for (let x = 30; x < 70; x++) {
      for (let y = 30; y < 70; y++) {
        grid.cells.h[grid.index(x, y)] = 50; // Ląd
      }
    }

    generateAeroHydro(grid);

    // Sprawdź, że prądy morskie nie wchodzą na ląd
    for (let i = 0; i < grid.cells.i.length; i++) {
      if (grid.cells.h[i] >= 20) { // Ląd
        expect(grid.cells.oceanSpeed[i]).toBe(0);
      }
    }

    // Komentarz: Jeśli test pada, agent prawdopodobnie nie zaimplementował
    // maski lądu lub zrobił to niepoprawnie
    console.log(`✅ Prądy morskie na lądzie: ${grid.cells.oceanSpeed.filter(s => s > 0 && grid.cells.h[grid.cells.oceanSpeed.indexOf(s)] >= 20).length} naruszeń`);
  });

  test('opady nie zawierają nagłych skoków na krawędziach', () => {
    const grid = createGrid(100, 100);
    generateAeroHydro(grid);

    // Sprawdź, że opady na krawędziach nie skaczą gwałtownie
    const precipEdgeWest = grid.cells.prec.filter((_, i) => i % 100 === 0);
    const precipEdgeEast = grid.cells.prec.filter((_, i) => i % 100 === 99);

    // Porównaj sąsiednie komórki
    for (let i = 0; i < precipEdgeWest.length; i++) {
      const idx = i;
      const nextIdx = idx + 1;
      if (nextIdx < grid.cells.prec.length) {
        const diff = Math.abs(grid.cells.prec[idx] - grid.cells.prec[nextIdx]);
        // Różnica nie powinna przekraczać 20% wartości średniej
        const avgPrecip = grid.cells.prec.reduce((a, b) => a + b, 0) / grid.cells.prec.length;
        expect(diff).toBeLessThan(avgPrecip * 0.2);
      }
    }

    // Komentarz: Jeśli test pada, agent prawdopodobnie nie zaimplementował
    // wygładzania lub interpolacji na krawędziach
    console.log(`✅ Brak nagłych skoków na krawędziach: max różnica ${Math.max(...precipEdgeWest.map((v, i) => Math.abs(v - (precipEdgeWest[i + 1] || 0)))).toFixed(1)}%`);
  });
});
```

## 2.3. Błąd Agentów #3: Zbyt Duża Gęstość Elementów

### Problem
Agenty często **generują za dużo elementów** (rzek, biomów, etykiet), co prowadzi do nieczytelnych map.

### Przykłady:
- **Za dużo rzek:** Mapa pokryta tysiącami mikroskopijnych cieków
- **Za dużo biomów:** Każdy biome ma inną teksturę, co tworzy "mozaikę"
- **Za dużo etykiet:** Etykiety nakładają się na siebie i zasłaniają mapę

### Jak Zapobiec - Testy:

```typescript
// test-plan/aero-hydro/density-safeguards.test.ts
describe('Zabezpieczenia przed zbyt dużą gęstością elementów', () => {
  test('rzeki nie pokrywają > 20% mapy', () => {
    const grid = createGrid(100, 100);
    generateAeroHydro(grid);
    generateRivers(grid);

    const riverCells = new Set<number>();
    for (const river of pack.rivers) {
      if (river.strahlerOrder >= 2) { // Tylko główne rzeki
        for (const cell of river.cells) {
          riverCells.add(cell);
        }
      }
    }

    const totalCells = grid.cells.i.length;
    const riverCoverage = riverCells.size / totalCells;

    expect(riverCoverage).toBeLessThan(0.20);

    // Komentarz: Jeśli test pada, agent prawdopodobnie nie zaimplementował
    // progu minimalnej rzędowości lub nie zastosował maski lądu
    console.log(`✅ Pokrycie rzekami: ${(riverCoverage * 100).toFixed(1)}% (max 20%)`);
  });

  test('biomy nie tworzą mozaiki > 5 komórek', () => {
    const grid = createGrid(100, 100);
    generateAeroHydro(grid);
    generateBiomes(grid);

    // Znajdź największy ciągły obszar tego samego biome
    const visited = new Set<number>();
    let maxArea = 0;

    for (let i = 0; i < grid.cells.i.length; i++) {
      if (!visited.has(i)) {
        const biome = grid.cells.biome[i];
        const area = floodFill(grid, i, biome, visited);
        maxArea = Math.max(maxArea, area);
      }
    }

    // Największy ciągły obszar nie powinien być < 10 komórek
    // (co sugerowałoby "mozaikę")
    expect(maxArea).toBeGreaterThan(10);

    // Komentarz: Jeśli test pada, agent prawdopodobnie nie zaimplementował
    // wygładzania biomów lub zastosowania progu minimalnego obszaru
    console.log(`✅ Najmniejszy biome: ${maxArea} komórek (min 10)`);
  });

  test('etykiety nie nakładają się na siebie', () => {
    const grid = createGrid(100, 100);
    generateAeroHydro(grid);
    generateRivers(grid);
    generateBurgs(grid);
    generateLabels(grid);

    // Sprawdź, że etykiety miast nie nakładają się na etykiety rzek
    const cityLabels = pack.labels.filter(l => l.type === 'city');
    const riverLabels = pack.labels.filter(l => l.type === 'river');

    for (const city of cityLabels) {
      for (const river of riverLabels) {
        const dist = Math.sqrt(
          Math.pow(city.x - river.x, 2) + Math.pow(city.y - river.y, 2)
        );
        // Odległość powinna być > 50 pikseli
        expect(dist).toBeGreaterThan(50);
      }
    }

    // Komentarz: Jeśli test pada, agent prawdopodobnie nie zaimplementował
    // układu etykiet lub nie zastosował progu minimalnej odległości
    console.log(`✅ Brak nakładania etykiet: ${cityLabels.length} miast, ${riverLabels.length} rzek`);
  });
});
```

## 2.4. Błąd Agentów #4: Ignorowanie Jednostek i Skali

### Problem
Agenty często **ignorują jednostki** lub **mylą skalę**, co prowadzi do błędnych wyników.

### Przykłady:
- **Mieszanie pikseli z km:** Szerokość rzeki w pikselach zamiast km
- **Mieszanie jednostek ciśnienia:** hPa vs Pa
- **Mieszanie jednostek temperatury:** Celsius vs Fahrenheit

### Jak Zapobiec - Testy:

```typescript
// test-plan/aero-hydro/unit-safeguards.test.ts
describe('Zabezpieczenia przed błędnymi jednostkami', () => {
  test('szerokość rzeki jest w km, nie w pikselach', () => {
    const grid = createGrid(100, 100);
    generateAeroHydro(grid);
    generateRivers(grid);

    for (const river of pack.rivers) {
      if (river.strahlerOrder >= 2) {
        // Szerokość rzeki powinna być w km (1-10 km dla głównych rzek)
        expect(river.width).toBeGreaterThan(0.5); // > 0.5 km
        expect(river.width).toBeLessThan(20); // < 20 km

        // Komentarz: Jeśli test pada, agent prawdopodobnie zwrócił
        // szerokość w pikselach zamiast km
        console.log(`✅ Rzeka ${river.name}: ${river.width.toFixed(2)} km`);
      }
    }
  });

  test('ciśnienie jest w hPa, nie w Pa', () => {
    const grid = createGrid(100, 100);
    generateAeroHydro(grid);

    const avgPressure = grid.cells.pressure.reduce((a, b) => a + b, 0) / grid.cells.pressure.length;

    // Ciśnienie atmosferyczne na poziomie morza to ~1013 hPa
    expect(avgPressure).toBeGreaterThan(900); // > 900 hPa
    expect(avgPressure).toBeLessThan(1100); // < 1100 hPa

    // Komentarz: Jeśli test pada, agent prawdopodobnie zwrócił
    // ciśnienie w Pa zamiast hPa (różnica 1000x)
    console.log(`✅ Średnie ciśnienie: ${avgPressure.toFixed(1)} hPa`);
  });

  test('temperatura jest w °C, nie w °F', () => {
    const grid = createGrid(100, 100);
    generateAeroHydro(grid);

    const avgTemp = grid.cells.temp.reduce((a, b) => a + b, 0) / grid.cells.temp.length;

    // Temperatura powinna być w zakresie -30 do +40 °C
    expect(avgTemp).toBeGreaterThan(-30);
    expect(avgTemp).toBeLessThan(40);

    // Komentarz: Jeśli test pada, agent prawdopodobnie zwrócił
    // temperaturę w °F zamiast °C
    console.log(`✅ Średnia temperatura: ${avgTemp.toFixed(1)} °C`);
  });
});
```

## 2.5. Błąd Agentów #5: Brak Testowania Skrajnych Przypadków

### Problem
Agenty często **testują tylko "normalne" przypadki**, ignorując skrajne sytuacje.

### Przykłady:
- **Skrajne szerokości geograficzne:** 90° N/S
- **Skrajne wysokości:** 0 lub 100 jednostek
- **Skrajne opady:** 0 mm lub > 5000 mm

### Jak Zapobiec - Testy:

```typescript
// test-plan/aero-hydro/extreme-cases.test.ts
describe('Testowanie skrajnych przypadków', () => {
  test('model działa na biegunach (90° N/S)', () => {
    const grid = createGrid(100, 100);
    grid.cells.pressure = new Float32Array(10000);

    // Ustaw skrajne szerokości geograficzne
    grid.cells.lat = new Float32Array(10000);
    for (let y = 0; y < 100; y++) {
      for (let x = 0; x < 100; x++) {
        grid.cells.lat[grid.index(x, y)] = 90 - y * 1.8; // Od 90° N do 90° S
      }
    }

    // Testuj, że model nie rzuci wyjątku
    expect(() => generateAeroHydro(grid)).not.toThrow();

    // Komentarz: Jeśli test pada, agent prawdopodobnie nie obsłużył
    // skrajnych szerokości geograficznych (np. division by zero)
    console.log(`✅ Model działa na biegunach`);
  });

  test('model działa przy zerowych opadach', () => {
    const grid = createGrid(100, 100);
    grid.cells.prec = new Uint8Array(10000).fill(0); // Zerowe opady

    // Testuj, że model nie rzuci wyjątku
    expect(() => generateRivers(grid)).not.toThrow();

    // Komentarz: Jeśli test pada, agent prawdopodobnie nie obsłużył
    // przypadku zerowych opadów (np. division by zero)
    console.log(`✅ Model działa przy zerowych opadach`);
  });

  test('model działa przy ekstremalnych wysokościach', () => {
    const grid = createGrid(100, 100);
    grid.cells.h = new Uint8Array(10000).fill(100); // Wszystkie komórki na wysokości 100

    // Testuj, że model nie rzuci wyjątku
    expect(() => generateAeroHydro(grid)).not.toThrow();

    // Komentarz: Jeśli test pada, agent prawdopodobnie nie obsłużył
    // ekstremalnych wysokości (np. overflow, underflow)
    console.log(`✅ Model działa przy ekstremalnych wysokościach`);
  });
});
```

---

# 3. TESTY JAKOŚCIOWE - KRYTERIUM 300% RÓŻNICY OPADÓW

## 3.1. Specyfikacja

**Cel:** Zapobieganie sytuacjom, gdzie źle zaimplementowany system rozchodzenia wilgoci powoduje, że część pól otrzymuje niebotyczne ilości deszczu, a te bez nich lub bez rzeki nagle w ogóle ich nie mają.

**Kryterium:** Różnica w opadach pomiędzy komórkami z różnicą elewacji >500m nie powinna być większa niż 300%.

**Jednostki:** `cells.prec` jest w **jednostkach wilgotności (0-255)**, nie w mm/rok.

## 3.2. Implementacja Testu

```typescript
// test-plan/aero-hydro/quality-opcady.test.ts
describe('Testy Jakościowe: Opady - Kryterium 300%', () => {
  test('różnica opadów między komórkami z różnicą elewacji >500m < 300%', () => {
    // Scenariusz: mapa z górami i nizinami
    const grid = createGrid(100, 100);

    // Wypełnij górę (500m+ w jednostkach siatki)
    for (let x = 40; x < 60; x++) {
      for (let y = 40; y < 60; y++) {
        grid.cells.h[grid.index(x, y)] = 80; // > 500m
      }
    }

    generateAeroHydro(grid);

    // Podziel komórki na dwie grupy:
    // 1. Z znaczną różnicą elewacji (>50 jednostek siatki ≈ 500m)
    // 2. Bez znaczącej różnicy elewacji

    const precipHighland: number[] = [];
    const precipLowland: number[] = [];

    for (let i = 0; i < grid.cells.i.length; i++) {
      // Sprawdź, czy komórka jest w strefie górskiej
      const isHighland = grid.cells.h[i] > 50; // > 500m

      if (isHighland) {
        precipHighland.push(grid.cells.prec[i]);
      } else {
        // Sprawdź, czy sąsiaduje z górą (różnica elewacji > 50)
        const neighbors = getNeighbors(i);
        const hasMountainNeighbor = neighbors.some(n => grid.cells.h[n] - grid.cells.h[i] > 50);

        if (hasMountainNeighbor) {
          // To jest komórka "przy górze" - porównaj z komórkami w górze
          precipHighland.push(grid.cells.prec[i]);
        } else {
          precipLowland.push(grid.cells.prec[i]);
        }
      }
    }

    // Oblicz statystyki
    const maxHighland = Math.max(...precipHighland);
    const minLowland = Math.min(...precipLowland.filter(p => p > 0)); // Ignoruj zera

    if (minLowland > 0) {
      const ratio = maxHighland / minLowland;

      // Kryterium: < 300%
      expect(ratio).toBeLessThan(3.0);

      // Komentarz: Jeśli test pada, agent prawdopodobnie:
      // 1. Nie zaimplementował efektu orograficznego
      // 2. Zaimplementował efekt orograficzny z zbytnim wzmocnieniem
      // 3. Nie zastosował wygładzania opadów
      console.log(`✅ Różnica opadów: ${ratio.toFixed(1)}x (max 3.0x)`);
      console.log(`   Max opadów w górach: ${maxHighland.toFixed(1)}`);
      console.log(`   Min opadów w dolinie: ${minLowland.toFixed(1)}`);
    } else {
      // Jeśli nie ma komórek z opadami w dolinie, test jest irrelevant
      console.log(`⚠️ Brak komórek z opadami w dolinie - test irrelevant`);
    }
  });

  test('opady są smooth (bez nagłych skoków)', () => {
    const grid = createGrid(100, 100);
    generateAeroHydro(grid);

    // Oblicz maksymalny skok opadów między sąsiadującymi komórkami
    let maxJump = 0;
    for (let i = 0; i < grid.cells.i.length; i++) {
      const neighbors = getNeighbors(i);
      for (const n of neighbors) {
        const jump = Math.abs(grid.cells.prec[i] - grid.cells.prec[n]);
        maxJump = Math.max(maxJump, jump);
      }
    }

    // Maksymalny skok nie powinien przekraczać 30% maksymalnych opadów
    const maxPrecip = Math.max(...grid.cells.prec);
    const threshold = maxPrecip * 0.3;

    expect(maxJump).toBeLessThan(threshold);

    // Komentarz: Jeśli test pada, agent prawdopodobnie:
    // 1. Nie zastosował wygładzania opadów
    // 2. Zastosował zbyt agresywne wygładzanie
    console.log(`✅ Maksymalny skok opadów: ${maxJump.toFixed(1)} (max ${threshold.toFixed(1)})`);
  });

  test('opady są proporcjonalne do wilgotności', () => {
    const grid = createGrid(100, 100);

    // Ustaw jednorodne pole wilgotności
    grid.cells.moisture = new Float32Array(10000).fill(10); // 10 g/kg

    generateAeroHydro(grid);

    // Opady powinny być proporcjonalne do wilgotności
    const avgPrecip = grid.cells.prec.reduce((a, b) => a + b, 0) / grid.cells.prec.length;
    const avgMoisture = grid.cells.moisture.reduce((a, b) => a + b, 0) / grid.cells.moisture.length;

    // Stosunek prec/moisture powinien być w rozsądnym zakresie (0.1 - 1.0)
    const ratio = avgPrecip / avgMoisture;
    expect(ratio).toBeGreaterThan(0.1);
    expect(ratio).toBeLessThan(1.0);

    // Komentarz: Jeśli test pada, agent prawdopodobnie:
    // 1. Zbyt agresywnie konwertuje wilgotność na opady
    // 2. Zbyt oszczędnie konwertuje wilgotność na opady
    console.log(`✅ Stosunek opadów do wilgotności: ${ratio.toFixed(2)}`);
  });
});
```

---

# 4. TESTY WYDAJNOŚCIOWE - BENCHMARKI

## 4.1. Specyfikacja

**Cel:** Zapewnienie, że system działa w czasie rzeczywistym (SLA).

**Kryteria:**
- Atmosfera: < 80 ms dla 10k komórek
- Ocean: < 50 ms dla 100k komórek
- Renderer: < 16 ms na klatkę (60 FPS)

## 4.2. Implementacja Testów

```typescript
// test-plan/aero-hydro/performance.test.ts
describe('Testy Wydajnościowe', () => {
  test('atmosphere-engine < 80ms dla 10k komórek', async () => {
    const grid = createGrid(10000); // 100x100
    grid.cells.pressure = new Float32Array(10000).fill(1013);

    const start = performance.now();
    await AtmosphereEngine.calculate(grid);
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(80);

    // Komentarz: Jeśli test pada, agent prawdopodobnie:
    // 1. Zbyt wolny algorytm różniczkowania
    // 2. Zbyt wiele alokacji w pętli
    // 3. Nie zoptymalizował dostępu do pamięci
    console.log(`✅ Atmosfera: ${duration.toFixed(1)} ms (max 80 ms)`);
  });

  test('ocean-engine < 50ms dla 100k komórek', async () => {
    const grid = createGrid(100000); // 316x316
    grid.cells.h = new Uint8Array(100000).fill(0); // Cały ocean

    const start = performance.now();
    await OceanEngine.calculate(grid);
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(50);

    // Komentarz: Jeśli test pada, agent prawdopodobnie:
    // 1. Zbyt wolny algorytm cyrkulacji
    // 2. Zbyt dużo alokacji w pętli
    // 3. Nie zoptymalizował dostępu do pamięci
    console.log(`✅ Ocean: ${duration.toFixed(1)} ms (max 50 ms)`);
  });

  test('renderer wstęg < 16ms na klatkę (60 FPS)', async () => {
    const grid = createGrid(10000);
    generateAeroHydro(grid);

    const streamlines = generateStreamlines(grid, 100);
    const svgContainer = document.createElement('svg');

    const start = performance.now();
    renderStreamlines(streamlines, svgContainer);
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(16);

    // Komentarz: Jeśli test pada, agent prawdopodobnie:
    // 1. Zbyt wolny algorytm generowania ścieżek
    // 2. Zbyt dużo operacji DOM
    // 3. Nie zoptymalizował renderowania
    console.log(`✅ Renderer: ${duration.toFixed(1)} ms (max 16 ms)`);
  });

  test('całkowity pipeline < 500ms dla 10k komórek', async () => {
    const grid = createGrid(10000);

    const start = performance.now();
    await generateAeroHydro(grid);
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(500);

    // Komentarz: Jeśli test pada, agent prawdopodobnie:
    // 1. Zbyt wolne generowanie atmosfery
    // 2. Zbyt wolne generowanie oceanu
    // 3. Zbyt wolne generowanie wilgoci
    console.log(`✅ Całkowity pipeline: ${duration.toFixed(1)} ms (max 500 ms)`);
  });
});
```

---

# 5. TESTY INTEGRACYJNE - PEŁNY PIPELINE

## 5.1. Specyfikacja

**Cel:** Zapewnienie, że cały pipeline działa bez błędów i daje oczekiwane wyniki.

## 5.2. Implementacja Testów

```typescript
// test-plan/aero-hydro/integration.test.ts
describe('Testy Integracyjne - Pełny Pipeline', () => {
  test('pełny pipeline generuje mapę bez błędów', () => {
    const grid = createGrid(10000);
    globalThis.pack = {
      cells: { r: [], fl: [], f: [], g: [] },
      features: [],
      rivers: []
    } as any;

    // Testuj, że pipeline nie rzuci wyjątku
    expect(() => {
      generateAeroHydro(grid);
      generateRivers(grid);
      generateBiomes(grid);
    }).not.toThrow();

    // Komentarz: Jeśli test pada, agent prawdopodobnie:
    // 1. Nie zainicjował poprawnie stanu globalnego
    // 2. Zwrócił niezgodne dane między modułami
    // 3. Nie obsłużył przypadków brzegowych
    console.log(`✅ Pełny pipeline: bez błędów`);
  });

  test('zmiana rozdzielczości nie zmienia ogólnego rozkładu', () => {
    // Generuj mapy o różnej rozdzielczości
    const gridLow = createGrid(10000); // 100x100
    const gridHigh = createGrid(100000); // 316x316

    generateAeroHydro(gridLow);
    generateAeroHydro(gridHigh);

    // Porównaj statystyki
    const avgTempLow = gridLow.cells.temp.reduce((a, b) => a + b, 0) / gridLow.cells.temp.length;
    const avgTempHigh = gridHigh.cells.temp.reduce((a, b) => a + b, 0) / gridHigh.cells.temp.length;

    const avgPrecLow = gridLow.cells.prec.reduce((a, b) => a + b, 0) / gridLow.cells.prec.length;
    const avgPrecHigh = gridHigh.cells.prec.reduce((a, b) => a + b, 0) / gridHigh.cells.prec.length;

    // Różnice powinny być < 5%
    expect(Math.abs(avgTempLow - avgTempHigh) / avgTempHigh).toBeLessThan(0.05);
    expect(Math.abs(avgPrecLow - avgPrecHigh) / avgPrecHigh).toBeLessThan(0.05);

    // Komentarz: Jeśli test pada, agent prawdopodobnie:
    // 1. Nie zaimplementował niezależności od rozdzielczości
    // 2. Zależał od rozmiaru siatki w algorytmach
    // 3. Nie skalował parametrów poprawnie
    console.log(`✅ Niezależność od rozdzielczości: temperatura ${(Math.abs(avgTempLow - avgTempHigh) / avgTempHigh * 100).toFixed(1)}%, opady ${(Math.abs(avgPrecLow - avgPrecHigh) / avgPrecHigh * 100).toFixed(1)}%`);
  });

  test('edytor klimatu modyfikuje pole prawidłowo', () => {
    const grid = createGrid(10000);
    generateAeroHydro(grid);

    // Zapisz originalne wartości
    const originalPressure = new Float32Array(grid.cells.pressure);

    // Zmień ciśnienie w jednym miejscu
    grid.cells.pressure[5000] = 900; // Niż baryczny

    // Regeneruj
    generateAeroHydro(grid);

    // Sprawdź, że ciśnienie wokół punktu zmiany jest zmodyfikowane
    const pressureChanged = grid.cells.pressure[5000] !== originalPressure[5000];
    expect(pressureChanged).toBe(true);

    // Komentarz: Jeśli test pada, agent prawdopodobnie:
    // 1. Nie zaimplementował edytora klimatu
    // 2. Edytor nie regeneruje pola prawidłowo
    console.log(`✅ Edytor klimatu: ciśnienie zmodyfikowane`);
  });
});
```

---

# 6. TESTY UI/UX - INTEGRACJA Z ISTNIEJĄCYMI KOMPONENTAMI

## 6.1. Specyfikacja

**Cel:** Zapewnienie, że edytor aero-hydro integruje się z istniejącymi komponentami UI.

## 6.2. Implementacja Testów

```typescript
// test-plan/aero-hydro/ui-integration.test.ts
describe('Testy UI/UX - Integracja z Istniejącymi Komponentami', () => {
  test('edytor aero-hydro używa tego samego modala co HeightmapEditor', () => {
    // Załóżmy, że HeightmapEditor jest już zaimportowany
    const heightmapEditor = new HeightmapEditor();
    const aeroHydroEditor = new AeroHydroEditor();

    // Sprawdź, że oba edytory używają tego samego modala
    expect(aeroHydroEditor.modal).toBe(heightmapEditor.modal);

    // Komentarz: Jeśli test pada, agent prawdopodobnie:
    // 1. Stworzył nowy modal zamiast użyć istniejącego
    // 2. Nie zintegrował się z HeightmapEditor
    console.log(`✅ Integracja modala: tak`);
  });

  test('edytor aero-hydro jest zarejestrowany w Layers', () => {
    const aeroHydroEditor = new AeroHydroEditor();

    // Sprawdź, że warstwa jest w rejestrze Layers
    expect(Layers.aeroHydro).toBe(aeroHydroEditor.layer);

    // Komentarz: Jeśli test pada, agent prawdopodobnie:
    // 1. Nie zarejestrował warstwy w Layers
    // 2. Użył innego rejestru
    console.log(`✅ Integracja warstw: tak`);
  });

  test('edytor aero-hydro używa presetów z WorldConfigurator', () => {
    const aeroHydroEditor = new AeroHydroEditor();
    const worldConfigurator = new WorldConfigurator();

    // Sprawdź, że preset wiatrów jest z WorldConfigurator
    expect(aeroHydroEditor.windPresets).toBe(worldConfigurator.windPresets);

    // Komentarz: Jeśli test pada, agent prawdopodobnie:
    // 1. Stworzył własne presety zamiast użyć istniejących
    // 2. Nie zintegrował się z WorldConfigurator
    console.log(`✅ Integracja presetów: tak`);
  });

  test('LOD działa automatycznie na podstawie zoomu', () => {
    const aeroHydroEditor = new AeroHydroEditor();

    // Testuj LOD na różnych poziomach zoomu
    const lodLow = aeroHydroEditor.calculateLOD(0.5);
    const lodMedium = aeroHydroEditor.calculateLOD(1.0);
    const lodHigh = aeroHydroEditor.calculateLOD(2.0);

    expect(lodLow).toBe('low');
    expect(lodMedium).toBe('medium');
    expect(lodHigh).toBe('high');

    // Komentarz: Jeśli test pada, agent prawdopodobnie:
    // 1. Nie zaimplementował automatycznego LOD
    // 2. LOD nie jest powiązany z zoomem
    console.log(`✅ Automatyczny LOD: tak`);
  });

  test('edytor aero-hydro działa na mobilnych', () => {
    // Symuluj viewport mobilny
    const mobileViewport = { width: 375, height: 667 };

    const aeroHydroEditor = new AeroHydroEditor();
    aeroHydroEditor.setViewport(mobileViewport);

    // Sprawdź, że UI jest responsywny
    expect(aeroHydroEditor.uiWidth).toBeLessThanOrEqual(375);

    // Komentarz: Jeśli test pada, agent prawdopodobnie:
    // 1. Nie zaimplementował responsywnego UI
    // 2. UI nie działa na mobilnych
    console.log(`✅ Responsywność: tak`);
  });
});
```

---

# 7. CHECKLISTA WYKONAWCZA

## 7.1. Przed Startem Implementacji

- [ ] Przeczytaj ten plan testów
- [ ] Zrozum różnice między dokumentami a kodem
- [ ] Zaktualizuj dokumentację z rzeczywistymi plikami
- [ ] Dodaj testy dla istniejącego kodu
- [ ] Zdefiniuj benchmarki i kryteria zatwierdzenia

## 7.2. Podczas Implementacji

- [ ] Testuj każdy moduł jednostkowo
- [ ] Uruchamiaj `npm run test` po każdej zmianie
- [ ] Monitoruj coverage (`npm run test:coverage`)
- [ ] Testuj wydajność (`npm run benchmark:aero-hydro`)
- [ ] Weryfikuj warstwy wizualne w przeglądarce

## 7.3. Przed Zatwierdzeniem

- [ ] Wszystkie testy jednostkowe przechodzą
- [ ] Testy integracyjne przechodzą
- [ ] Benchmarki spełniają SLA
- [ ] Warstwy wizualne są testowane
- [ ] Dokumentacja jest zaktualizowana

---

# 8. PODSUMOWANIE

## 8.1. Kluczowe Wnioski

1. **Istniejące testy używają wzorców:**
   - Minimalne mock data (BASE_CELLS, BASE_VERTICES)
   - beforeEach + re-import
   - Test edge cases explicitly
   - Używają expect/toBe/toEqual

2. **Typowe błędy agentów:**
   - Uproszczenie fizyki (brak efektu orograficznego, Coriolisa, gradientu wysokościowego)
   - Ignorowanie warunków brzegowych (ciągłość cylindryczna, maska lądu)
   - Zbyt duża gęstość elementów (rzeki, biomy, etykiety)
   - Błędne jednostki (piksele zamiast km, Pa zamiast hPa)
   - Brak testowania skrajnych przypadków

3. **Jak zapobiec:**
   - Testy z konkretnymi scenariuszami
   - Komentarze wyjaśniające przyczyny błędów
   - Mierniki jakości (300% opadów, 20% rzek)
   - Testy wydajnościowe (SLA)
   - Testy integracyjne (pełny pipeline)

## 8.2. Rekomendacja Końcowa

**Zacznij od testów fizykalnych i jakościowych** - to są krytyczne dla symulacji klimatu. Potem dodaj testy wydajnościowe i integracyjne. Na końcu dodaj testy UI/UX.

**Nie rób na raz** - wszystkie testy naraz (za dużo pracy).

**Kluczowe pytanie:** Czy mam stworzyć kompletny plik `test_plan.md` z tymi testami, czy wolisz najpierw zobaczyć strukturę i dopiero potem implementację?

---

**Data:** 19 sierpnia 2026  
**Status:** gotowy do wdrożenia  
**Wymagane:** Uruchomienie `npm run test` po implementacji nowych modułów
