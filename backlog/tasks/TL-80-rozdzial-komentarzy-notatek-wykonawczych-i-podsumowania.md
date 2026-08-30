---
id: TL-80
title: "Rozdział komentarzy, notatek wykonawczych i podsumowania końcowego"
type: code
labels: [post-launch]
board: main
epic: "Historia i atrybucja"
priority: P3
status: pending
owner: unassigned
estimate: 4h
confidence: low
created: 2026-08-31
updated: 2026-08-31
blocked_by: []
blocks: []
related_docs:
  - docs/backlog-field-editing-history.md
verification:
  - bash: "node --test scripts/tests/task-sections.test.mjs"
---

## Cel

Trzy różne rodzaje tekstu w tasku mają trzy różne miejsca, bo czyta je kto inny:
dyskusja (komentarz z autorem), postęp wykonania (notatka) i podsumowanie do
pull requesta.

## Kontekst

Dziś wszystko ląduje w `## Log` (append-only, format `data status — kto —
notatka`) plus historia pól w `history/*.jsonl`. `## Log` odpowiada na pytanie
„co się z tym taskiem działo", ale przez to miesza trzy odbiorców: recenzenta
(„czemu tak, a nie inaczej"), wykonawcę („gdzie skończyłem") i autora PR-a
(„co tu wpisać w opis"). Backlog.md rozdziela to na `comments` z autorem,
`implementation notes` i `final summary`.

Uwaga, dlatego `confidence: low`: to jest zmiana MODELU danych taska, nie
dodanie komendy. Zanim cokolwiek napiszesz, rozstrzygnij, czy rozdział zarabia
na swój koszt na NASZYM materiale — przejrzyj `## Log` w kilkudziesięciu
zamkniętych taskach i sprawdź, czy wpisy faktycznie rozpadają się na te trzy
kategorie. Jeśli 90% to jedna linia „done — commit abc", zamknij ten task jako
`cancelled` z uzasadnieniem. To jest legalne zakończenie tego taska.

Drugi warunek: cokolwiek powstanie, musi się zgadzać z tym, co już zapisuje
historia w `history/*.jsonl`. Dwa niezależne rejestry tego samego zdarzenia
rozjadą się.

## Pre-flight reading

1. `_template.md` — sekcja `## Log` i jej deklarowany format.
2. `scripts/history-record.mjs` i `scripts/history.mjs` — co już zapisujemy o
   zmianach i z jaką atrybucją.
3. `docs/backlog-field-editing-history.md` — rozstrzygnięcia o atrybucji;
   przestrzeń nazw aktorów jest obowiązkowa i to zostaje.

## Kroki

1. Przejrzyj `## Log` w zamkniętych taskach i rozstrzygnij, czy rozdział ma sens.
   Jeśli nie — zamknij task jako `cancelled` z tym ustaleniem w logu.
2. Jeśli tak: zdefiniuj sekcje i ich semantykę w `_template.md`.
3. Wejście wywoływalne na każdą z nich (IV prawo), z aktorem w przestrzeni nazw.
4. Wyprowadź je w `query --json` (koperta z TL-72) i w detalu w viewerze.
5. Rozstrzygnij relację z `history/*.jsonl` — jedno źródło, nie dwa rejestry.
6. `scripts/tests/task-sections.test.mjs` — dopisanie zachowuje poprzednie wpisy;
   aktor bez przestrzeni nazw jest odrzucany.

## Acceptance criteria

- [ ] Rozstrzygnięcie „robimy / nie robimy" jest zapisane w logu tego taska wraz z danymi, na których zapadło.
- [ ] Jeśli robimy: każda sekcja ma wejście wywoływalne i atrybucję w przestrzeni nazw.
- [ ] Relacja z `history/*.jsonl` jest jednoznaczna — jedno źródło zdarzenia.
- [ ] Dopisanie nigdy nie kasuje wcześniejszego wpisu.

## Log

2026-08-31 pending — agent:claude — założony z analizy Backlog.md (github.com/MrLesk/Backlog.md), punkt 9. Świadomie dopuszczone zamknięcie jako `cancelled` — patrz `## Kontekst`.
