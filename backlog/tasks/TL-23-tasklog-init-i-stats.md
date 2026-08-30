---
id: TL-23
title: "worktrail init i stats — założenie backlogu i jego stan w terminalu"
type: code
labels: [pre-launch]
board: main
epic: "worktrail — narzędzie"
priority: P2
status: done
owner: claude
estimate: 4h
confidence: high
created: 2026-08-29
updated: 2026-08-29
blocked_by: []
blocks: []
related_docs:
  - backlog/README.md
  - docs/worktrail-state-and-sync.md
verification:
  - bash: "./scripts/worktrail init --dir /tmp/x && ./scripts/worktrail build --dir /tmp/x && ./scripts/worktrail stats --dir /tmp/x"
  - bash: "./scripts/worktrail stats --json | python3 -c \"import json,sys; print(json.load(sys.stdin)['active'])\""
  - bash: "node --test backlog/scripts/tests/init-stats.test.mjs"
---

## Cel

Domknąć dwie komendy odłożone w [TL-22](TL-22-worktrail-dispatcher-komend.md) jako „wymagają wydzielenia rdzenia dashboardu": `init` (założenie nowego backlogu) i `stats` (jego stan w terminalu).

## Kontekst

`stats` był odłożony, bo arytmetyka dashboardu żyje w `build-viewer.mjs` WEWNĄTRZ template literala viewera. Sprawdzenie przed pisaniem zmieniło zakres: **`computeStats` już istniał i był eksportowany**, a z całej reszty `stats` potrzebował wyłącznie przeliczania estymat na godziny (`DASH_UNIT_HOURS`, `dashHours`, `dashSumHours`, `dashHoursLabel`) — kilkanaście linii, nie 270-liniowy `computeDashboard`.

Napisanie tego drugi raz w CLI znaczyłoby, że **dashboard i terminal mogą kiedyś podać dwie różne liczby na to samo pytanie**. Zamiast tego matematyka wyjechała do `estimate.mjs`, wklejanego ŹRÓDŁEM do viewera — ten sam wzorzec, co `task-fields.mjs` i `viewer-url.mjs`. Viewer stracił swoją kopię; jedna implementacja obsługuje obie powierzchnie.

**Poza zakresem świadomie:** ekstrakcja `computeDashboard` (dni, wykresy, burndown, lead time). To ~270 linii sterujących wykresami; wyciąganie ich przy okazji `stats` byłoby refactorem o realnym ryzyku regresji bez potrzeby po stronie CLI.

`init` ma odwrotne ryzyko niż `stats`: **pisze do cudzego katalogu, a zapis nie ma cofnięcia.** Stąd dwie decyzje, które wyglądają na przesadę:

1. **`--dir` OBOWIĄZKOWE.** Wszystkie inne komendy wykrywają backlog w górę od cwd; tutaj wykrywanie byłoby zgadywaniem, GDZIE założyć pliki.
2. **Istniejący plik jest POMIJANY i pominięcie jest wypisane.** Milczenie o pominiętym pliku czyta się jak zapis.

## Kroki

1. `estimate.mjs` — estymata → godziny, bez importów, wklejany do viewera; usunięcie kopii z `build-viewer.mjs`.
2. `stats.mjs` — czysta `summarize(tasks, config)`; aktywne vs zarchiwizowane WEDŁUG konfiguracji, nie po nazwie statusu.
3. `stats-report.mjs` — odczyt `tasks/*.md` (nie widoków — te są gitignored) i formatowanie; `--json`.
4. `init-backlog.mjs` — generyczne szablony (`config.yaml`, `boards.yaml`, `_template.md`, `.gitignore`, `.gitattributes`) + katalogi.
5. Rejestracja obu w tabeli komend `cli.mjs`.

## Acceptance criteria

- [x] `worktrail init --dir <pusty>` daje backlog, na którym `build`, `check` i `stats` przechodzą — sprawdzone jako test i ręcznie.
- [x] `init` nie nadpisuje istniejącego pliku, nie rusza istniejących tasków, dwa razy pod rząd to no-op.
- [x] `init` bez `--dir` OBLEWA zamiast zgadywać katalog.
- [x] Szablony generyczne — test przechodzi po słownictwie the origin project (`pre-launch`, `founder`, `data-gated`, `backlog-project`).
- [x] `stats` liczy z konfiguracji: status nieużyty pokazuje ZERO zamiast zniknąć (brak wiersza czyta się jak „nie sprawdzałem").
- [x] Estymata nieparsowalna daje `null`, nigdy zera, a raport pokazuje ILU tasków nie policzył.
- [x] Liczby skonfrontowane z niezależnym źródłem: `stats` 342/1013 i `query --count` 342/1013; `blocked` 12 w obu.
- [x] Viewer NIE ma już własnej kopii przeliczania estymat; regex sprawdzony w postaci, w jakiej trafia do przeglądarki (wykonany, nie tylko zgrepowany).
- [x] 19 testów `init-stats.test.mjs`; pełna suita 169 zielona.

## Notes

**Poprawka nazwy po sprawdzeniu wyniku:** pierwsza wersja raportu miała wiersz „zablokowanych: 79" tuż pod statusem `blocked: 12`. Dwie różne rzeczy pod jedną nazwą zmuszają czytelnika do zgadywania, którą właśnie widzi — wiersz nazywa się teraz „czeka na inne taski (niepuste `blocked_by`)".

**Nadal poza zakresem:** ekstrakcja `computeDashboard`, per-komendowe `--help` z `usage` z tabeli, `worktrail new` (założenie taska z szablonu + numer z `next-id`).

## Log

- 2026-08-29 created — claude — domknięcie komend odłożonych w TL-22
- 2026-08-29 done — claude — init + stats; przy okazji usunięta kopia przeliczania estymat z viewera
