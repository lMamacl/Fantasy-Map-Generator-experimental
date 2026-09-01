# Audyt Code Review & Physics Audit — Moduł Aero-Hydro 2.0

**Projekt:** `labs/Fantasy-Map-Generator-experimental` (fork: `lMamacl/Fantasy-Map-Generator-experimental` z `Azgaar/Fantasy-Map-Generator`, branch `master`)
**Data audytu:** 2026-09-01
**Audytujący:** Principal Systems Architect / Scientific Computing & Geophysical Simulation Expert
**Zakres:** 4 filary — (1) algorytmy i poprawność implementacji, (2) podłączenia i jakość edytorów, (3) warstwa wizualna, (4) zgodność z fizyką Ziemi, mapą Fate i mechaniką Azgaar FMG.
**Metoda:** statyczna inspekcja kodu (silniki, renderery, kontrolery, I/O, typy, utilsy) + analiza dokumentacji (`CRITICAL_ANALYSIS.md`, `TEST_PLAN.md`, `docs/`, `aero-hydro-context/docs/`) + weryfikacja repozytorium GitHub.

> **Kontekst docelowy:** silnik ma obsłużyć **dowolną mapę** możliwą do wygenerowania w FMG (każdy zakres lat/lon, każda proporcja lądu/oceanu, każda rozdzielczość 5k–100k komórek), a nie wyłącznie scenariusz Fate (region ~24°×32°, Atlantyk na zachodzie). Każde ustalenie jest oceniane pod tym kątem.

---

## 1. Executive Summary

Moduł Aero-Hydro 2.0 to realny krok naprzód względem skryptowego klimatu FMG v1.x: deterministyczny pipeline (`AtmosphereEngine → OceanEngine → TemperatureEngine → MoistureAdvectionEngine → StreamlineRenderer`), typowane tablice (`Float32Array`/`Uint8Array`), wzorcowa serializacja stanu do `data[52]` z wersjonowaniem i bezpiecznym odrzucaniem niezgodnych siatek oraz edytor z interaktywnymi żetonami wyżów/niżów z **live recompute** fizyki przy drag&drop.

Audyt wykazał **3 problemy klasy P0**, **6 problemów P1** i szereg ustaleń P2. Pełny rejestr poniżej; szczegóły w rozdziałach 2–5, rekomendacje w rozdziale 7, plan testów w rozdziale 8.

### Tabela ustaleń (synteza)

| ID | Waga | Plik / linia | Typ | Krótkie streszczenie |
|----|------|--------------|-----|----------------------|
| A-01 | 🔴 P0 | `ocean-engine.ts:90` | Bug fizyczny | Podejrzenie odwróconego znaku rotacji Ekmana (N w lewo zamiast w prawo) |
| A-02 | 🔴 P0 | `atmosphere-engine.ts:24,177-192` | Bug numeryczny | Skala geostroficzna w hPa/komórkę ⇒ wiatr zależny od rozdzielczości siatki |
| A-03 | 🔴 P0 | `hydrology-engine.ts:82` vs `moisture-advection-engine.ts:429` vs `types/aero-hydro.ts:139` | Bug spójności | Trzy różne stałe prec→mm (40 / 45 / 55) w jednym bilansie |
| A-04 | 🟠 P1 | `atmosphere-engine.ts:196-197` | Bug fizyczny | Coriolis odwrócony przy równiku (geostrofia najsilniejsza przy f→0) |
| A-05 | 🟠 P1 | `ocean-engine.ts:206-213` | Redizajn | Western Intensification od pozycji `x/graphWidth`, nie od krawędzi basenu |
| A-06 | 🟠 P1 | `temperature-engine.ts:43-50`, `moisture-advection-engine.ts:180-192`, `atmosphere-engine.ts:363-413` | Hardcode | „Fate-izmy": współrzędne Fate jako fallback, Azory/Islandia, „Atlantyk na zachodzie" |
| A-07 | 🟠 P1 | `atmosphere-engine.ts` (nagłówek) | Doc–code | MSLP redukowane barometrycznie, spiętrzenie grzbietów i bruzda zawietrzna opisane, brak w kodzie |
| A-08 | 🟠 P1 | `hydrology-engine.ts:165-200` | Redizajn | „Priority-Flood" to w istocie iteracyjne raise-to-threshold (≤30 przebiegów) |
| A-09 | 🟠 P1 | `hydrology-engine.ts:151-156` | Zgodność FMG | `cells.fl = round(Q[m³/s]·10)` — semantyka niezgodna z FMG v1, saturacja Uint16 |
| A-10 | 🟠 P1 | `draw-pressure.ts:80-93` | Wizualizacja | „Izobary" jako kropki co 4 hPa na zaokrąglonym polu — nie są izobarami |
| A-11 | 🟡 P2 | `streamline-renderer.ts` vs `grid-math.traceStreamline` | Martwy kod | RK2 istnieje w utilsach i jest testowany, renderer go nie używa |
| A-12 | 🟡 P2 | `canvas-particle-animator.ts:180` | Bug perf | Stały `dt=0.14` bez normalizacji rAF → prędkość animacji zależna od Hz monitora |
| A-13 | 🟡 P2 | `atmosphere-engine.ts:211-214` | Doc–code | „Divergence-free curl" nie jest bezrozbieżnościowy (div ≠ 0 przy kx ≠ ky) |
| A-14 | 🟡 P2 | `aero-hydro-editor.ts:431-454` | Edytor | 6 z 8 parametrów `MoistureConfig` i termika bez UI |
| A-15 | 🟡 P2 | `canvas-particle-animator.ts` | Wizualizacja | Brak DPR/HiDPI, coupling do globals `viewX/viewY/scale` |
| A-16 | 🟡 P2 | `draw-aero-hydro.ts`, `layers*.ts` | Integracja | Grupy SVG tworzone ad hoc w `#viewbox`, poza rejestrem `Layers` FMG |
| A-17 | 🟡 P2 | `temperature-engine.ts:129-133` | Zgodność FMG | `h→metry` (wykładnik 1.25, max 4800 m) niezależny od `heightExponent` FMG |
| A-18 | 🟡 P2 | `grid-math.ts:185-218` | Bug niski | Cache `SpatialGrid` trzyma wieczny ref na `points`; `cellLookup` martwe |

---

## 2. Filar 1 — Algorytmy i poprawność implementacji

### 2.1 `atmosphere-engine.ts` — MSLP, cyrkulacja, wiatry

**Co jest dobre:**
- Koncepcja pola MSLP = profil zonalny (ITCZ / wyż zwrotnikowy / niz subpolarny / wyż polarny, cosine-blend między pasami) + perturbacja termiczna ląd↔morze + żetony baryczne (Gauss z σ=0.5·R) + wind-hint z `options.winds` — poprawna, czytelna dekompozycja klimatologiczna.
- Wygładzenie Laplacjanem (λ=0.08, 2 iteracje) przed liczbą gradientów chroni przed szumem pojedynczych komórek.
- Sanity guardy: cap prędkości 32 m/s (~115 km/h), tłumienie wiatru powyżej h=65.

