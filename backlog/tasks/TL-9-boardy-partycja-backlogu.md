---
id: TL-9
title: "Boardy — partycja backlogu na main i backlog-project"
type: code
labels: [post-launch]
board: main
epic: ""
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
  - backlog/boards.yaml
verification:
  - bash: "node --test backlog/scripts/tests/boards.test.mjs"
  - bash: "node backlog/scripts/build-backlog.mjs && ls backlog/boards/main/NOW.yaml backlog/boards/backlog-project/NOW.yaml"
---

## Cel

Rozdzielić backlog na boardy, żeby praca nad samym narzędziem nie mieszała się z pracą nad produktem. Dwa boardy na start: `main` (wszystko, co dowozi Talę) i `backlog-project` (usprawnienia modułu `backlog/`). Board wybiera user; gdy go nie poda, agent ma dostać odpowiedź z deterministycznego skryptu, a nie z własnego wyczucia.

## Kontekst

`epic` nie nadaje się na tę warstwę: to free text (144 unikalnych wartości, warianty pisowni typu `Daily planner` / `Daily Planner`), a README §3.1 wprost mówi „nie jest hierarchią". Nic nie oblewa na literówce w epiku i to jest w porządku — epic tylko grupuje. Board przeciwnie: bywa wybierany maszynowo, więc literówka tworzyłaby trzeci board, którego nikt nie otwiera, i task znikałby z obu realnie czytanych widoków. Stąd asymetria: słownik boardów jest zamknięty (`boards.yaml`), nieznany slug oblewa build.

Odrzucone alternatywy:
- **Prefiksy per board** (`DEV-12`, `ANA-3`) — złamałyby `next-backlog-id.mjs` (unia liczona z `/^BL-(\d+)-/` po worktree'ach i gałęziach), guard kolizji ID i wszystkie odwołania `BL-NNN` w docs i commitach.
- **Katalogi `tasks/<board>/`** — złamałyby `readdirSync(TASKS_DIR)` w trzech skryptach, `fileForTaskId()` w `serve-backlog.mjs` i każdą ścieżkę `tasks/BL-...` zapisaną w INDEX-ie. Board jako pole frontmattera = zero ruchu plików.
- **Wiele boardów na task** — to już nie partycja, tylko drugi zestaw `labels`.

Nieoczywiste odkrycie z routingu (mierzone na całym drzewie, 2026-08-29): router po SŁOWIE „backlog" przypisałby do boarda o narzędziu 247 z 1339 tasków, bo protokół agenta (README §5) każe w każdym tasku wołać `build-backlog.mjs`. Router po ŚCIEŻKACH bez listy wyjątków dawał 17 trafień, z czego 9 fałszywych — z tego samego powodu (`backlog/scripts/build-backlog.mjs` i odsyłacz do `backlog/README.md` występują w taskach produktowych). Dlatego `boards.yaml` ma `ignore_paths:` ze ścieżkami protokolarnymi. Po ich odjęciu zostało 9 trafień, z czego 8 to realne taski o viewerze/dashboardzie backlogu.

Jedno ręczne nadpisanie routera: **BL-904** („Guardy pre-commit nie działają na czystym merge'u") router proponował jako `backlog-project`, bo task wymienia `backlog/scripts/tests/backlog-id-collisions.test.mjs`. Praca w tym tasku modyfikuje `.githooks/*`, a test backlogu jest tam tylko siatką regresji → `main`.

## Kroki

1. `backlog/boards.yaml` — rejestr (slug, name, description, `paths:` routingu, globalne `ignore_paths:`, `default: main`).
2. `build-backlog.mjs` — czytanie rejestru, pole `board` we frontmatterze, `by_board` w statystykach, `board:` w wierszach FOCUS/INDEX/archive, widoki `boards/<slug>/{FOCUS,INDEX}.yaml`, flaga `--root` (testowalność), twardy exit 1 na nieznanym slugu.
3. `suggest-board.mjs` — router po ścieżkach z `related_docs:` i z treści taska, minus `ignore_paths`.
4. `_template.md` — pole `board:` nad `epic:`.
5. Migracja 1339 plików: `board:` wstawiony po `epic:`; 8 tasków o viewerze/dashboardzie → `backlog-project`, reszta → `main`.
6. Dokumentacja: README §3.5 + protokół agenta §5, workspace `CLAUDE.md` § Backlog.

## Acceptance criteria

- [x] Każdy z 1339 tasków ma `board:` ze słownika `boards.yaml`.
- [x] `boards/main/` i `boards/backlog-project/` mają własne widoki (dziś: NOW.yaml + INDEX.yaml; przy powstaniu taska było to FOCUS.yaml — zniesione w TL-13).
- [x] Root `NOW.yaml` / `INDEX.yaml` nadal globalne (nic, co je czyta, nie musi się zmieniać).
- [x] Nieznany slug oblewa build (exit 1), brak pola = default + ostrzeżenie.
- [x] `node --test backlog/scripts/tests/boards.test.mjs` — 6/6 zielonych.

## Verification

```bash
# Test modułu — 6 przypadków, w tym „realne drzewo ma poprawne boardy"
node --test backlog/scripts/tests/boards.test.mjs

# Widoki per board powstają i sumują się do całości
node backlog/scripts/build-backlog.mjs

# Router: task o module vs task produktowy
node backlog/scripts/suggest-board.mjs backlog/tasks/TL-1-dashboard-w-backlog-viewerze.md  # → backlog-project
```

## Notes

Świadomie poza zakresem (osobne taski, gdy będą potrzebne):
- viewer/dashboard nie zna jeszcze boardów — board powinien tam być SCOPE (zawężającym też liczby dashboardu), nie kolejnym dropdownem obok Epic, inaczej wskaźniki mieszają boardy;
- brak guardu pre-commit na pole `board` — dziś pilnuje tego test modułu, nie hook;
- `serve-backlog.mjs` nie ma `POST /api/board` (przenoszenie taska z UI).

## Log

- 2026-08-29 created — claude — task założony w trakcie wdrożenia, jako pierwszy mieszkaniec boarda `backlog-project`
- 2026-08-29 done — claude — rejestr + generator + router + migracja 1339 tasków; test red-first (6 przypadków) zielony
