# Model Klimatyczny dla Świata "Fate"
## Test Kontrolny Black Box - Aero-Hydro Validation

**Data:** 2026-08-26
**Cel:** Model referencyjny do walidacji implementacji klimatu, ciśnienia, wiatru i opadów

---

## 1. Geografia Świata

### Pozycja na kuli ziemskiej
- **Szerokość geograficzna:** 29.7°N do 53.6°N (od północnego Egiptu do południowej Skandynawii)
- **Długość geograficzna:** 5.4°E do 37.3°E (od zachodnich Niderlandów do Bliskiego Wschodu)
- **Powierzchnia:** ~9.37 mln km² (3800 × 2850 px × 0.93 km/px)
- **Powierzchnia procentowa globu:** 11.3%

### Parametry globalne
- **Temperatura na równiku:** 27°C
- **Temperatura na północy:** -12°C
- **Temperatura na południu:** -15°C
- **Rok:** 1091 (era "Thatcheap Era")

### Rozmieszczenie przestrzenne
- **Zachodnia część (5°E - 15°E):** wybrzeże Oceanu Atlantyckiego, wpływ prądu Zatokowego
- **Środkowa część (15°E - 25°E):** wnętrze kontynentu, wpływ kontynentalny
- **Wschodnia część (25°E - 37°E):** głębia kontynentu, suchy klimat, wpływ Azji

---

## 2. Strefy Klimatyczne

### Podział na strefy (według szerokości geograficznej)

| Strefa | Zakres | Zakres (°N) | Procent | Odpowiednik |
|--------|--------|-------------|---------|-------------|
| Pustynia goraca | 29.7 - 33 | 3.3 | 13.8 | Egipt, Libia, Maroko |
| Polpustynia / Pustynia zimna | 33 - 37 | 4.0 | 16.7 | Północne Maroko, Algieria |
| Las wiecznzielony (Śródziemnomorski) | 37 - 40 | 3.0 | 12.6 | Grecja, Turcja, Chorwacja |
| Las miesany (umiarkowana ciepła) | 40 - 45 | 5.0 | 20.9 | Polska, Niemcy, Austria |
| Tajga (umiarkowana chłodna) | 45 - 50 | 5.0 | 20.9 | Południowa Norwegia, Szwecja |
| Tundra lesna (subarktyczna) | 50 - 53.6 | 3.6 | 15.1 | Północna Norwegia, Finlandia |
| **RAZEM** | **29.7 - 53.6** | **23.9** | **100.0** | |

---

### Szczegółowy opis każdej strefy

#### Strefa 1: Pustynia goraca (29.7°N - 33°N)
- **Charakterystyka:** suchy klimat, małe opady, duże amplitudy temperatury
- **Opady roczne:** 50-250 mm, mediana 150 mm
- **Wilgotność:** 30-40%
- **Temperatura roczna:** 22-25°C, lato 30-35°C, zima 10-15°C
- **Parowanie:** bardzo wysokie (3000-4000 mm/rok)
- **Biomy:** gorąca pustynia, pustynia kamienista, półpustynia
- **Prąd oceaniczny:** Prąd canaryjski (chłodzi)
- **Ciśnienie:** podzwrotnikowe wysokie (1020-1030 hPa)
- **Wiatr:** pasaty południowo-wschodnie (suche)

#### Strefa 2: Polpustynia / Pustynia zimna (33°N - 37°N)
- **Charakterystyka:** przejściowa, zimy zimne, lata gorące
- **Opady roczne:** 200-350 mm, mediana 250 mm
- **Wilgotność:** 40-50%
- **Temperatura roczna:** 15-22°C, lato 28-32°C, zima 5-10°C
- **Parowanie:** wysokie (2000-3000 mm/rok)
- **Biomy:** półpustynia, step, pustynia kamienista
- **Prąd oceaniczny:** wpływ Prądu Zatokowego (łagodzenie)
- **Ciśnienie:** przejściowe, wpływ Azorów
- **Wiatr:** mieszane (z zachodu i południa)