**A-02 — Skala wiatru zależna od rozdzielczości siatki (P0).**
`GEOSTROPHIC_SCALE = 16.0` to „m/s per hPa/**cell**", a gradient (linie 177–192) jest **niezważoną średnią różnic sąsiedzkich**. Przy zmianie `grid.spacing` (cells 1k → 50k) ten sam fizyczny układ ciśnień da gradient ~10× większy w hPa/komórkę ⇒ wiatr ~10× silniejszy. Narusza to kryterium własne modułu (`CRITICAL_ANALYSIS.md`: „Niezależność od rozdzielczości < 5%"). **Poprawka:** przeliczyć gradient na km (przeliczniki `kmPerPxX/Y` już istnieją w silniku wilgoci — wystarczy spójnie użyć) i wyprowadzić skalę z równania geostroficznego `V = |∇P| / (ρ·f)` zamiast stałej 16.0.

**Gradient „Green-Gauss FVM" — rozjazd nazewnictwa z implementacją (P2).**
Gradient nie jest Green-Gaussem (brak wag pola ścian komórki Voronoi); to najprostszy estymator sąsiedzki, który na nieregularnej siatce biasuje kierunek przy asymetrycznych sąsiedztwach. Dla siatek Voronoi FMG lepszy byłby ważony gradient po ścianach (wagi długości ścian ÷ pole komórki) — już dostępne wprost w `d3-delaunay` (`cellPolygon`).

**A-13 — „Divergence-free curl meanders" nie jest bezrozbieżnościowe (P2).**
`u_vort = −sin(kx·x)cos(ky·y)·1.5`, `v_vort = cos(kx·x)sin(ky·y)·1.5` ⇒ `div = (ky−kx)·cos·cos ≠ 0` dla `waveKx ≠ waveKy` (a 0.6·W ≠ 0.5·H praktycznie zawsze). Efekt estetycznie niewielki (amplituda 1.5 m/s), ale komentarz obiecuje własność, której kod nie spełnia. Naprawa: strumień potencjału `u = ∂ψ/∂y, v = −∂ψ/∂x` (dla ψ = sin·sin) daje automatycznie div=0 i również poprawia wirowość.

**A-04 — Coriolis odwrócony w tropikach (P1).**
`coriolisFactor = min(2ω/|f|, 2.5)`: składowa „geostroficzna" jest **najsilniejsza przy równiku** (f→0 ⇒ factor→2.5), słabnie ku biegunom. Na Ziemi jest odwrotnie: równowaga geostroficzna dobra w średnich szerokościach i **zanika przy równiku**, gdzie wiatr płynie wzdłuż gradientu ciśnienia (słabe pasaty, ITCZ jako strefa konwergencji, nie strumień). Obecnie przy równiku powstają najsilniejsze wiatry styczne do izobar — fizycznie niemożliwe. **Poprawka:** blend członu geostroficznego i bezpośredniego wg ε = |∇P|/(ρ·f·V), np. waga geostrofii `w = min(1, (|lat|/25)²)`; przy równiku dominacja cross-isobar (konwergencja do ITCZ).

**Rotacja geostroficzna i cross-isobar — zweryfikowana jako poprawna.**
Ręczne sprawdzenie znaków (u ∝ +gradY·latSign, v ∝ −gradX·latSign w układzie ekranowym y-w-dół; człon −k·∇P) daje konwergencję do niżów i poprawną cyrkulację CCW/CW wg półkul. Warto to „zamrozić" testem regresyjnym (§8), bo przy naprawie A-04 łatwo to zepsuć.

**A-07 — Nagłówek dokumentacji opisuje nieistniejący kod (P1).**
Deklarowane w docstringu: redukcja ciśnienia barometryczną, „dynamiczne spiętrzenie nawietrzne (+ciśnienie przed granią)", „bruzda zawietrzna". Kod implementuje wyłącznie: deflekcję styczną, Venturi (×1.35, gdy ≥2 sąsiadów o +12h wyżej, pas h 25–65), tłumienie >65h. Barometryczna redukcja **nie istnieje** — `pressure` to ciśnienie niezależne od orografii: heatmapa ciśnienia nad najwyższymi górami mapy wygląda jak nad niziną. Do wyboru: (a) dopisać brakujące termy (najprościej: `P_surf = P_MSLP · exp(−z/8000)` przynajmniej do wyświetlania), albo (b) skorygować nagłówek.

**Wind hint (`calculateWindHintPressure`) — przemyślany, ale dwutorowy (P2).**
Projekcja pozycji na kierunek „skąd wieje" z siłą ∝ |Δkąta| — elegancki sposób respektowania suwaków FMG. Ryzyko: tło planetarne (`bgU/bgV`) używa kąta użytkownika **bezpośrednio**, a hint ciśnieniowy dodaje drugą, słabszą drogę do tego samego celu. Do uproszczenia: jedna ścieżka odpowiedzialności.

### 2.2 `ocean-engine.ts` — cyrkulacja i SST

**A-01 — Podejrzenie odwróconego znaku transportu Ekmana (P0, wymaga testu).**
`rotAngle = −fSign·ekmanRad` stosowany macierzą `[cos −sin; sin cos]` w układzie ekranowym (y w dół) daje na półkuli N (`fSign=1`) obrót **przeciwny do wskazówek zegara na ekranie**, czyli odchylenie prądu **w lewo** od wiatru. Fizycznie dryf Ekmana odchyla się **w prawo na półkuli N** (i w lewo na S). Konsekwencja łańcuchowa: gyre'owa pętla o odwróconej rotacji względem tego, co generuje mapa SST (która — patrz niżej — ma znaki poprawne). Wniosek audytu: znak SST i znak Ekmana są **wewnętrznie niespójne**; przynajmniej jeden z nich jest błędny, a dowód numeryczny wskazuje na Ekmana. **Poprawka:** `rotAngle = +fSign·ekmanRad` (lub odwrócić macierz) **plus test regresyjny**: „wiatr na W ⇒ prąd powierzchniowy na N skręca ku S (ekran: +y)". To idealny kandydat na najbliższy commit.

**Meridionalny znak anomalii SST — zweryfikowany poprawny.**
NH: `heating = −v·12` (v>0 = ku S = przypływ chłodu z wysokich szer. ⇒ anomalia ujemna ✓); SH: `heating = +v·12` ✓. Zostaje jedynie stała `SST_MERIDIONAL_FACTOR = 12 °C/(m/s)` — prąd 0.05 m/s ⇒ ±0.6 °C, prąd 0.3 m/s ⇒ saturacja na ±8 °C. Skala działa, ale brakuje tłumienia zależnego od szerokości i głębokości basenu; warto rozważyć zależność od `lat` (mieszanina termokliny) zamiast liniowego przelicznika.

**A-05 — Western Intensification nie jest „western" (P1).**
`positionFactor = max(0, 1 − 2·x/graphWidth)` wzmacnia **lewą krawędź mapy**, a `directLandFactor` liczy ląd u sąsiadów o `nx < x`. Dla mapy, gdzie akwen leży po prawej stronie (kontynent na zachodzie), fizyka się odwraca; dla map świata z dwoma oceanami wzmacnia jedną losową stronę obu basenów. To heurystyka pozycyjna, nie dynamika. **Redizajn (progresywny):**
1. Minimum: identyfikacja basenów (flood fill po komórkach morskich) + intensyfikacja na zachodniej krawędzi **basenu** względem jego centroidu.
2. Docelowo: bilans Sverdrupa `β·V = curl(τ)` — daje gyre, return flow i naturalne WBC bez ręcznych boostów; koszt implementacji na 100k komórek jest niski (jest już naprężenie wiatrowe i pole `windU/V`).

**Brak domknięcia gyre'ów (P1, wspólny z A-05).**
Napęd wyłącznie lokalnym naprężeniem wiatru ⇒ na zamkniętych morzach (np. śródziemnomorska mapa) prądy wbijają w brzeg i są rzutowane stycznie (`projectTangentToCoast`) bez powrotu. Rzutowanie działa jako „guard" (brak wnikania w ląd — dobrze), ale topologia cyrkulacji jest sztuczna. Smoothness barrier-aware jest natomiast wzorowo zaimplementowany (morze z morzem, ląd nietknięty).

**`propagateSstToLand` — poprawny kierunek, zbyt optymistyczny zasięg (P2).**
4 przejścia adwekcyjno-dyfuzyjne z e-foldingiem 375 km ⇒ efektywnie ~1500 km wpływu; komentarz obiecuje 800–1200 km, realny zasięg jest szerszy (i rośnie z rozdzielczością, bo liczba przejść jest stała, a krok maleje). Zależność od rozdzielczości — kolejny przypadek wzorca A-02. Propozycja: pętla aż do zasięgu `N_kmax = zasięg_km / km_per_cell` zamiast stałych 4 przejść.

### 2.3 `temperature-engine.ts` — termika

**Co jest dobre:**
- Profil strefowy z grzbietem zwrotnikowym (22°N/20°S) i nieliniową krzywą radiacyjną — lepszy niż linearny gradient FMG v1.
- Lapse rate 6.5 °C/km (standard ISA/mid-latitude) i clampy Int8 z limitem ±127 — poprawne.
- Temperatura wody = seaLevelTemp + 0.5·sstAnomaly — rozsądne uproszczenie.

**A-06a — Fallback `mapCoordinates` z mapy Fate (P1).**
`mapCoordinates || { latN: 53.6, latS: 29.7, lonW: 5.4, ... }` — to współrzędne **konkretnego świata testowego**. Gdy `mapCoordinates` nie istnieją (np. testy, wczesne etapy pipeline'u), każdy inny świat dostanie termikę północno-zachodniej Europy. Fallback musi być generyczny (np. latN=60/latS=−60 jak w pozostałych silnikach — uwaga: **niespójność fallbacków między silnikami** to osobny problem; atmosphere/moisture mają 60/−60, temperature ma Fate).

**A-17 — Konwersja h→metry pomija konfigurację wysokości FMG (P2).**
`elevationM(h) = 4800·((h−20)/80)^1.25` — stały wykładnik i stała wysokość maksymalna, podczas gdy FMG pozwala użytkownikowi na `heightExponent` i różne `heightUnit`. Na mapie z „płaskim" heightmapą (wykładnik ~1.3 w FMG) góry h=80 powinny być niższe niż na mapie „alpejskiej" przy tym samym h. Skutek: temperatura wysokogórska systematycznie zaniżana na mapach o niskim reliefie. Rozwiązanie: parametryzacja z `options` (jak `maxElevationMeters` w configu — ale wtedy wystawić to w UI edytora, patrz A-14).

**Brak kontynentalizmu (P2, świadome uproszczenie?).**
Roczny profil bez amplitudy sezonowej i bez odległości od morza (kontynentalność) — dla mapy statycznej akceptowalne, ale „efekt Golfsztromu" propagowany przez `sstLandInfluence` jest jedynym mechanizmem różnicowania wybrzeży. Do rozważenia w v2.1: tania aproxymacja `T_coast = T_zonal + A·(1 − exp(−d_coast/300km))`.

### 2.4 `moisture-advection-engine.ts` — wilgoć, opad, Föhn

**Najmocniejszy silnik modułu.** Konceptualnie i implementacyjnie najbardziej zaawansowany:
- **Dijkstra upwind** (`BinaryHeap` własny, poprawny) z kosztem `d / (0.35 + 0.65·alignment)` — fizycznie sensowna metryka „drogi wilgoci" (wiatr zgodny = droga krótsza w sensie efektywnym). Sortowanie po odległości od brzegu nawietrznego przed adwekcją (linia 228–231) to poprawny zamiennik Gaussa-Seidela dla nieregularnej topologii.
- **Clausius-Clapeyron** w poprawnej formie Magnus-Tetensa: `6.112·exp(17.67·T/(T+243.5))` (błąd <0.3% w zakresie −40…+50 °C) z sensownym clampem wejścia.
- **Orografia dwuskalowa**: gradient lokalny (0.3) + makroregionalny po 3-krotnym wygładzeniu (0.7) — to dokładnie idea „foothills forcing" ze Smith & Barstad (2004): duża skala daje wznoszenie, mała skala szum.
- **Föhn**: cień propagowany wzdłuż prądu z dekayem `exp(−d/240 km)` i gatingiem `dot > 0.15` — koncepcja zgodna z fizyką (150–350 km), implementacja poprawna kierunkowo.
- Cap nasycenia kolumny `airCap = e_s(T)·1.35·exp(−z/5500)` — uwzględnienie malejącej masy kolumny z wysokością, rzadkość nawet w komercyjnych generatorach.

**A-06b — „Atlantyk na zachodzie mapy" (P1).**
`isWestBoundaryInflow = (x ≤ spacing·2.5) && (windU > 0.4)` — stałe źródło wilgoci tylko przy lewej krawędzi i tylko przy wietrze „na wschód". Dla map z oceanem na wschodzie/północy, map wyspowych (ocean z 4 stron — tu akurat ratunkiem jest `distFromCoastKm = 0` dla komórek morskich) oraz map z wiatrem wschodnim na lewej krawędzi: źródła brzegowe znikają albo są fałszywe. **Poprawka:** generować źródła brzegowe z identyfikacji komórek morskich przylegających do krawędzi mapy **dowolnej strony** z warunkiem „wiatr wychodzi poza mapę" (iloczyn wektora wiatru z normalną krawędzi > 0) — uniwersalne i krótsze.

**Ubytek wilgoci — bilans zachowany, ale bez pętli zwrotnej opadu (P2).**
Recykling kontynentalny jest zamodelowany statycznie (`qEquil` wg szerokości + blend `1−exp(−d/2000)`), zamiast iteracyjnie z faktycznego opadu i biomu (`DEFAULT_EVAPOTRANSPIRATION` istnieje w typach — i jest **niewykorzystywane** przez silnik; martwa stała). Docelowo: po pierwszym przebiegu opadu zrobić 1 iterację „moisture += ET(biome)·prec" i ponownie rozwiązać — koszt 1 dodatkowy sweep, zysk: realne puszcze wilgotne w głębi kontynentów.

**A-03 (pęknięcie bilansu) — patrz §2.5; parametry `BASE_ANNUAL_FACTOR = 52`, `FMG_PREC_DIVISOR = 45`, hardkodowane progi 18°/22°/32°/36° pasma subsidence — patrz §2.7 (rejestr hardkodów).**

**Drobnostka numeryczna (P2):** `Math.max(15, totalRain)` — podłoga 15 mm/rok dla lądu; na mapach polarnych daje pustynie polarne tam, gdzie bilans mógłby dać 0. Fizycznie ok (listwy min. opadu), ale warto ją udokumentować w TEST_PLAN jako świadomą granicę modelu.

### 2.5 `hydrology-engine.ts` — spływ, Strahler, Leopold-Maddock

**A-03 — Trzy różne stałe konwersji prec→mm w jednym łańcuchu (P0).**
Silnik wilgoci zapisuje `cells.prec = precipMmYr / 45` (`FMG_PREC_DIVISOR = 45`). Hydrologia czyta `precMmYr = prec · 40`. Typy deklarują `PRECIP_SCALE_FACTOR = 55` (używane przez biomy). Skutek: przepływy rzeczne Q liczone z opadu **zaniżonego o 11%** względem silnika wilgoci (40 vs 45) i **o 27%** względem progów biomów (40 vs 55). Bilans opad→przepływ→biom jest wewnętrznie niespójny; zmiana dowolnej stałej przesuwa rzeki względem biomów. **Poprawka:** jedna eksportowana stała w `types/aero-hydro.ts`, używana przez wszystkie trzy moduły; przy okazji usunąć fallback `prec ? … : 500` (cisza liczbowowa 500 mm dla braku pola — kryje błędy integracji).

**A-08 — „Priority-Flood" bez priority-flood (P1).**
`resolveDepressions` = iteracyjne podnoszenie komórki do poziomu najniższego sąsiada (+0.05), max 30 przebiegów, O(passes·N·deg). To algorytm typu „Planchon-Darboux bez kolejki", z gwarancją zbieżności **tylko** przy ograniczonej liczbie przebiegów — a FMG **celowo tworzy głębokie depresje** (`addLakesInDeepDepressions`) pod przyszłe jeziora. Dla map z głębokimi kotlinami 30 przebiegów może nie wystarczyć ⇒ resztkowe depresje ⇒ komórki bez `flowDirection` (sztuczne zlewki) lub przekłamana akumulacja. **Redizajn:** prawdziwy Priority-Flood + epsilon (Barnes, Lehman, Mulla 2014) z `BinaryHeap` (już istnieje w silniku wilgoci!) — O(N log N), jednoprzebiegowy, deterministyczny. Kod spadnie ~2× objętościowo.

**Strahler — poprawny.** Sortowanie od szczytu do ujścia + liczenie `countMax` dopływów max rzędu to poprawna, kanoniczna definicja; testowalne 1:1 (§8).

**Leopold-Maddock — poprawne wykładniki, kalibracja kw do poprawy (P2).**
`W = 1.8·Q^0.5`, `D = 0.35·Q^0.4` — wykładniki zgodne z literaturą (0.5 / 0.4). Stałe kalibracyjne dają dla Q=1000 m³/s szerokość ~57 m (realnie ~70–120 m dla rzeki średniej wielkości) i głębokość ~5.6 m (realnie ~3–5 m). Szerokość zaniżona ~2×, głębokość zawyżona — stosunek W/D ~10 zamiast realnych 20–40 dla nizinnych rzek. Rekomendacja: `W = 3.5·Q^0.5` i `D = 0.25·Q^0.4` → W/D = 14·Q^0.1, bliżej empirii i bez zmiany wykładników.

**A-09 — `cells.fl` niezgodne z semantyką FMG (P1).**
FMG v1 traktuje `cells.fl` jako akumulację opadu (jednostki „opadowe", wykorzystywane przez rzeki i biom z cechą `flux`). Silnik nadpisuje ją `round(Q[m³/s]·10)` z clampem 65535 ⇒ (1) semantyka jednostek zmieniona pod istniejącymi konsumentami, (2) dla Q>6553 m³/s saturacja, (3) wartości zależne od fizycznej skali mapy. Ponieważ `hydrology-engine` **nie jest w auto-pipeline** (`index.ts`), ryzyko jest dziś teoretyczne — ale uruchomienie go z edytora „dla podglądu" **trwale psuje rzeki i biomy** mapy do czasu regeneracji. **Poprawka:** albo własne pole `cells.flAero`, albo konwersja do skali FMG `fl ∝ prec·area` (jak w FMG v1), albo wyraźny warning + undo.

### 2.6 `grid-math.ts` i `types/aero-hydro.ts`

- **`kmToGridCells` / `gridCellsToKm` / `cellAreaKm2`** — konwersje przez `cellsX·cellsY` i extent; poprawne w sensie liniowym, ale **strefowe uproszczenie**: szerokość mapy w km liczona z `lonT` bez cos(lat) — dla map tropikalnych (1° ≈ 111 km) i polarnych (1° ≈ 40 km) daje do 3× rozrzutu fizycznego. Dla wilgoci (L_continental = 3200 km) oznacza to systematyczne wydłużanie cieńów opadowych na szerokościach geograficznych. Rekomendacja: skala korygująca `cos(lat_mid)` w `kmPerPxX` (oś Y bez zmian).
- **`laplacianSmooth`** — poprawny, brak guardów NaN (jeden NaN w polu rozlewa się przez wszystkie iteracje). Tani fix: guard `Number.isFinite(sum)` w pętli lub assert na wejściu silników.
- **`scalarGradient` (IDW)** — poprawny algebraicznie; brak użycia w silnikach (martwa ścieżka razem z A-11).
- **A-18 — `getOrCreateSpatialGrid`**: cache niesłabnący (ref na `points` utrzymuje całą starą siatkę po `reGraph`), `cellLookup[bucketIdx] = i` nadpisuje ostatnią komórkę w buckecie (funkcja „closest" jest w istocie „dowolna komórka z bucketa") — działa przypadkiem, bo `buckets` ma pełną listę, ale `cellLookup` jest mylące. Fix: słaby klucz / timestamp generacji grafu + usunięcie `cellLookup`.
- **Typy** — spójne i dobrze udokumentowane; `isValidBaricCenter` nieużywany przez edytor (A-14); `AeroHydroCells`/`createAeroHydroCells` nieużywane przez silniki (alokują własne bufor in-place) — martwe API, do usunięcia lub przyjęcia.

### 2.7 Rejestr hardkodów (koncentracja ryzyka „dowolna mapa")

| Lokalizacja | Hardkod | Ryzyko dla dowolnej mapy |
|---|---|---|
| `atmosphere-engine.ts:28-30` | `LAND_THERMAL_PRESSURE = −2.5`, `OCEAN_THERMAL_PRESSURE = 1.0` | Brak sezonowości i zależności od wielkości kontynentu; archipelagi = pseudomonsuny |
| `atmosphere-engine.ts:42` | `DEFAULT_WIND_ANGLES` / pasma ±30/±60 | Pasma fix na Ziemi; mapy z przesuniętym ITCZ nie mają modułu przesunięcia |
| `atmosphere-engine.ts:365-386` | Azory 35°N/−28°, Islandia 62°N/−20° | Centra klimatologiczne północnego Atlantyku dla dowolnego świata |
| `atmosphere-engine.ts:366` | `lonW − max(lonT·0.35, 20)` | Umieszczenie wyżu w „ghost domain" za krawędzią — dla map światowych (lonT=360) wyż ląduje poza mapą bez sensownej wpływu |
| `temperature-engine.ts:43-50` | fallback = współrzędne mapy Fate | Geny świata testowego w silniku generycznym |
| `moisture-advection-engine.ts:180` | „Atlantyk na zachodzie" (`x ≤ 2.5·spacing && windU > 0.4`) | Ocean zawsze zakładany na zachodzie |
| `moisture-advection-engine.ts:371-383` | pasma subsidence 18/22/32/36° | Pusta pasowa bez wpływu kontynentu/orografii |
| `ocean-engine.ts:17-23` | `SST_MERIDIONAL_FACTOR=12`, `SST_MAX_ANOMALY=8`, `SST_LAND_DECAY_KM=150` | Nie skaluje się z wielkością basenu (śródlądowe morze = anomalie jak Pacyfik) |
| `temperature-engine.ts:129-133` | `4800·((h−20)/80)^1.25` | Niezależne od `heightExponent` FMG (A-17) |
| `draw-aero-hydro.ts:20-25` | progi kolorów prędkości (3.5/7.5/12/18 m/s) | Skala wiatru, ale używana też dla prądów oceanicznych (0.05–0.5 m/s) ⇒ wszystkie prądy zawsze „błękitne" |

**Wniosek ogólny filaru 1:** silniki są konceptualnie poprawne, ale (1) dwa znaki fizyczne wymagają natychmiastowej weryfikacji testem (A-01, A-04), (2) skala fizyczna jest zakotwiczona w jednostkach siatki zamiast km w co najmniej 3 miejscach, (3) ścieżki generyczne zawierają ~10 twardych założeń „mapy Fate/Atlantyku". To nie unieważnia architektury — ale każde z tych miejsc jest pułapką na mapach innych niż referencyjne.

## 3. Filar 2 — Podłączenia i jakość edytorów

### 3.1 `aero-hydro-editor.ts`

**Co działa dobrze:**
- Dialog w konwencji FMG (`$.dialog` + `ensureEl("dialogs")`), przyciski tipowane, `closeDialog` niszczy DOM i resetuje warstwy.
- Toggle warstw (wiatr/ciśnienie/prądy/cząstki) z klasą `pressed` — zgodny z UX FMG (edytory `relief-editor`, `ice-editor`).
- `renderBaricCentersList` + auto-klasyfikacja typu z ciśnienia — przemyślane.
- Przycisk `Recalculate Climate` przechodzi przez pełny pipeline `AeroHydro.generate()` — brak „skrótów".

**Luki (A-14):**
1. **`MoistureConfig` ucięty w UI:** `applyChanges()` czyta wyłącznie `orographicBlockRate` i `foehnHeatingRate`. `iterations`, `diffusionCoeff`, `advectionStrength`, `condensationRate`, `oceanEvapScale`, `capacityScale` są zdefiniowane w typach i honorowane przez silnik, ale nieosiągalne dla użytkownika. Identycznie termika: `lapseRatePerKm`, `maxElevationMeters`, `temperatureEquator/NorthPole/SouthPole` bez edytora (suwaki FMG `temperatureEquator` są respektowane tylko przez fallback `options` — nie przez edytor Aero-Hydro).
2. **Brak walidacji** `isValidBaricCenter` przy dodawaniu/edycji centrów (funkcja istnieje w typach); można zapisać `pressureHPa = NaN` i ustawić całe pole ciśnień w NaN (a `laplacianSmooth` nie ma guardów NaN — patrz §2.6).
3. **Brak sekretu hydrologii:** `HydrologyEngine` nie jest wystawiony w edytorze mimo że dokumentacja go tam promuje (`index.ts` headnote). Funkcja „Generate Rivers Preview" byłaby naturalnym uzupełnieniem.
4. **Stan warstw per sesja modułowa** (`isWindsActive` itd. jako let-y): zamknięcie dialogu resetuje widoczność warstw — po ponownym otwarciu użytkownik traci konfigurację. Drobny UX, łatwy fix (persist w `options.aeroHydroUI`).
5. **Brak shortcutovních obsługi** dla `data-shortcut="Shift + W"` (wpis w `index.html` istnieje; skrót działa globalnie w FMG — do weryfikacji w `main.js`).

### 3.2 `draw-pressure.ts` — żetony H/L (drag&drop)

**Najlepszy element interaktywny modułu:** drag żetonu przelicza `AtmosphereEngine.generate()` **na każdej klatce draga** i odświeża heatmapę (`updatePressureColorsOnly`) + wiatry dynamicznie importowanym modułem. To właściwy wzorzec „editor as interactive generator" z dokumentu architektury FMG.

**Ryzyka:**
- Recompute pełnego pola siatki (do 100k komórek) w `on("drag")` bez throttlingu — na słabszych maszynach dropuje FPS do ~10 podczas przeciągania. Fix: recalc na `requestAnimationFrame` throttle lub recalc na `end` + tania interpolacja pola podczas draga (przesunięcie Gaussa bez pełnego przebiegu).
- `d.x/d.y = event.x/event.y` — D3 zwraca współrzędne w przestrzeni ekranowej; przy zoom mapy (scale ≠ 1) żeton „ucieka" z pozycji fizycznej względem mapy (brak dzielenia przez `scale`). Do weryfikacji z `viewbox` transform — klasyczny bug zoomu w FMG.
- Po `end` wywoływane `drawPressure()` (pełny rebuild) — usuwa i odtwarza wszystkie żetony; drag handler reinicjalizowany za każdym razem (brak leaków, ale stratny). OK.

### 3.3 Okablowanie pipeline (`index.ts`, `main.js`, `resample.ts`, `load.ts`)

- `window.generateAeroHydro`, `window.calculateTemperatures`, `window.generatePrecipitation` — nadpisują globalne funkcje FMG; dzięki temu legacy wywołania w pipeline (`generateAeroHydro()` w `resample.ts:446`) przechodzą przez nowe silniki. To sprytne, ale **niejawne**: dowolny inny kod FMG wołający `generatePrecipitation` otrzymuje silnik adwekcyjny zamiast oryginalnego. Zalecane: jawne wywołania przez moduł + alias legacy zachowany dla kompatybilności (dokumentacja w `aero-hydro-context` to już zresztą opisuje jako krok 4 pipeline'u — zgodnie).
- **Kolejność w pipeline (`resample.ts`)**: `generateAeroHydro()` (atmosfera+ocean+temp+wilgoć) → `calculateTemperatures()` (temp ponownie). Drugie wywołanie jest nadmiarowe (temperatura liczona w kroku 3 pipeline'u); koszt ~1 przebieg N. Do usunięcia po weryfikacji zależności.
- **`load.ts:440-446`** — wzorcowo: `data[52]` opcjonalne, `try/catch` wokół `JSON.parse`, restore tylko przy zgodnej długości, INFO/WARN logi. Zgodność wsteczna realna (starsze `.map` bez sekcji ładują się bez błędów; `restoreAeroHydroState` zwraca false i pipeline idzie dalej).
- **Luka niezgodności geometrii:** przy zmianie siatki pole o złej długości jest pomijane pole-po-polu, ale **bez informacji użytkownikowi** (tylko console.warn) i bez re-generacji stanu — mapa ładuje się z **częściowym** stanem fizycznym (np. wilgoć odtworzona, ciśnienie nie) i bez automatycznego `AeroHydro.generate()`. Docelowo: jednoznaczne „stan odrzucony — regeneruję klimat" + wywołanie generacji.

## 4. Filar 3 — Warstwa wizualna prezentacji zmian

### 4.1 `streamline-renderer.ts`

**Dobre decyzje projektowe:**
- Progi **adaptacyjne dla oceanu** (start 25% / stop 8% maksimum pola) — poprawna diagnoza historyczna (sztywny próg 0.4 m/s ucinał śledzenie po 1 kroku) i właściwe rozwiązanie.
- Strefa wykluczenia topologiczna (BFS po sąsiedztwach, 2–3 hops) — separacja wstęg niezależna od rozdzielczości; lepsze niż czyste odległości pikselowe.
- Clamp kąta 35°/krok — eliminuje „haki" na szumie gradientu; ocean z twardym stopem na lądzie.

**A-11 — Integracja nie jest RK, mimo że RK2 istnieje (P2 → P1 dla zgodności opisu).**
`grid-math.traceStreamline` (RK2 midpoint, testowany w `grid-math.test.ts`) nie jest używany. Renderer robi krok „kierunek z komórki najbliższej + stały krok ekranowy" — to integracja Eulera 1. rzędu na polu komórkowym, nie RK, i nie na polu ciągłym. Skutki: wstęgi „schodzą" na granicach komórek przy słabych polach (krok 22 px dla wiatru, 10–24 px dla oceanu), a opis modułu (`Runge-Kutta 2/4` w nagłówkach projektu i docstringach) nie odpowiada kodowi. **Fix:** przełączyć na `traceStreamline` z adaptacyjnym `stepSize` (istnieje parametr `maxAngleDeg` — spina się z clampem), albo zaktualizować dokumentację i testy.

**Krycie prędkości wiatru stałymi progami (P2).**
Start wiatru: `speed ≥ 1.2`, stop: `speed < 0.8` — wartości absolutne m/s. Po naprawie A-02 (wiatr w jednostkach fizycznych) progi będą działać inaczej niż dziś; najlepiej od razu przejść na progi względne (jak w oceanie): `0.25·max` / `0.08·max`. Spójność obu ścieżek ułatwi też dalsze tweakowanie estetyki.

### 4.2 `canvas-particle-animator.ts`

**Dobre:** `destination-out` fade (smugi na przezroczystym tle — brak czarnego canvasa), pula cząstek z wiekiem, kolor/grubość z prędkości, transform zoomu respektowany.

**A-12 — stały `dt = 0.14` bez normalizacji klatek (P2, realny bug na 120/144 Hz).**
Na monitorze 144 Hz cząstki płyną 2.4× szybciej niż na 60 Hz. Fix standardowy: `dt = (now − last)/16.67 · mult` z clampem (np. max 3 klatki) — 4 linie kodu.

**A-15 — HiDPI i ląd dla wiatru (P2).**
- Canvas bez `devicePixelRatio` — smugi rozmyte na Retina; fix: `canvas.width = innerWidth·dpr; ctx.setTransform(dpr·scale, …)`.
- Cząstki wiatru startują równomiernie w całym prostokącie mapy (także nad oceanem/jeziorami — OK dla wiatru), ale nie reagują na orografię (nie „opływają" grzbietów tak jak pole wektorowe sugeruje w streamline'ach — bo `findClosestCellFast` daje najbliższą komórkę, a pole wiatru nad lądem jest już wytłumione). Efekt: cząstki „umierają" gęsto nad wysokimi górami (speed < minSpeed) — akceptowalne, ale wygląda jak dziury. Możliwość: respawn ważony polem prędkości zamiast jednorodnym.
- Brak reakcji na resize okna (canvas.width ustawiane tylko przy starcie) — po resize smugi cięte.

### 4.3 `draw-aero-hydro.ts` i `draw-pressure.ts`

- **Warstwy ad hoc w `#viewbox` (A-16):** `getOrCreateGroup` tworzy grupy poza rejestrem `Layers` FMG ⇒ (1) brak integracji z menu „Layers" (użytkownik nie może ukryć warstwy standardowym UI), (2) kolejność z-idx zależna od momentu tworzenia, (3) `removePressure` przez `select("#pressure")` ok, ale identyfikatory stringowe rozsiane po plikach. Rekomendacja: zarejestrować w `layers.ts`/`layers-tab.ts` (pliki istnieją i mają już testy).
- **A-10 — „izobary" nie są izobarami (P1 wizualne).** Kropki na komórkach gdzie `round(P) % 4 === 0` — to zapis siatki próbkującej, nie linie stałego ciśnienia; obok etykiet H/L tworzy mylące „kropkowane chmury". **Fix:** marching squares po trójkątach Delaunaya (sąsiedztwo komórek Voronoi = dual) na poziomach co 4 hPa — stąd prawdziwe polilinie, gotowe do etykietowania „1012", „1016" (jak na mapach synoptycznych). Koszt umiarkowany, zysk estetyczny duży — to najkrótsza droga do „prawdziwej" mapy pogodowej.
- **Heatmapa ciśnienia** — wydajny O(N) render komórek, paleta czytelna (granat→zieleń→złoto), opacity 0.45 nie zabija mapy bazowej. Dobre.
- **`getSpeedColor` wspólny dla wiatru i oceanu (P2):** prądy 0.05–0.5 m/s zawsze mieszczą się w pierwszym przedziale ⇒ monochromatyczne rdzenie złote (kolorem steruje tylko avgSpeed wstęgi — poza pierwszym przedziałem nigdy). Dla oceanu wystarczyłaby skala względem `maxSpeed` pola (renderer już go liczy).

### 4.4 Hierarchia prezentacji — ocena całościowa

Obecna hierarchia: heatmapa ciśnienia (tło) → wstęgi wiatru (warstwa 1) → prądy (warstwa 1) → cząstki (overlay). Czytelna i zgodna z konwencją map synoptycznych. Największy brak wobec obietnic dokumentacji: **etykiety niżów/wyżów w sposób kartograficzny** (L z ciśnieniem są, ale bez pozycjonowania na ekstremum pola — żetony są z options, nie z pola; po dragu pola i żetony mogą się rozjechać wizualnie przy złym zoomie — patrz §3.2) oraz **izobary z etykietami** (A-10).

## 5. Filar 4 — Zgodność z fizyką Ziemi, mapą Fate i mechaniką Azgaar FMG

### 5.1 Fizyka Ziemi — zgodność parametrów

| Mechanizm | Wartość w kodzie | Standard fizyczny | Werdykt |
|---|---|---|---|
| Lapse rate | 6.5 °C/km | 6.5 °C/km (ISA) | ✅ zgodne |
| Clausius-Clapeyron | Magnus-Tetens 6.112·exp(17.67T/(T+243.5)) | — | ✅ forma poprawna (<0.3% err) |
| Kąt Ekmana | 20° (config) | 20–45° | ✅ w zakresie (znak — A-01) |
| Geostrofia | stała 16.0 m/s·cell/hPa | V = \|∇P\|/(ρf) | ❌ nie-fizyczna stała, zależna od siatki (A-02) |
| Coriolis przy równiku | wzmocnienie ×2.5 | zanik równowagi | ❌ odwrotnie (A-04) |
| Föhn / cień opadowy | 150–350 km, decay 240 km | 100–400 km | ✅ zgodne |
| Recykling wilgoci | 35% blend, L=2000–3200 km | 30–45%, 1000–4000 km (Amazonia/Kongo) | ✅ w zakresie |
| Orografia | Smith-Barstad „inspirowana" dwuskalowo | S-B 2004 (wave model) | 🟡 koncept zgodny, uproszczony do forcingu wznoszenia |
| Temperatura polarna | N −12 °C / S −15 °C, równik 27 °C | średnie roczne: ~ −15…−20 / ~27 | ✅ rozsądne |
| Strahler / Leopold-Maddock | wykładniki 0.5/0.4 | 0.5/0.4 (empiria) | ✅ wykładniki; kalibracja stałych do korekty (§2.5) |
| Subsidence zwrotnikowa | pas 22–32°, factor 0.15 | wyże zwrotnikowe ~20–35° | ✅ pas ok; brak przesunięć klimatycznych |
| Opad oceanu | 600 mm/rok stała | 800–1200 mm/rok | 🟡 zaniżony, ale `prec` oceanu i tak nie wpływa na biomy lądowe |

### 5.2 Mapa Fate (walidacja referencyjna)

Silniki zawierają kod dostosowany do Fate (fallback współrzędnych, centra w ghost domain, „Atlantyk na zachodzie", testy `fate-world-physics.test.ts`). To **zrozumiałe** jako ścieżka walidacji, ale architektonicznie ryzykowne: Fate jest dziś (a) fallbackiem defaultowym, (b) ukrytym założeniem ścieżek brzegowych, (c) testem-asercją. Po naprawie A-06 mapa Fate powinna być **scenariuszem testowym** (fixture `.map` + asercje klimatologiczne), a nie częścią ścieżki generycznej. Raport `Fate_…_validation_tests.md` potwierdza, że walidacja istnieje — audyt rekomenduje tylko przeniesienie założeń z kodu do fixtures.

### 5.3 Zgodność z mechaniką Azgaar FMG v1.x

| Obszar | FMG v1.x | Aero-Hydro 2.0 | Ocena |
|---|---|---|---|
| `grid.cells.prec` | Uint8, 1 unit ≈ ~40 mm (biomy czytają względne) | Uint8 przez /45 | 🟡 zbliżone; patrz A-03 |
| `grid.cells.temp` | Int8, zonal + height lookup | Int8, zonal + lapse + SST | ✅ superset |
| `grid.cells.fl` | flux bezwymiarowy (akumulacja opadu) | Q[m³/s]·10, Uint16 clamp | ❌ A-09 |
| `options.winds` | 6 kątów pasm, suwaki | respektowane (hint + tło) | ✅ |
| `options.temperatureEquator` itd. | suwaki konfiguratora | respektowane w TemperatureEngine | ✅ (brak w edytorze modułu — A-14) |
| `heightExponent` | wpływa na geometrię wysokości | ignorowany (A-17) | ❌ |
| Rzeki (river-generator) | własny flow na pack.cells | hydrology-engine poza pipeline | ✅ ostrożne rozdzielenie; spójność `fl` do naprawy |
| `data[52]` w `.map` | nie istnieje | opcjonalna sekcja, wersjonowana | ✅ wzorcowe |
| Warstwy/layers | rejestr `Layers` | ad hoc grupy SVG (A-16) | ❌ |
| Format zapisu options | `options` w settings (data[1]) | serializowane tamże (atmosphere/oceanCurrents/moistureAdvection) | ✅ |

---

## 6. Co działa dobrze — podsumowanie pozytywów

1. **Architektura pipeline'u** — czysta sekwencja zależności fizycznych (wiatr → ocean → temperatura → wilgoć), zgodna z `docs/architecture/aero_hydro_complete_system_redesign.md`. Hydrologia świadomie poza auto-pipeline.
2. **Wydajność bazowo dobra:** TypedArrays na całym przepływie, zero alokacji w pętli animacji, `SpatialGrid` O(1) dla cząstek i interpolacji, własny `BinaryHeap` bez zależności zewnętrznych.
3. **Serializacja `aero-hydro-state.ts`** — wzorcowy moduł: wersjonowanie, Base64 Float32 z chunkingiem (limit String.fromCharCode), pomijanie pól zerowych, odrzucanie niezgodnej długości z logiem, dokumentacja formatu w nagłówku.
4. **Edytor z live recompute** (drag żetonów H/L) — wzorzec „editor as interactive generator" zrealizowany zgodnie z filozofią FMG.
5. **Wilgoć (moisture engine)** — najpełniejszy fizycznie element: Dijkstra upwind po drodze wilgoci, dwuskalowa orografia, Föhn, cap kolumny, recykling kontynentalny; progi i skale w km, nie w komórkach.
6. **Progi adaptacyjne streamline'ów oceanu** i strefy wykluczenia topologiczne — poprawna nauka z błędów v1.
7. **Testy istnieją i są sensowne** (`fate-world-physics.test.ts`, `grid-math.test.ts`, testy silników, `aero-hydro-state.test.ts` z regułą Vitest `expect(arr.includes(val)).toBe(true)`).
8. **Kompatybilność wsteczna** — realnie przetestowana i przemyślana (starsze `.map`, brak sekcji 52, odrzucanie złej geometrii).

## 7. Rekomendacje — priorytetyzowany backlog

### P0 — natychmiast (korektność fizyczna i bilansowa)
1. **A-01 Ekman:** odwrócić znak rotacji (lub macierz) + test „wiatr W ⇒ prąd N skręca ku S". Jednolinijkowa zmiana, efekt systemowy dla całej cyrkulacji.
2. **A-02 Skala wiatru:** gradient ciśnienia w hPa/km (wspólny przelicznik kmPerPx), skala z `V = |∇P|/(ρf)`; test niezależności od rozdzielczości (ten sam heightmap na cells 2k vs 20k ⇒ średnia prędkość różni się < 5%).
3. **A-03 Jedna stała prec→mm:** eksport z `types/aero-hydro.ts`, konsumenci: moisture (zapis), hydrology (odczyt), biomes (progi); usunąć magiczne 40/45/55 i fallback 500 mm.

### P1 — krótkoterminowo (fizyka i „dowolna mapa")
4. **A-04 Coriolis:** blend geostrofii `w_geo = min(1, (|lat|/25)²)`; przy |lat|<15° dominacja członu bezpośredniego (konwergencja do ITCZ).
5. **A-06 Dekontaminacja Fate:** generyczne fallbacki `mapCoordinates` (spójne we wszystkich silnikach — jedna funkcja `getMapCoordinates()` w utilsach), centra baryczne generowane z geometrii basenów/lądów, źródła wilgoci brzegowe dla dowolnej krawędzi.
6. **A-05 Western Intensification:** flood-fill basenów + pozycja względem centroidu basenu (etap 1); bilans Sverdrupa (etap 2, opcjonalny).
7. **A-07 Nagłówki vs kod:** dopisać barometryczną redukcję do wyświetlania lub skorygować docstringi (jedno z dwóch — dziś to pułapka).
8. **A-08 Priority-Flood prawdziwy:** Barnes 2014 z istniejącym `BinaryHeap`; usunąć maxPasses=30.
9. **A-09 `cells.fl`:** rozdzielić pole (`flAero`) lub konwersja do skali FMG; usunąć cichą mutację stanu FMG.
10. **A-10 Izobary:** marching squares na dualu Delaunaya, poziomy co 4 hPa, etykiety wartości.

### P2 — jakościowe
11. **A-11 RK2 w streamline'ach** (użyć `traceStreamline`) lub korekta opisów; progi wiatru względne (0.25/0.08 max).
12. **A-12 dt z rAF** + clamp; **A-15 DPR/HiDPI**, resize handler.
13. **A-14 Edytor:** pełny `MoistureConfig` + termika w UI; walidacja centrów `isValidBaricCenter`; podgląd hydrologii; persist stanu warstw.
14. **A-16 Integracja `Layers`:** rejestracja warstw w `layers.ts`/`layers-tab.ts`.
15. **A-13 strumień potencjału** dla meandrów (div=0 z definicji).
16. **A-17 `heightExponent`** z options do konwersji h→metry; **A-18** cache SpatialGrid per generacja grafu.
17. **Pętla recyklingu wilgoci:** 1 iteracja ET z biomów (wykorzystać `DEFAULT_EVAPOTRANSPIRATION`).
18. **Throttle drag recompute** w `draw-pressure` (rAF), poprawka zoom-space dla `event.x/y`.

### Kierunki rozszerzeń (v2.1+)
- **Sezonowość** (minimum: 2 stany styczeń/lipiec + interpolacja) — obecny model to średnia roczna; monsuny są dziś symulowane tylko stałą perturbacją termiczną.
- **Kontynentalność temperatury** (amplituda roczna ∝ odległość od morza) — bez tego mapy świata mają oceaniczny klimat Syberii.
- **Lokalne wiatry:** bryza morska/lądowa (jako tryb animacji diurnalnej), katabatyczne przy lądolodach, cyklony tropikalne jako emergentne niższe z ciepłego SST (już istnieje `sstAnomaly` — naturalna ekstensja).
- **Lód morski / pokrywa śnieżna** jako sprzężenie zwrotne temperatury i albedo.

## 8. Plan testów walidacyjnych (dopisać do TEST_PLAN.md)

> Reguła środowiskowa: `expect(arr.includes(val)).toBe(true)` zamiast `.toContain()`. Wszystkie testy deterministyczne (seedowalne gridy syntetyczne, bez losowości).

### 8.1 Atmosfera (`atmosphere-engine.test.ts` — rozszerzenia)
- **T-AT-1 (regresja rotacji):** niski baryczny w centrum planety NH ⇒ cyrkulacja CCW: dla komórek na W i E od centrum sprawdzić znak `cross(V, r)` > 0.
- **T-AT-2 (cross-isobar):** dla niżu `V · ∇P < 0` w pierścieniu 2–5 komórek od centrum (konwergencja).
- **T-AT-3 (równik, po A-04):** przy |lat|<10° `|V · ∇P| > 0.5·|V|` (wiatr wzdłuż gradientu, nie wzdłuż izobar).
- **T-AT-4 (izotropia rozdzielczości, po A-02):** ten sam heightmap syntetyczny na gridach 2k/10k/40k ⇒ median |windSpeed| rozbieżność < 5%.
- **T-AT-5 (NaN guard):** centrum z `pressureHPa = NaN` ⇒ po generate() zero NaN w polach (wymaga guardów — A-14 walidacja).

### 8.2 Ocean (`ocean-engine.test.ts` — rozszerzenia)
- **T-OC-1 (Ekman znak, po A-01):** wind = (1,0) na 45°N ⇒ oceanV < 0 (skręt ku S na ekranie); na 45°S ⇒ oceanV > 0.
- **T-OC-2 (SST meridional):** prąd ku równikowi ⇒ sstAnomaly > 0; ku biegunowi ⇒ < 0 (obie półkule).
- **T-OC-3 (brzeg):** zero komórek lądowych z oceanU/V ≠ 0 po boundary pass.
- **T-OC-4 (basen, po A-05):** akwen prostokątny 200×100 komórek ⇒ maksimum |V| na zachodniej krawędzi **basenu** niezależnie od pozycji akwenu na mapie (przypadek: akwen przy prawej krawędzi mapy).

### 8.3 Wilgoć i opad
- **T-MO-1 (cień fenowy):** pas gór prostopadły do wiatru ⇒ max(prec) nawietrznie / max(prec) zawietrznie > 2.5.
- **T-MO-2 (kontynentalny spadek):** prec maleje monotonicznie z `distFromCoastKm` dla płaskiego kontynentu przy stałym wietrze.
- **T-MO-3 (bilans stałych, po A-03):** `prec[i] · CONST ≈ precipMmYr[i]` z dokładnością ±1 mm (weryfikacja jednej stałej w łańcuchu).
- **T-MO-4 (Clapeyron):** `e_s(0)=6.112`, `e_s(20)≈23.4`, `e_s(30)≈42.4` hPa ±0.5%.
- **T-MO-5 (airCap):** wilgoć ≤ cap dla komórek na 4000 m (kolizja cap-u z wysokością).

### 8.4 Hydrologia
- **T-HY-1 (Strahler kanoniczny):** syntetyczne zlewnie o znanej topologii (Y-junction) ⇒ rzędy 1→2→3 zgodnie z definicją.
- **T-HY-2 (Priority-Flood, po A-08):** kotlina o głębokości 40 h ⇒ po resolveDepressions zero lokalnych minimów poza krawędzią basenu (współcześnie: failsafe przy maxPasses=30).
- **T-HY-3 (Leopold-Maddock):** `W(4Q)/W(Q) ≈ 2` i `D(4Q)/D(Q) ≈ 1.74` (wykładniki 0.5/0.4).
- **T-HY-4 (masa):** sumaryczny dopływ do morza ≈ Σ land `runoff` ± ε (zamknięcie bilansu).

### 8.5 I/O i kompatybilność
- **T-IO-1:** save→load roundtrip pól Float32 ⇒ bitowo identyczne (poza NaN).
- **T-IO-2:** restore na gridzie o innej długości ⇒ false + brak mutacji istniejących pól.
- **T-IO-3:** legacy `.map` bez `data[52]` ⇒ load OK, aeroHydroState pusty, brak warningów poza INFO.
- **T-IO-4 (po A-09):** uruchomienie hydrology-engine nie zmienia `cells.fl` (lub zmienia zgodnie ze skalą FMG).

### 8.6 Wydajność (benchmarki Vitest)
- **T-PF-1:** AtmosphereEngine na 100k komórek < 400 ms (cel CRITICAL_ANALYSIS).
- **T-PF-2:** MoistureAdvectionEngine na 100k < 600 ms (Dijkstra + sweep).
- **T-PF-3:** drawPressure 100k komórek < 200 ms; drag recompute < 50 ms/klatkę po throttlingu.

---

## 9. Werdykt końcowy

**Status modułu: koncepcyjnie dojrzały, fizycznie wymagający korekt P0, architektonicznie gotowy do dekontaminacji od scenariusza Fate.**

Silnik wilgoci i warstwa I/O są na poziomie produkcyjnym. Atmosfera i ocean wymagają naprawy dwóch znaków fizycznych (A-01, A-04) i re-kotwiczenia skal w km (A-02), co jest tanie w wykonaniu, ale fundamentalne dla wiarygodności „fizycznego" charakteru modułu na mapach innych niż Fate. Hydrologia potrzebuje prawdziwego Priority-Flood i jednej stałej bilansowej (A-03, A-08), zanim stanie się zamiennikiem river-generatora FMG. Warstwa wizualna jest estetycznie dobra, a jej głównym brakiem wobec obietnic jest brak prawdziwych izobar i RK w streamline'ach.

Największa wartość strukturalna na przyszłość: **traktowanie mapy Fate wyłącznie jako fixture testowej** oraz **jedno źródło prawdy dla jednostek fizycznych** (km, hPa, mm) — od tego zależy spełnienie deklaracji „kompatybilny z dowolną mapą generatora".









