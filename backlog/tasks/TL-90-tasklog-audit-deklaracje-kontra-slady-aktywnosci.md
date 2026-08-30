---
id: TL-90
title: "worktrail audit — deklaracje kontra ślady aktywności"
type: task
labels: []
board: main
epic: "Wyróżniki agentowe"
priority: P2
status: pending
owner: unassigned
estimate: 1d
confidence: medium
created: 2026-08-31
updated: 2026-08-31
blocked_by: []
blocks: []
related_docs:
  - docs/backlog-field-editing-history.md
  - docs/backlog-time-tracking.md
verification:
  - bash: "node --test scripts/tests/audit.test.mjs"
---

## Cel

`worktrail audit` krzyżuje deklaracje backlogu ze śladami w logu zdarzeń
i raportuje rozjazdy:

- task `done` bez jednego zdarzenia przejścia w `history/` — zamknięty bez
  śladu;
- task reopenowany po `done` — rework, zliczany per aktor zamykający
  („done od agent:claude wraca w N% przypadków");
- `in_progress` bez zmiany pola od `audit_stale_days` — parking, nie praca;
- `blocked` z pustym `blocked_by` — deklaracja bez przesłanki.

Backlog przestaje być zbiorem deklaracji na wiarę: każde „done" ma dowód albo
jest wskazane. Żaden sąsiad (Backlog.md, mdtask) nie może tego zrobić, bo nie
ma zdarzeń przejść ani atrybucji.

## Kontekst

Powstało z przeglądu wyróżników wobec Backlog.md (2026-08-31). Klasa błędu
jest realna i lokalna: commit 27776f0 („TL-52 was done and said pending")
oraz stan parkingowy `in_progress` opisany w
[docs/backlog-time-tracking.md](../../docs/backlog-time-tracking.md) §3.1
(45 tasków `in_progress`, 32 z `owner: claude` — to nie jest 32 pracujących
agentów).

Zasady, bez których ten raport sam by kłamał:
- **Brak śladu to podejrzenie, nie wyrok.** Historia ruszyła 2026-08-30
  i jest dziennikiem obserwacji, nie logiem audytowym
  ([docs/backlog-field-editing-history.md](../../docs/backlog-field-editing-history.md)
  §4). Taski zamknięte przed dniem zero mają być odfiltrowane po dacie, nie
  raportowane hurtem jako anomalie.
- **Progi w konfiguracji** (`audit_stale_days` itd.) — kod zna kształt.
- **To narzędzie higieny backlogu, nie oceny ludzi** — ta sama granica, którą
  time-tracking §13 stawia pomiarowi czasu; zdanie ma stać w opisie komendy.
- Kubełki per aktor poniżej progu `n` raportują „za mało danych" (reguła
  z §11 time-trackingu).

Odrębność od `worktrail check`: check waliduje SPÓJNOŚĆ STRUKTURALNĄ (kolizje ID,
boardy, wiszące referencje) i oblewa commit; audit waliduje WIARYGODNOŚĆ
DEKLARACJI i jest raportem dla człowieka. Nie łączyć — inny moment użycia,
inny kod wyjścia.

## Pre-flight reading

- [docs/backlog-field-editing-history.md](../../docs/backlog-field-editing-history.md)
  §2, §4 — format wpisów, dedup, świadome ograniczenia atrybucji.
- [docs/backlog-time-tracking.md](../../docs/backlog-time-tracking.md) §3.1,
  §8.2 — pułapka cycle time i zasada „unknown jest liczbą".
- `scripts/check-backlog-refs.mjs` — istniejący wzorzec przechodzenia po
  taskach z referencjami.

## Kroki

1. Detektory jako osobne funkcje nad wspólnym odczytem (taski + historia):
   done-bez-śladu, reopen-po-done, stale-in-progress, blocked-bez-przesłanki.
2. Raport tekstowy pogrupowany detektorem + `--json`; liczność każdej klasy
   w nagłówku; filtr `--since` domyślnie od dnia zero historii.
3. Wskaźnik reworku per aktor z progiem `n` i „za mało danych" poniżej.
4. Kody wyjścia: 0 czysto, 1 znaleziono rozjazdy, 2 błąd wywołania — spójnie
   z resztą CLI.
5. Testy na fixture'ach: każdy detektor ma przypadek pozytywny i negatywny;
   kontrola pozytywna obowiązkowa (guard przechodzący na pustym drzewie jest
   zielony bez mocy dowodowej — CLAUDE.md).

## Acceptance criteria

- [ ] Każdy detektor ma test, w którym COŚ znajduje, i test, w którym słusznie
      milczy.
- [ ] Taski sprzed startu historii nie są raportowane jako „done bez śladu".
- [ ] Progi pochodzą z `config.yaml`; nieznany klucz oblewa jak dotąd.
- [ ] Raport per aktor stosuje próg `n` i nie ocenia poniżej niego.

## Log

Append-only. Format: `YYYY-MM-DD status — kto — notatka`.

- 2026-08-31 pending — agent:claude — task założony z przeglądu wyróżników
  agentowych; motywacja: 27776f0 i §3.1 dokumentu pomiaru czasu.