#### Strefa 3: Las wiecznzielony / Śródziemnomorski (37°N - 40°N)
- **Charakterystyka:** lato suche i gorące, zima łagodna z opadami
- **Opady roczne:** 300-600 mm, mediana 400 mm
- **Wilgotność:** 50-60%
- **Temperatura roczna:** 16-20°C, lato 25-30°C, zima 5-10°C
- **Parowanie:** średnie (1500-2000 mm/rok)
- **Biomy:** las wiecznie zielony, makiada, dąb, oliwnik
- **Prąd oceaniczny:** Prąd Zatokowy (ociepla)
- **Ciśnienie:** Azory (latem), Nizina Islandzka (zimą)
- **Wiatr:** południowo-zachodni (z oceanu), suchy z południa (latem)

#### Strefa 4: Las miesany / Umiarkowana ciepła (40°N - 45°N)
- **Charakterystyka:** cztery pory roku, opady całoroczne
- **Opady roczne:** 500-800 mm, mediana 650 mm
- **Wilgotność:** 60-70%
- **Temperatura roczna:** 8-12°C, lato 18-22°C, zima -2 do 2°C
- **Parowanie:** średnie (800-1200 mm/rok)
- **Biomy:** las mieszany, dąb, buk, jodła, sosna
- **Prąd oceaniczny:** wpływ Prądu Zatokowego
- **Ciśnienie:** Nizina Islandzka (zimą), Azory (latem)
- **Wiatr:** zachodni (225°), wilgotny z oceanu

#### Strefa 5: Tajga / Umiarkowana chłodna (45°N - 50°N)
- **Charakterystyka:** chłodne lato, bardzo zimna zima
- **Opady roczne:** 400-700 mm, mediana 550 mm
- **Wilgotność:** 65-75%
- **Temperatura roczna:** 3-8°C, lato 14-18°C, zima -8 do -5°C
- **Parowanie:** niskie (400-800 mm/rok)
- **Biomy:** tajga, świerki, sosny, modrzewie
- **Prąd oceaniczny:** wpływ chłodnych prądów północnych
- **Ciśnienie:** Nizina Islandzka (przewaga)
- **Wiatr:** zachodni, północny, wilgotny

#### Strefa 6: Tundra lesna / Subarktyczna (50°N - 53.6°N)
- **Charakterystyka:** bardzo zimna zima, chłodne lato
- **Opady roczne:** 300-600 mm, mediana 450 mm
- **Wilgotność:** 70-80%
- **Temperatura roczna:** 0-3°C, lato 10-14°C, zima -12 do -8°C
- **Parowanie:** bardzo niskie (200-500 mm/rok)
- **Biomy:** tajga, tundra leśna, brzeziny karlowate
- **Prąd oceaniczny:** Prąd Północno-Atlantycki (zimny)
- **Ciśnienie:** Nizina Islandzka (dominująca)
- **Wiatr:** północny, wschodni, chłód arktyczny

---

## 3. Ośrodki Ciśnieniowe

### Główne systemy ciśnieniowe

| System | Położenie | Ciśnienie | Sezon | Wpływ na klimat |
|--------|-----------|-----------|-------|-----------------|
| **Azory (Subtropical High)** | 30-40°N, Atlantyk | 1025-1040 hPa | latem silniejsze | suche lato, łagodne zimy |
| **Nizina Islandzka (Subpolar Low)** | 60-70°N, Atlantyk | 990-1005 hPa | zimą silniejsze | wilgotny, burzowy klimat |
| **Podzwrotnikowe Wysokie** | 20-30°N, Atlantyk | 1020-1030 hPa | całoroczne | suchy klimat pustynny |
| **Sibierskie Wysokie** | 50-70°N, Azja | 1030-1050 hPa | zimą | bardzo zimno, sucho |

### Wpływ na strefy klimatu

