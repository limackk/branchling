---
id: TL-18
title: Odklej katalog danych backlogu od położenia kodu
type: code
labels: [pre-launch]
board: main
epic: "Backlog viewer"
priority: P2
status: done
owner: claude
estimate: 3h
confidence: high
created: 2026-08-29
updated: 2026-08-29
blocked_by: []
blocks: [TL-19]
related_docs:
  - docs/backlog-config-and-portability.md
  - backlog/README.md
  - origin#qa/backlog-config-portability.yaml
verification:
  - bash: "node --test backlog/scripts/tests/paths.test.mjs"
  - bash: "node backlog/scripts/build-backlog.mjs --dir /tmp/inny-backlog"
  - manual: "backlog --dir <inny katalog> — viewer pokazuje TAMTEN backlog, kod zostaje ten sam"
---

## Cel

Każdy skrypt liczył katalog danych ze swojego własnego położenia (`join(__dirname, "..")`). Działa to dokładnie tak długo, jak długo kod i dane są jednym katalogiem — czyli do pierwszej próby uruchomienia modułu nad innym repozytorium. Po tym tasku katalog danych jest argumentem, a nie właściwością miejsca, w którym leży plik `.mjs`.

## Kontekst

Krok 1 z dwóch, które przygotowują moduł do wydzielenia jako osobne narzędzie (rozmowa z founderem 2026-08-29, wątek „open source + CLI"). Krok 2 to [TL-19](TL-19-slowniki-backlogu-do-konfiguracji.md).

Nie robimy tu wydzielenia repo ani przenoszenia plików — celem jest usunięcie ZAŁOŻENIA, żeby wydzielenie było później jednym `git subtree split`, a nie archeologią.

Pełne uzasadnienie i granice: [`docs/architecture/backlog-config-and-portability.md`](../../docs/backlog-config-and-portability.md).

## Kroki

1. `backlog/scripts/paths.mjs` — `resolveBacklogDir()` z kolejnością źródeł: `--dir` → `BACKLOG_DIR` → wykrywanie w górę od cwd → ko-lokacja; `backlogPaths()` jako jedyne miejsce znające nazwy plików w katalogu.
2. Wszystkie skrypty (`build-backlog`, `build-viewer`, `serve-backlog`, `query`, `history-record`, `suggest-board`, oba guardy) przechodzą na resolver; `--dir` przyjmują tak samo.
3. `readTasks(root)` / `buildHtml(tasks, stats, config)` — funkcje eksportowane biorą katalog i konfigurację, zamiast czytać moduł-globalne stałe.

## Acceptance criteria

- [x] Żaden skrypt nie wywodzi katalogu danych z `__dirname` inaczej niż jako OSTATNIEGO fallbacku.
- [x] `--dir` działa w każdym skrypcie, który dotyka danych.
- [x] Wykrywanie wymaga znacznika (`tasks/` + `boards.yaml`/`config.yaml`/`_template.md`), a nie samego `tasks/`.
- [x] Katalog wskazany wprost, który nie jest backlogiem, jest BŁĘDEM, a nie cichym przejściem do następnego źródła.
- [x] Alias `backlog` uruchamiany z dowolnego katalogu dalej trafia w ten backlog (ko-lokacja).
- [x] Widoki wygenerowane po zmianie są bajtowo identyczne (poza nagłówkiem z TL-19).

## Verification

```bash
node --test backlog/scripts/tests/paths.test.mjs   # 9 testów
```

Dowód rozdziału: `node backlog/scripts/build-backlog.mjs --dir <obcy katalog>` generuje widoki TAMTEGO drzewa, a `git diff` w tym repozytorium jest pusty.

## Log

- 2026-08-29 done — claude — resolver + przejście wszystkich skryptów
