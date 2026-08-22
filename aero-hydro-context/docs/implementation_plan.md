# Plan Implementacji: System Aero-Hydro 2.0 (Fizyka Wiatrów, Prądów Morskich i Hydrologii)

Ten dokument stanowi całościowy plan architektoniczny i wdrożeniowy systemu **Aero-Hydro 2.0** w generatorze map Azgaara (FMG), wypracowany w toku analizy wymagań oraz ustaleń z rejestru [aero_hydro_discovery_and_qa.md](file:///home/mamac/.gemini/antigravity-ide/brain/b3144ba1-2875-40ee-9e8b-e6867836a986/aero_hydro_discovery_and_qa.md).

---

## User Review Required

> [!IMPORTANT]
> **Przejście do Implementacji w Kodzie Źródłowym (`src/`):** Zgodnie z decyzją użytkownika rezygnujemy z prowizorycznego sandboxa HTML i przechodzimy bezpośrednio do **Slice 1 (MVP)** wewnątrz właściwej architektury FMG 2.0 (TypeScript, D3, Vitest, system warstw `mapLayers`), gdzie mamy pełny dostęp do prawdziwych danych `grid`, `pack`, generatora rzek, biomów i serializacji.

---

## Specyfikacja Prezentacji Wizualnej i Stylistyki Warstw (Visual & Layer Design Spec)

Każda warstwa w FMG 2.0 ma ściśle zdefiniowaną rolę wizualną, maskę przestrzenną, paletę barw i miejsce w hierarchii renderowania (Z-Order):

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                               HIERARCHIA Z-ORDER W DOM                                  │
│                                                                                          │
│   [WARSTWA WIERZCHNIA]                                                                  │
│   10. Etykiety i Ikony Miast (#labels, #burgIcons)   ──► Nigdy niezasłaniane            │
│    9. Granice Państw i Drogi (#borders, #routes)                                         │
│    8. Animacja Cząstek Canvas (<canvas id="particles">)                                  │
│    7. Wstęgi Wiatru 2D (#windStreamlines)            ──► Cała planeta (SVG)              │
│    6. Izobary i Żetony Baryczne (#isobars, .token)   ──► Linie ciśnienia + H/L          │
│    5. Rzeki Leopolda-Maddocka (#rivers)              ──► Tylko ląd (W ∝ Q^0.5)           │
│    4. Prądy Morskie - Wstęgi Gyres (#oceanCurrents)  ──► Ściśle tylko ocean (h < 20)     │
│    3. Wilgotność Gleby & Oazy (#soilMoisture)        ──► Zielone pasma dolin na pustyni  │
│    2. Płynne Pole Opadów / Izohiety (#precipLayer)   ──► Ciągły gradient klimatyczny     │
│    1. Ukształtowanie Terenu i Ocean (#heightmap, #ocean) ──► Podkład bazowy              │
│   [WARSTWA SPODNIA]                                                                     │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

---

### 1. Warstwa Ciśnienia i Izobar (`#isobars` + Żetony UI)
* **Maska przestrzenna:** Cała mapa (ocean + ląd).
* **Izobary:** Gładkie kontury wektorowe (d3-contour) co $4\text{ hPa}$ (np. $996, 1000, 1004, 1008, 1012, 1016, 1020, 1024, 1028\text{ hPa}$) z subtelną półprzezroczystością (`stroke: rgba(168, 85, 247, 0.45)`, `stroke-dasharray: 2,4`).
* **Etykiety wartości:** Małe etykiety tekstowe umieszczane wzdłuż izobar (np. `1016`).
* **Żetony Ośrodków Barycznych (Interaktywne UI):**
  - **Wyż (H):** Błękitny okrągły żeton z literą **H** i etykietą centralnego ciśnienia (np. `1028 hPa`), animowany pierścień wirujący zgodnie z ruchem wskazówek zegara (anticyklon).
  - **Niż (L):** Czerwony okrągły żeton z literą **L** i etykietą centralnego ciśnienia (np. `992 hPa`), animowany pierścień wirujący przeciwnie do wskazówek zegara (cyklon).
  - Obsługa `drag & drop` oraz `double-click` otwierający modalny inspektor fizyki.

---

### 2. Warstwa Wiatrów 2D (`#wind` / Wstęgi SVG + Cząstki Canvas)
* **Maska przestrzenna:** Cała planeta (ocean i ląd).
* **Wstęgi wektorowe SVG (Do eksportu mapy, druku i widoku stałego):**
  - Gładkie linie prądu (Lagrangian Streamlines całkowane RK2) z gęstością adaptacyjną (Poisson-disk).
  - **Kodowanie prędkości wiatru $|\vec{V}_{\text{wind}}|$ kolorem gradientowym:**
    - $0 - 4\text{ m/s}$ (Cisza / Bryza): delikatny błękit morski (`#0284c7`, $\alpha = 0.45$)
    - $4 - 8\text{ m/s}$ (Wiatr umiarkowany): świeży cyjan (`#06b6d4`, $\alpha = 0.65$)
    - $8 - 14\text{ m/s}$ (Wiatr silny): szmaragdowa zieleń (`#10b981`, $\alpha = 0.85$)
    - $14 - 22\text{ m/s}$ (Wichura): złoty żółty (`#facc15`, $\alpha = 0.95$)
    - $> 22\text{ m/s}$ (Huragan / Szkwał): purpurowa czerwień (`#ef4444`, $\alpha = 1.0$)
  - Końcówki wstęg wyposażone w subtelne strzałki kierunkowe SVG (`marker-end`).
* **Animacja Cząstek Canvas 2D (Opcjonalny efekt na żywo, styl Earth Nullschool):**
  - Smugi cząstek z wygaszaniem tła (`fillStyle = rgba(..., 0.10)`),
  - Zablokowane 60 FPS dzięki tablicy przestrzennej $O(1)$ Spatial Hash Grid,
  - Automatyczny LOD przy przybliżaniu (zoom) i pauza podczas przeciągania mapy (panning).

---

### 3. Warstwa Cyrkulacji Oceanicznej (`#oceanCurrents` / Wstęgi Gyres)
* **Maska przestrzenna:** **ŚCIŚLE TYLKO OCEAN** ($h < 20$). Na lądzie prąd wynosi bezwzględnie $0$, a wstęga kończy się w momencie dotknięcia linii brzegowej.
* **Stylistyka:** Wielonitkowe, świecące wstęgi prądów morskich (Styl *NASA Scientific Visualization Studio* – wiązki 3–5 cienkich, równoległych nitek z jaśniejszym rdzeniem).
* **Kodowanie termiczne (SST Anomaly):**
  - **Prądy ciepłe (płynące ku biegunom, np. Golfsztrom, Kuroshio):** Złocisto-bursztynowe wstęgi (`#f59e0b` / `#fbbf24`),
  - **Prądy zimne (płynące ku równikowi, np. Prąd Kanaryjski, Oja-Siwo):** Głęboki lodowy błękit / indygo (`#38bdf8` / `#6366f1`).

---

### 4. Warstwa Opadów Atmosferycznych (`#precipitation` / Ciągłe Pole Izohiet)
* **Maska przestrzenna:** Ląd ($h \ge 20$).
* **Model prezentacji:** Ciągłe, bezszwowe pole makroklimatyczne na komórkach Voronoi lub raster wygładzony (Advection-Diffusion), eliminujące jakiekolwiek dziury czy samotne suche komórki.
* **Wielostopniowa Skala Izohiet (Roczne sumy opadów):**
  - **$< 20\text{ mm}$ (Półpustynia / Cień opadowy):** Subtelny ciepły odcień bursztynowo-piaskowy (`rgba(217, 119, 6, 0.15)`),
  - **$20 - 45\text{ mm}$ (Klimat umiarkowany / Niziny):** Świeży błękit oceaniczny (`rgba(6, 182, 212, 0.35)`),
  - **$45 - 75\text{ mm}$ (Strefa wilgotna / Fronty deszczowe i Niże):** Królewski błękit (`rgba(59, 130, 246, 0.60)`),
  - **$> 75\text{ mm}$ (Ulewy orograficzne na stokach / Centra cyklonów):** Głęboki indygo/fiolet (`rgba(99, 102, 241, 0.85)`).

---

### 5. Warstwa Rzek i Dorzeczy (`#rivers` / Ścieżki Leopolda-Maddocka)
* **Maska przestrzenna:** **ŚCIŚLE TYLKO LĄD** ($h \ge 20$).
* **Fizyczne formowanie koryta (Próg Channel Initiation):**
  - Rzeka staje się widoczna wyłącznie, gdy skumulowany przepływ ze zlewni przekracza $Q \ge 280\text{ m}^3/\text{s}$ oraz rzędowość Strahlera wynosi $\ge 2$.
  - Rezultat: Czyste, naturalne, drzewiaste dorzecza (2–5 głównych arterii z dopływami) zamiast zaśmiecania mapy siatką mikroskopijnych kresek.
* **Szerokość koryta wg Prawa Leopolda-Maddocka:**
  - $W = a \cdot Q^{0.5} \cdot (1 + 0.12 \cdot (\text{Strahler} - 1))$
  - Górny bieg (Strahler 1–2): $1.1 - 1.8\text{ px}$,
  - Środkowy bieg (Strahler 3–4): $2.2 - 3.6\text{ px}$,
  - Główne ujście do oceanu (Strahler 5+): $4.2 - 6.0\text{ px}$ z naturalnym poszerzeniem estuarium bez plackowatych artefaktów.
* **Kolorystyka:** Głęboki szafirowy błękit rzeczny (`#38bdf8` / `#0284c7`).

---

### 6. Wilgotność Glebowa i Oazy Nadrzeczne (`#soilMoisture` / Integracja z Biomami)
* **Maska przestrzenna:** Ląd ($h \ge 20$).
* **Zjawisko:** Gdy potężna rzeka ($Q \ge 500\text{ m}^3/\text{s}$) płynie przez suchy, półpustynny region ($\text{precip} < 30\text{ mm}$), woda gruntowa nasyca komórki bezpośrednio przylegające do koryta.
* **Efekt wizualny (Dolina Nilu / Oaza):** Wąski, 1-komórkowy pas soczystej zieleni (`rgba(52, 211, 153, 0.65)`) wzdłuż biegu rzeki pośród piasków pustyni.

---

## Proposed Changes (Plan Kodowania Slice 1: MVP Baseline Pipeline)

Przechodzimy do realizacji **Slice 1 (MVP)** we właściwej strukturze projektu:

### Komponent 1: Fundamenty Matematyczne i Pamięć (Moduł M1)
#### [NEW] [`src/utils/grid-math.ts`](file:///home/mamac/projekty/Fantasy-Map-Generator-experimental/src/utils/grid-math.ts)
- Implementacja operatorów różniczkowych Greena-Gaussa (FVM) na siatce Voronoi FMG: `calculateVoronoiGradient`, `calculateVoronoiDivergence`, `calculateVoronoiLaplacian` z obsługą zawijania cylindrycznego.

#### [MODIFY] [`src/types/global.ts`](file:///home/mamac/projekty/Fantasy-Map-Generator-experimental/src/types/global.ts)
- Dodanie pól fizycznych `Float32Array` do `GridCells` i `PackCells` (`pressure`, `windU/V/Speed`, `oceanU/V/Speed`, `sstAnomaly`, `moisture`, `soilMoisture`).

---

### Komponent 2: Generatory Fizyczne (Moduły M2, M3, M4, M5)
#### [NEW] [`src/generators/aero-hydro/atmosphere-engine.ts`](file:///home/mamac/projekty/Fantasy-Map-Generator-experimental/src/generators/aero-hydro/atmosphere-engine.ts)
- Zonalne ciśnienie Hadleya/Ferrela, wiatr geostroficzno-tarciowy, monsuny i rozszczepienie orograficzne Froude'a.

#### [NEW] [`src/generators/aero-hydro/ocean-engine.ts`](file:///home/mamac/projekty/Fantasy-Map-Generator-experimental/src/generators/aero-hydro/ocean-engine.ts)
- Cyrkulacja oceaniczna napędzana wiatrem, korytarze szelfowe i anomalie termiczne SST.

#### [NEW] [`src/generators/aero-hydro/moisture-engine.ts`](file:///home/mamac/projekty/Fantasy-Map-Generator-experimental/src/generators/aero-hydro/moisture-engine.ts)
- Ciągła adwekcja i dyfuzja makroskopowa, orograficzne opady i cienie deszczowe.

#### [NEW] [`src/generators/aero-hydro/hydrology-engine.ts`](file:///home/mamac/projekty/Fantasy-Map-Generator-experimental/src/generators/aero-hydro/hydrology-engine.ts)
- Akumulacja zlewniowa $Q$, rzędowość Strahlera, progi formowania koryta i wilgotność glebowa dla oaz.

---

### Komponent 3: Renderery i Rejestracja Warstw (Moduł M7)
#### [NEW] [`src/renderers/aero-hydro/streamlines-renderer.ts`](file:///home/mamac/projekty/Fantasy-Map-Generator-experimental/src/renderers/aero-hydro/streamlines-renderer.ts)
- Renderer wstęg wiatru SVG i wielonitkowych prądów morskich (z maską lądu) oraz silnik cząstek Canvas 60 FPS.

#### [MODIFY] [`src/components/layers.ts`](file:///home/mamac/projekty/Fantasy-Map-Generator-experimental/src/components/layers.ts)
- Rejestracja zunifikowanych warstw `aeroHydro` w centralnym rejestrze warstw FMG.

#### [MODIFY] [`public/main.js`](file:///home/mamac/projekty/Fantasy-Map-Generator-experimental/public/main.js)
- Podpięcie wywołania potoku fizycznego `generateAeroHydro()` w sekwencji generowania mapy.

---

## Verification Plan

### Automated Tests
- `npm run test` (Uruchomienie testów jednostkowych w Vitest dla `grid-math.ts`, `atmosphere-engine.ts`, `moisture-engine.ts`, `hydrology-engine.ts`).
- `npm run lint` & `npm run build` (Weryfikacja typów TypeScript i poprawności budowy bundla).

### Manual Verification
1. **Weryfikacja w przeglądarce:** Otwarcie głównej aplikacji `http://localhost:5173/`, wygenerowanie nowej mapy i sprawdzenie kolejno warstw wiatru, prądów, opadów i rzek.
2. **Pomiar wydajności (SLA):** Sprawdzenie czasu wykonania `generateAeroHydro()` w konsoli devtools ($< 80\text{ ms}$ dla 10k komórek).
3. **Weryfikacja reguł brzegowych:** Potwierdzenie, że prądy morskie nigdy nie wchodzą na ląd, a rzeki tworzą spójne dorzecza.
