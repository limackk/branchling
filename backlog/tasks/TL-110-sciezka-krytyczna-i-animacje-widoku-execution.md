---
id: TL-110
title: "Ścieżka krytyczna i animacje widoku Execution"
type: task
labels: []
board: main
epic: "Plan wykonania"
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
estimate: 2h
created: 2026-09-01
updated: 2026-09-01
blocked_by: [TL-109]
blocks: []
related_docs: []
verification:                      # JAK sprawdzić, że task naprawdę jest zrobiony
  - bash: "node --test scripts/tests/viewer-plan.test.mjs"
---

## Cel

Warstwa „wow" nad widokiem Execution z TL-109: podświetlona ścieżka
krytyczna, interaktywne rozświetlanie łańcucha zależności po kliknięciu
w task i animowane przejścia kart przy zmianie statusu na żywo. Czysto
prezentacyjne — żadnej nowej semantyki danych.

## Kontekst

Część epika „Plan wykonania" (rozstrzygnięcia w Kontekście TL-107).
Wydzielone z TL-109 celowo: tamten task dowozi działający, testowalny widok;
ten — polish, który można dowolnie iterować bez ruszania danych i SSE.

Zakres:

1. **Ścieżka krytyczna** — najdłuższy łańcuch `blocked_by` wśród OTWARTYCH
   tasków planu, ważony estymatami (estimate → godziny; mapowanie wartości
   `estimates` z config.yaml na godziny musi być jedną funkcją, nie
   rozsypanymi literałami). Krawędzie i karty ścieżki wyróżnione; suma godzin
   pokazana przy linii teraz jako „critical path: ~Nh". Remis długości —
   dowolna z najdłuższych, deterministycznie (stabilny wybór, nie losowy).
2. **Klik w kartę** — rozświetla wszystko, co ten task odblokowuje
   (tranzytywnie po `blocks`/`blocked_by`), i przygasza resztę; drugi klik
   lub Escape wraca do stanu neutralnego.
3. **Animacje przejść** — karta zmieniająca status po zdarzeniu SSE przechodzi
   płynnie (transform/opacity, CSS transitions); done przekracza linię teraz
   z krótkim wyróżnieniem. Fala domknięta w całości dostaje moment
   podświetlenia zanim przygaśnie.
4. **Dostępność** — `prefers-reduced-motion` wyłącza animacje; wyróżnienie
   ścieżki krytycznej i selekcji nigdy nie jest samym kolorem (grubość/wzór
   krawędzi + tekst na karcie), spójnie z TL-52.

Poza zakresem: przewidywanie dat ukończenia, wykresy ETA, przeciąganie kart
(zmiana planu z poziomu viewera to ewentualny osobny task — wymaga zapisu
`plan.yaml` przez serwer i przemyślenia historii zmian).

## Pre-flight reading

1. TL-109 i jego implementacja — struktura renderu Execution, format danych
   planu w stronie, obsługa zdarzeń SSE.
2. `scripts/build-viewer.mjs` — istniejące konwencje interakcji (klik
   w wykresy z TL-4) i tokeny kolorów.
3. `backlog/config.yaml` — słownik `estimates`; wartości godzin liczone
   z tych danych, nie z literałów w kodzie.

## Kroki

1. Zaimplementuj wyliczanie ścieżki krytycznej (waga = estimate w godzinach)
   w module planu, z testem jednostkowym na fixture z remisem.
2. Render wyróżnienia ścieżki + etykieta sumy godzin.
3. Interakcja klik/Escape z tranzytywnym rozświetlaniem łańcucha.
4. Animacje przejść po SSE + `prefers-reduced-motion`.
5. Rozszerz `scripts/tests/viewer-plan.test.mjs` o ścieżkę krytyczną
   (obecność wyróżnienia i sumy w HTML z fixture'a).

## Acceptance criteria

- [ ] `node --test scripts/tests/viewer-plan.test.mjs` zielone, w tym test
      ścieżki krytycznej z deterministycznym remisem.
- [ ] Ścieżka krytyczna wyróżniona wizualnie nie tylko kolorem; suma godzin
      widoczna.
- [ ] Klik w kartę rozświetla tranzytywny łańcuch `blocks`; Escape wraca.
- [ ] Zmiana statusu przez SSE animuje kartę; `prefers-reduced-motion`
      wyłącza animacje.
- [ ] Mapowanie estimate→godziny czyta słownik z config.yaml, bez literałów
      wartości projektu w kodzie.
- [ ] `worktrail check --language` zielone.

## Log

Append-only. Format: `YYYY-MM-DD status — kto — notatka`.

2026-09-01 pending — agent:claude — wydzielone z TL-109 jako warstwa polish;
czeka na działający widok Execution.