| Strefa | Dominujący system | Sezon letni | Sezon zimowy |
|--------|-------------------|-------------|--------------|
| 29.7-33°N | Podzwrotnikowe Wysokie | Azory (silne) | Podzwrotnikowe Wysokie |
| 33-37°N | Przejściowe | Azory | Podzwrotnikowe Wysokie |
| 37-40°N | Azory | Azory (silne) | Nizina Islandzka |
| 40-45°N | Nizina Islandzka | Azory | Nizina Islandzka (silna) |
| 45-50°N | Nizina Islandzka | Nizina Islandzka | Nizina Islandzka (silna) |
| 50-53.6°N | Nizina Islandzka | Nizina Islandzka | Sibierskie Wysokie + Nizina |

---

## 4. Wiatry

### Główne systemy wiatrowe

| Wiatr | Zakres | Kierunek | Intensywność | Powód |
|-------|--------|----------|---------------|-------|
| **Wiatry zachodnie (Westerlies)** | 35-65°N | 225° (południowo-zachód) | 15-25 km/h | Różnica ciśnień Azory-Nizina Islandzka, siła Coriolisa |
| **Pasaty południowo-wschodnie** | 5-30°N | 135° (południowy-wschód) | 20-30 km/h | Różnica ciśnień Podzwrotnikowe Wysokie-Równikowe Niskie |
| **Bryzy morskie** | Wybrzeża | Zmienny (dzień/noc) | 5-15 km/h | Różnica temperatury ląd-morze |
| **Wiatry kontynentalne** | Głębokość lądu | 0-90° (północ/wschód) | 10-20 km/h | Różnica ciśnień kontynent-ocean |

### Dominujące wiatry wg stref

| Strefa | Główny wiatr | Kierunek | Wilgotność | Wpływ na opady |
|--------|--------------|----------|------------|----------------|
| 29.7-33°N | Pasaty | 135° (południowy-wschód) | suchy | brak opadów, suche powietrze z pustyni |
| 33-37°N | Mieszane | 180-225° | średni | opady zimą, suche lato |
| 37-40°N | Zachodni | 225° (południowo-zachód) | wilgotny | opady z oceanu, maksimum jesienią |
| 40-45°N | Zachodni | 225° (południowo-zachód) | wilgotny | częste opady całorocznie |
| 45-50°N | Zachodni/Północny | 225-0° | wilgotny | opady latem, zimą śnieg |
| 50-53.6°N | Północny/Wschodni | 0-90° | wilgotny | opady latem, zimą śnieg, chłód |

### Zależności od pozycji wzdłuż długości geograficznej

| Pozycja | Zachód (5-15°E) | Środek (15-25°E) | Wschód (25-37°E) |
|---------|-----------------|-----------------|-----------------|
| **Wiatr** | Zachodni (z oceanu) | Mieszany | Kontynentalny (z Azji) |
| **Wilgotność** | Wysoka (70-80%) | Średnia (50-60%) | Niska (30-40%) |
| **Opady** | Wyższe (+20-30%) | Średnie | Niższe (-20-30%) |
| **Temperatura** | Łagodniejsza | Kontynentalna | Ekstremalna |

---

## 5. Opady

### Strefy opadowe

| Strefa | Opady roczne | Mediana | Zasięg wilgoci | Parowanie |
|--------|--------------|---------|----------------|-----------|
| Pustynia goraca | 50-250 mm | 150 mm | powierzchniowy | Bardzo wysokie |
| Polpustynia | 200-350 mm | 250 mm | płytkie | Wysokie |
| Las wiecznzielony | 300-600 mm | 400 mm | płytkie | Średnie |
| Las miesany | 500-800 mm | 650 mm | średnie | Średnie |
| Tajga | 400-700 mm | 550 mm | płytsze | Niskie |
| Tundra lesna | 300-600 mm | 450 mm | płytkie | Bardzo niskie |

### Zależności przestrzenne

