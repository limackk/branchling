---
id: TL-91
title: "Time-lapse boardu odtwarzany z logu zdarzeń"
type: task
labels: []
board: main
epic: "Wyróżniki agentowe"
priority: P3
status: pending
owner: unassigned
estimate: 1d
confidence: low
created: 2026-08-31
updated: 2026-08-31
blocked_by: []
blocks: []
related_docs:
  - docs/backlog-field-editing-history.md
  - docs/worktrail-state-and-sync.md
verification:
  - bash: "node --test scripts/tests/board-replay.test.mjs"
---

## Cel

Viewer dostaje tryb odtwarzania: log zdarzeń zna każde przejście statusu
z timestampem, więc board da się przewinąć w czasie — od dnia zero do dziś,
z suwakiem i animacją, z rozróżnieniem kolorem aktora `agent:` od człowieka.
Ten sam mechanizm daje „board na dzień X" (wehikuł czasu do retrospektyw).

Wartość produktowa: wizualny dowód architektury (stan = fold(log)) i materiał,
który krąży po GitHubie — 1400 tasków przepływających przez board w minutę.

## Kontekst

Powstało z przeglądu wyróżników wobec Backlog.md (2026-08-31). Wszystko jest
czystą pochodną istniejących danych (Prawo 2 — wyliczone, kasowalne): funkcja
`stateAt(taskId, ts)` to fold wpisów `history/` do zadanego momentu. Zero
nowych danych, zero nowych zapisów.

Ograniczenia, które trzeba pokazać, a nie ukryć:
- **Historia zaczyna się 2026-08-30.** Przed tą datą jedynym uczciwym sygnałem
  są stemple ukończenia backfillowane z gita (TL-27, gdy powstanie) —
  zgodnie z regułą „stempel ukończenia backfillujemy, czasu pracy nie"
  ([docs/backlog-time-tracking.md](../../docs/backlog-time-tracking.md) §2).
  Bez TL-27 oś czasu zaczyna się w dniu zero historii i suwak ma to jawnie
  pokazywać, nie udawać pustego projektu przed startem.
- Wpisy `legacy` (bez ULID) uczestniczą w foldzie po `ts`, jak wszędzie.

Decyzja techniczna do podjęcia na początku: replay liczony w przeglądarce
z historii wbudowanej w build (jak dziś historia w trybie `file://`) — bez
nowego endpointu. Jeśli objętość wpisów uczyni build za ciężkim, dopiero wtedy
agregat klatek per dzień (też wyliczany, też kasowalny).

## Pre-flight reading

- [docs/backlog-field-editing-history.md](../../docs/backlog-field-editing-history.md)
  §2 — format wpisu, dedup przy odczycie, pseudo-pola `__created__` /
  `__deleted__` (klatka musi wiedzieć, kiedy task w ogóle istnieje).
- `scripts/build-viewer.mjs` — jak historia trafia do builda i jak kod
  klienta żyje w template literalu (pułapka backslashy, §8 tego samego doc).
- `scripts/history.mjs` — odczyt wpisów.

## Kroki

1. `stateAt`: fold historii per task do momentu `ts` (status + istnienie);
   moduł uruchamialny w Node (testowalny) i wklejany źródłem do viewera, jak
   `task-fields.mjs`.
2. UI: suwak zakresu dat + odtwarzanie z regulowaną prędkością; licznik dnia
   i liczby tasków per status; kolor rozróżnia zmiany `agent:` od pozostałych.
3. Stan widoku w URL (spójnie z istniejącym mechanizmem stanu widoków),
   żeby dało się podlinkować „board na 2026-07-01".
4. Jawna granica danych: początek osi czasu opisany („historia od …"),
   opcjonalne stemple ukończenia z gita gdy dostępne.
5. Testy `stateAt` na fixture'ach: kolejność zdarzeń, task skasowany
   i założony ponownie, wpisy legacy.

## Acceptance criteria

- [ ] `stateAt` jest czystą funkcją z testami poza przeglądarką.
- [ ] Replay nie wykonuje żadnych zapisów i działa w trybie `file://`.
- [ ] Moment sprzed startu historii jest oznaczony jako brak danych, nie jako
      pusty board.
- [ ] Zmiany dokonane przez `agent:` są wizualnie odróżnialne od ludzkich.

## Log

Append-only. Format: `YYYY-MM-DD status — kto — notatka`.

- 2026-08-31 pending — agent:claude — task założony z przeglądu wyróżników
  agentowych; czysta pochodna history/, zero nowych danych.
