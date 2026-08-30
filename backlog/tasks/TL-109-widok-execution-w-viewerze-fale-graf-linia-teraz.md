---
id: TL-109
title: "Widok Execution w viewerze: fale, graf, linia teraz"
type: task
labels: []
board: main
epic: "Plan wykonania"
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
estimate: 1d
created: 2026-09-01
updated: 2026-09-01
blocked_by: [TL-107]
blocks: [TL-110]
related_docs: []
verification:                      # JAK sprawdzić, że task naprawdę jest zrobiony
  - bash: "node --test scripts/tests/viewer-plan.test.mjs"
  - bash: "node --test scripts/tests/ui.test.mjs"
---

## Cel

Viewer dostaje zakładkę „Execution": plan z `backlog/plan.yaml` narysowany jako
pionowy pipeline fal z kartami tasków, krawędziami zależności `blocked_by`
i „linią teraz" oddzielającą zrobione od reszty. Widok aktualizuje się na żywo
przez istniejące SSE — zmiana statusu w pliku przesuwa kartę bez przeładowania.
Efekt ma być WIZUALNIE INNY niż tabele i wykresy reszty viewera: to widok
przepływu, nie lista.

## Kontekst

Część epika „Plan wykonania" (rozstrzygnięcia w Kontekście TL-107). Ten task
zależy od TL-107 (format + parser + logika stanu w `scripts/plan.mjs` —
funkcję „fala aktywna / next up" współdzieli z komendą z TL-108, żeby CLI
i widok nie rozjechały się w definicjach). Od TL-108 NIE zależy.

Co już istnieje i czego NIE budować od nowa:

- **SSE działa.** `serve-backlog.mjs` obserwuje `tasks/` przez `fs.watch`
  i pcha zdarzenia do otwartych kart; widok Execution tylko dorzuca
  przerysowanie po zdarzeniu. Trzeba dodać obserwację samego `plan.yaml`
  (leży poza `tasks/`), żeby edycja planu też odświeżała widok.
- **Historia zna czasy.** `history.mjs` ma moment przejścia w `in_progress`,
  task ma `estimate` — karta taska w toku pokazuje żywy pasek
  „elapsed / estimate" (np. „45m / 2h"), liczony w przeglądarce.
- **Viewer jest self-contained.** Jeden HTML, zero bibliotek — graf rysujemy
  własnym SVG. Layout jest prosty, bo fale z planu SĄ warstwami: pozycja Y
  z indeksu fali, X z indeksu w fali, krawędzie `blocked_by` jako krzywe
  między warstwami. To nie jest ogólny problem rysowania DAG.
- **Palette i dark mode** pochodzą z configu — użyć istniejących tokenów
  kolorów statusów, nie wprowadzać nowych stałych.

Elementy widoku (zakres tego taska; animacje i ścieżka krytyczna to TL-110):

1. Fale jako poziome pasma z nazwą i licznikiem done/total; grupy `together`
   wizualnie spięte (wspólna ramka).
2. Karta taska: ID (link do taska w istniejącym widoku), tytuł, status
   kolorem I SŁOWEM (TL-52: kolor to emfaza), owner, estimate; dla
   `in_progress` — pasek elapsed/estimate.
3. Krawędzie SVG z `blocked_by` między kartami planu; zależność od taska
   spoza planu — mała odznaka na karcie zamiast krawędzi.
4. „Linia teraz" nad falą aktywną; fale domknięte przygaszone.
5. Jawna sekcja „Unplanned (N)" — otwarte taski spoza planu; plan nie może
   udawać kompletności.
6. Brak `plan.yaml` = zakładka z instrukcją jak plan założyć, nie błąd.
7. Widok działa też w trybie file:// (bez SSE — bez live, z danymi z builda);
   stan zakładki w URL jak pozostałe widoki (`viewer-url.mjs`).

## Pre-flight reading

1. Kontekst TL-107 — format planu, „plan jest doradczy, status jest prawdą".
2. `scripts/plan.mjs` (z TL-107/TL-108) — parser i logika stanu do reużycia.
3. `scripts/build-viewer.mjs` — jak dodaje się zakładkę, tokeny kolorów,
   dark mode, konwencje renderowania.
4. `scripts/serve-backlog.mjs` — mechanika SSE i suppressUntil (nie echować
   własnych zapisów); tu dojdzie watch na `plan.yaml`.
5. `scripts/viewer-url.mjs` — stan widoku w URL.
6. `scripts/history.mjs` — skąd wziąć czas wejścia w `in_progress`.
7. `.claude/skills/worktrail-viewer/SKILL.md` — konwencje pracy nad viewerem.

## Kroki

1. Przekaż dane planu do viewera (build: wynik `scripts/plan.mjs` w danych
   strony; serve: endpoint/refresh po SSE).
2. Dodaj watch na `plan.yaml` w `serve-backlog.mjs` i zdarzenie SSE.
3. Zaimplementuj render zakładki Execution (elementy 1–7 z Kontekstu).
4. Podłącz przerysowanie po SSE; sprawdź, że edycja statusu z poziomu
   viewera też odświeża widok.
5. Testy `scripts/tests/viewer-plan.test.mjs`: HTML zawiera fale i karty
   z fixture'a planu; brak planu renderuje instrukcję; task unplanned jest
   wylistowany. Fixture własny — nie asertować wartości z backlogu tego
   repozytorium (reguła z CLAUDE.md).

## Acceptance criteria

- [ ] `node --test scripts/tests/viewer-plan.test.mjs` zielone; `ui.test.mjs`
      bez regresji.
- [ ] Zakładka Execution renderuje fale, karty, krawędzie `blocked_by`,
      linię teraz i sekcję Unplanned z fixture'a.
- [ ] Zmiana statusu taska w pliku przy działającym `worktrail serve` przesuwa
      kartę bez przeładowania strony (SSE).
- [ ] Edycja `plan.yaml` przy działającym serwerze odświeża widok.
- [ ] Karta `in_progress` pokazuje elapsed/estimate z historii.
- [ ] Widok respektuje dark mode i palette z configu; status zawsze także
      słowem.
- [ ] Brak `plan.yaml`: zakładka z instrukcją, zero błędów w konsoli.
- [ ] Chrome viewera po angielsku; `worktrail check --language` zielone.

## Log

Append-only. Format: `YYYY-MM-DD status — kto — notatka`.

2026-09-01 pending — agent:claude — task założony z analizy „plan wykonania";
czeka na dane i parser z TL-107. Animacje i ścieżka krytyczna wydzielone
do TL-110.