| Faktor | Zachód | Środek | Wschód |
|--------|--------|--------|--------|
| **Opady** | +20-30% | 100% | -20-30% |
| **Wilgotność** | 70-80% | 50-60% | 30-40% |
| **Zasięg wilgoci w glebie** | 1.5-2 m | 0.8-1.2 m | 0.3-0.6 m |

### Sezonowość opadów

| Strefa | Maksimum | Minimum | Charakter |
|--------|----------|---------|-----------|
| Pustynia goraca | Przypadekowe burze | Brak wyraźny | Nieliniowy |
| Las wiecznzielony | Zima (grudzień-luty) | Lato (lipiec-sierpień) | Śródziemnomorski |
| Las miesany | Jesień/zima | Lato | Całoroczny |
| Tajga | Lato (burze) | Zima (śnieg) | Sezonowy |
| Tundra lesna | Lato | Zima (śnieg) | Sezonowy |

---

## 6. Biomy

### Podział na biomy (według szerokości geograficznej)

| Biom | Zakres | Procent | Warunki | Kluczowe gatunki |
|------|--------|---------|---------|------------------|
| **Gorąca pustynia** | 29.7-33°N | 13.8% | >25°C, <250 mm | Kaktusy, gady, owady |
| **Polpustynia / Pustynia zimna** | 33-37°N | 16.7% | 15-22°C, 200-350 mm | Trawy, krzepy, gady |
| **Las wiecznzielony** | 37-40°N | 12.6% | 16-20°C, 300-600 mm | Dąb, oliwnik, lawenda |
| **Las miesany** | 40-45°N | 20.9% | 8-12°C, 500-800 mm | Buk, dąb, jodła |
| **Tajga** | 45-50°N | 20.9% | 3-8°C, 400-700 mm | Świerki, sosny, modrzewie |
| **Tundra leśna** | 50-53.6°N | 15.1% | 0-3°C, 300-600 mm | Brzeziny, mchy, porosty |

### Zależności od położenia wzdłuż długości geograficznej

| Biom | Zachód (5-15°E) | Środek (15-25°E) | Wschód (25-37°E) |
|------|-----------------|-----------------|-----------------|
| **Pustynia** | Rzadsza (wilgotniej) | Typowa | Rozległa (suchej) |
| **Las wiecznzielony** | Rozległy (wilgotniej) | Typowy | Rzadszy (suchej) |
| **Las miesany** | Rozległy | Typowy | Strefa stepu (suchej) |
| **Tajga** | Rozległa | Typowa | Strefa tundry (zimniej) |

---

## 7. Podsumowanie - Wartości Referencyjne

### Temperatury mediane wg stref

| Strefa | Temperatura roczna | Lato (max) | Zima (min) |
|--------|-------------------|------------|------------|
| 29.7-33°N | 22-25°C | 30-35°C | 10-15°C |
| 33-37°N | 15-22°C | 28-32°C | 5-10°C |
| 37-40°N | 16-20°C | 25-30°C | 5-10°C |
| 40-45°N | 8-12°C | 18-22°C | -2 do 2°C |
| 45-50°N | 3-8°C | 14-18°C | -8 do -5°C |
| 50-53.6°N | 0-3°C | 10-14°C | -12 do -8°C |

### Opady mediane wg stref

| Strefa | Opady roczne | Mediana | Sezon opadowy |
|--------|--------------|---------|---------------|
| Pustynia goraca | 50-250 mm | 150 mm | Brak wyraźny |
| Polpustynia | 200-350 mm | 250 mm | Zima |
| Las wiecznzielony | 300-600 mm | 400 mm | Zima |
| Las miesany | 500-800 mm | 650 mm | Całorocznie |
| Tajga | 400-700 mm | 550 mm | Lato |
| Tundra lesna | 300-600 mm | 450 mm | Lato |

---

## 8. Założenia do Testów

### Testy walidacyjne - kluczowe punkty

