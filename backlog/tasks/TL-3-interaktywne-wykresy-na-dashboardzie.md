---
id: TL-3
title: "Interaktywne wykresy dashboardu — dymek z danymi pod kursorem"
type: code
labels: [pre-launch]
epic: ""
board: main
priority: P2
status: done
owner: claude
estimate: 2h
confidence: high
created: 2026-08-26
updated: 2026-08-26
blocked_by: []
blocks: []
related_docs:
  - backlog/README.md
verification:
  - bash: "node backlog/scripts/build-viewer.mjs"
  - manual: "Dashboard → najedź na wykres kumulatywny, dzienny i burndown focusa: krzyżyk/podświetlenie słupka + dymek z datą, wszystkimi seriami i wierszem kontekstu"
  - manual: "Przejście kursorem między wykresami gasi krzyżyk na poprzednim; scroll chowa dymek"
---

## Cel

Trzy wykresy dashboardu (TL-1, TL-2) pokazywały kształt, ale nie liczby.
Odczytanie „ile dokładnie było otwartych 13 sierpnia" wymagało mrużenia oczu
albo wejścia do `INDEX.yaml`. Hover z konkretnymi wartościami domyka wykres:
kształt na pierwszy rzut oka, liczba na żądanie.

## Kontekst

Wykresy są rysowane jako statyczny SVG w generatorze — pozycje pikseli powstają
przy budowie stringa. Dymek mógł je policzyć drugi raz w przeglądarce (skala,
padding, min/max) albo dostać gotowe. **Dostaje gotowe**: każdy `<svg>` niesie
`data-chart` z policzonymi już `x`/`y` i wartościami źródłowymi. Drugi
przelicznik tej samej skali to druga okazja, żeby się z pierwszym rozjechać —
i rozjazd nie objawiłby się błędem, tylko dymkiem pewnie nazywającym punkt, przez
który linia nie przechodzi.

Natywny `<title>` w słupkach (jedyny hover, jaki był) został usunięty: pokazywał
jedną serię naraz, po sekundzie opóźnienia, bez daty w wykresie liniowym i bez
możliwości pokazania bilansu dnia.

## Kroki

1. `dashHoverLayer()` — krzyżyk, podświetlenie słupka i kropki serii jako
   ukryta warstwa + przezroczysty prostokąt przechwytujący.
2. Payload `data-chart` w trzech funkcjach rysujących.
3. `dashHoverMove()` / `dashHoverHide()` + jeden listener na kontenerze.
4. `.chart-tip` poza `#dashboardView` (kontener jest przerysowywany w całości).
5. `backlog/README.md` §2.2.

## Acceptance criteria

- [x] Hover na każdym z trzech wykresów pokazuje datę, wszystkie serie i wiersz
      kontekstu (ruch dnia / bilans / zamknięte do tego dnia).
- [x] Wykres liniowy: krzyżyk + kropki na seriach. Słupkowy: podświetlenie dnia.
- [x] Dymek nie wychodzi poza krawędź okna (odbija się na drugą stronę kursora).
- [x] Wyjście kursorem i scroll chowają dymek; przejście na inny wykres gasi
      krzyżyk na poprzednim.

## Verification

- `node backlog/scripts/build-viewer.mjs` — build zielony.
- W przeglądarce (dark + light), realnym kursorem, nie syntetycznym eventem:
  wszystkie trzy wykresy, przejście między nimi, pozycjonowanie dymka.

## Notes

Pułapka narzędziowa, nie produktowa: panel podglądu w tej sesji raportował
`window.innerWidth === 0`, więc syntetyczne `PointerEvent` z JS-a wchodziły w
`getBoundingClientRect().width === 0` i cicho nic nie robiły. Weryfikacja
hovera musi iść realnym kursorem (`computer hover`), inaczej „nie działa"
i „nie da się zmierzyć" wyglądają identycznie.

## Log

- 2026-08-26: zaimplementowane i zweryfikowane w przeglądarce — claude.
