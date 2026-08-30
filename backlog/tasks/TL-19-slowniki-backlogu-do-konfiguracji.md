---
id: TL-19
title: Wynieś słowniki backlogu z kodu do konfiguracji
type: code
labels: [pre-launch]
board: main
epic: "Backlog viewer"
priority: P2
status: done
owner: claude
estimate: 4h
confidence: high
created: 2026-08-29
updated: 2026-08-29
blocked_by: [TL-18]
blocks: []
related_docs:
  - docs/backlog-config-and-portability.md
  - backlog/README.md
  - origin#qa/backlog-config-portability.yaml
verification:
  - bash: "node --test backlog/scripts/tests/config.test.mjs"
  - manual: "backlog --dir <obcy backlog z innym config.yaml> — viewer pokazuje TAMTE statusy, labels i typy, zero słownictwa the origin project"
---

## Cel

`pre-launch`, `test_env`, `data-gated`, `owner: founder|claude`, siedem statusów i cztery priorytety to proces JEDNEJ firmy. Dopóki siedziały w kodzie, moduł był narzędziem the origin project, a nie narzędziem. Po tym tasku kod zna KSZTAŁT pola (enum / lista / tekst, jak się zapisuje do frontmattera), a WARTOŚCI przychodzą z `backlog/config.yaml`.

## Kontekst

Krok 2 z dwóch przygotowujących moduł do wydzielenia (krok 1: [TL-18](TL-18-katalog-danych-backlogu-jako-argument.md)).

Przy okazji znika trzeci parser `boards.yaml` — ten sam kształt czytały niezależnie `build-backlog`, `build-viewer` i `check-backlog-boards`; komentarz w guardzie nazywał to wprost „ceną braku zależności".

Pełny kontrakt konfiguracji, lista kluczy i granice: [`docs/architecture/backlog-config-and-portability.md`](../../docs/backlog-config-and-portability.md).

## Kroki

1. `backlog/scripts/config.mjs` — DEFAULTS (generyczne), wąski parser `config.yaml`, jeden parser `boards.yaml`, walidacja spójności między słownikami.
2. `backlog/config.yaml` — wartości the origin project, jeden do jednego z tym, co było w kodzie.
3. `task-fields.mjs` — `FIELD_SHAPES` (kształt) + `buildFieldSpecs(config)` zamiast `EDITABLE_FIELDS` ze stałymi.
4. `build-backlog.mjs` — statusy archiwalne, kolejność priorytetów, aliasy epików, rejestr boardów i nagłówki widoków z konfiguracji.
5. `build-viewer.mjs` — opcje facetów, osie labeli, domyślna oś burndownu, chipy statystyk, rozbicia dashboardu, kolory statusów/priorytetów/labeli i tytuł strony z konfiguracji.

## Acceptance criteria

- [x] `config.yaml` the origin project odtwarza co do wartości słowniki sprzed zmiany (test parytetu).
- [x] DEFAULTS nie zawierają ani jednego słowa ze słownika the origin project.
- [x] Viewer zbudowany z cudzą konfiguracją nie zawiera słownictwa the origin project (bramka na wynikowym HTML-u).
- [x] Nieznany klucz w `config.yaml` OBLEWA zamiast zniknąć.
- [x] Niespójność między słownikami (status archiwalny spoza `statuses`, `default:` boarda spoza listy) oblewa.
- [x] Wygenerowane widoki bez zmian poza nagłówkiem, który teraz mówi nazwą projektu.
- [x] Jeden parser `boards.yaml` zamiast trzech.

## Verification

```bash
node --test backlog/scripts/tests/config.test.mjs      # 14 testów
node --test backlog/scripts/tests/task-fields.test.mjs # 29 testów
```

Dowód: `backlog --dir <obcy katalog>` z `statuses: [todo, doing, shipped]` pokazuje w viewerze te statusy w filtrach, na kartach i w edytorze pola.

## Notes

Świadomie zostawione poza zakresem:
- ekstrakcja rdzenia dashboardu z template literala (osobny krok, warunek `backlog stats` w CLI),
- `init` (bootstrap katalogu w cudzym repo),
- wydzielenie repo, `bin/` + `lib/`, dokumentacja po angielsku.

Zmiana widoczna gołym okiem: chip statystyk mówi teraz „N zamkniętych (X%)" i liczy `archived_statuses` (done + cancelled), a nie samo `done`.

## Log

- 2026-08-29 done — claude — config.mjs + config.yaml + przejście wszystkich konsumentów