#### Temperatura
- [ ] Strefa 29.7-33°N: temperatura roczna >20°C, opady <250 mm
- [ ] Strefa 37-40°N: temperatura roczna 16-20°C, opady 300-600 mm
- [ ] Strefa 40-45°N: temperatura roczna 8-12°C, opady 500-800 mm
- [ ] Strefa 45-50°N: temperatura roczna 3-8°C, opady 400-700 mm
- [ ] Strefa 50-53.6°N: temperatura roczna 0-3°C, opady 300-600 mm

#### Ciśnienie
- [ ] Dominujący system dla stref 29.7-37°N: Azory (latem), Podzwrotnikowe Wysokie (zimą)
- [ ] Dominujący system dla stref 40-53.6°N: Nizina Islandzka

#### Wiatr
- [ ] Dominujący kierunek dla stref 37-50°N: 225° (południowo-zachód)
- [ ] Dominujący kierunek dla stref 29.7-33°N: 135° (południowo-wschód)
- [ ] Wiatry kontynentalne dla strefy 25-37°E

#### Opady
- [ ] Opady maleją od zachodu do wschodu (zależność od długości geograficznej)
- [ ] Maksimum opadów w strefie 40-45°N
- [ ] Minimum opadów w strefie 29.7-33°N

#### Biom
- [ ] Pustynia goraca występuje w strefie 29.7-33°N
- [ ] Las wiecznzielony występuje w strefie 37-40°N
- [ ] Las miesany występuje w strefie 40-45°N
- [ ] Tajga występuje w strefie 45-50°N
- [ ] Tundra lesna występuje w strefie 50-53.6°N

---

## 9. Metodyka Oszacowań

### Założenia
1. Klimat determinowany głównie przez szerokość geograficzną
2. Prądy oceaniczne modyfikują klimat (ocieplają zachodnie wybrzeża, chłodzą wschodnie)
3. Wiatry zachodnie dominują w strefie umiarkowanej (35-65°N)
4. Opady maleją z zachodu na wschód (kontynentalność)
5. Biomy determinowane przez temperaturę i opady

### Źródła
- Klimatologia Ziemi (strefy klimatyczne Köppena)
- Prądy oceaniczne (Prąd Zatokowy, Prąd canaryjski)
- Wiatry planetarne (pasaty, wiatry zachodnie)
- Ośrodki ciśnieniowe (Azory, Nizina Islandzka)

---

## 10. Założenia do Testów Jakościowych

### Testy kwalifikacyjne

| Test | Opis | Oczekiwany wynik |
|------|------|-----------------|
| T1 | Temperatura w strefie 29.7-33°N | >20°C |
| T2 | Temperatura w strefie 50-53.6°N | <5°C |
| T3 | Opady w strefie 29.7-33°N | <250 mm/rok |
| T4 | Opady w strefie 40-45°N | >500 mm/rok |
| T5 | Kierunek wiatru w strefie 40-45°N | 225° ±30° |
| T6 | Kierunek wiatru w strefie 29.7-33°N | 135° ±30° |
| T7 | Biom w strefie 29.7-33°N | Pustynia goraca |
| T8 | Biom w strefie 40-45°N | Las miesany |
| T9 | Wilgotność w strefie 29.7-33°N | <45% |
| T10 | Wilgotność w strefie 50-53.6°N | >70% |

---

## 11. Uwagi Końcowe

### Zakaz
- **NIE** zaglądać do implementacji (to test black box)
- **NIE** wykorzystywać danych z pliku do korekty modelu
- Model oparty wyłącznie na klimatologii ziemskiej

### Cel
- Model służy do walidacji implementacji
- Każde odchylenie od modelu wymaga uzasadnienia
- Testy mają wykazać, czy implementacja jest zgodna z prawdą, czy jedynie "wymysłem"

---

*Model opracowany: 2026-08-26*
*Wersja: 1.0*
*Status: Gotowy do testów*
