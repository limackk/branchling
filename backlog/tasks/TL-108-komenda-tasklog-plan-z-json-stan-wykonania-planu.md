---
id: TL-108
title: "Komenda worktrail plan z --json: stan wykonania planu"
type: task
labels: []
board: main
epic: "Plan wykonania"
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
estimate: 2h
created: 2026-09-01
updated: 2026-09-01
blocked_by: [TL-107]
blocks: []
related_docs: []
verification:                      # JAK sprawdzić, że task naprawdę jest zrobiony
  - bash: "node --test scripts/tests/plan-command.test.mjs"
  - bash: "node scripts/cli.mjs plan --json"
---

## Cel

`worktrail plan` pokazuje stan wykonania planu z `backlog/plan.yaml`: która fala
jest aktywna, co jest „next up", co jest w toku, co poza planem. Z `--json`
staje się wejściem dla agenta implementującego — agent pyta o następny task
jedną komendą, zamiast samemu składać graf z 70 plików.

## Kontekst

Część epika „Plan wykonania" (analiza 2026-09-01, pełne rozstrzygnięcia
w Kontekście TL-107). Ten task to warstwa ODCZYTU nad danymi z TL-107:
format pliku, parser (`scripts/plan.mjs`) i guard już istnieją — tutaj tylko
liczenie stanu i prezentacja. Nie dubluj walidacji: komenda ma używać parsera
z TL-107, a na niespójnym planie oblewać z tym samym komunikatem co guard.

Definicje (liczone z żywych `tasks/*.md`, NIGDY z wygenerowanych widoków —
te są snapshotem ostatniego builda):

- **fala aktywna** — pierwsza fala zawierająca task otwarty
  (status spoza `archived_statuses` z config.yaml),
- **next up** — otwarte taski fali aktywnej, których wszystkie `blocked_by`
  są zamknięte; grupy `together` raportowane razem,
- **in progress** — taski planu ze statusem `in_progress`, niezależnie od fali,
- **unplanned** — otwarte taski spoza planu (jawna liczba + ID; plan gnije
  po cichu, jeśli tego nie pokazujemy),
- **stale** — taski planu już zamknięte w falach PO fali aktywnej (sygnał,
  że plan wymaga przetasowania).

Wyjście tekstowe w stylu reszty CLI (przez `scripts/ui.mjs` — TL-52: kolor
to emfaza, wszystko musi być powiedziane słowami). `--json` zwraca pełną
strukturę (fale ze statusami tasków, next_up, unplanned, stale). Prawo 4
z CLAUDE.md: `--json` na każdej komendzie czytającej.

Brak `plan.yaml` = exit 0 z komunikatem „no plan file" i pustym JSON-em
(`{"waves": []}` + pola puste) — spójnie z guardem z TL-107.

## Pre-flight reading

1. Kontekst TL-107 — format planu i rozstrzygnięcia projektowe.
2. `scripts/plan.mjs` (powstanie w TL-107) — parser i walidacja do reużycia.
3. `scripts/query.mjs` — wzorzec komendy czytającej: ładowanie tasków,
   `--json`, kody wyjścia.
4. `scripts/ui.mjs` — styl wyjścia terminalowego, obsługa NO_COLOR/TTY.
5. `scripts/cli.mjs` — tablica komend, walidacja flag, wpis do `--help`.
6. `.claude/skills/worktrail-cli/SKILL.md` — konwencje powierzchni CLI.

## Kroki

1. Zaimplementuj liczenie stanu (fala aktywna, next up, unplanned, stale)
   w `scripts/plan.mjs` obok parsera — viewer (TL-109) ma reużyć TĘ SAMĄ
   funkcję, żeby CLI i widok nie mogły się rozjechać w definicjach.
2. Dodaj komendę `plan` w `scripts/cli.mjs`: wyjście tekstowe + `--json`;
   nieznana flaga oblewa; wpis w `--help` i `help plan`.
3. Testy na fixture z `_repo.mjs`: plan wielofalowy z taskami w różnych
   statusach; przypadki: brak pliku, fala domknięta, task unplanned,
   task stale, grupa `together` w next up.

## Acceptance criteria

- [ ] `node --test scripts/tests/plan-command.test.mjs` zielone.
- [ ] `worktrail plan` pokazuje falę aktywną, next up (z grupami `together`),
      in progress, liczbę i ID unplanned oraz stale.
- [ ] `worktrail plan --json` zwraca tę samą informację strukturalnie;
      `--json` i tekst liczone jedną funkcją.
- [ ] Brak `plan.yaml`: exit 0, czytelny komunikat, pusty JSON.
- [ ] Niespójny plan: exit niezerowy, komunikat guarda z TL-107.
- [ ] Komenda jest w `--help`; nieznana flaga oblewa (exit 2).
- [ ] `worktrail check --language` zielone.

## Log

Append-only. Format: `YYYY-MM-DD status — kto — notatka`.

2026-09-01 pending — agent:claude — task założony z analizy „plan wykonania";
czeka na format i parser z TL-107.
