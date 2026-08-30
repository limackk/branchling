---
id: TL-10
title: "Boardy w viewerze jako scope — listy, filtry i dashboard w jednym zakresie"
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
  - bash: "node backlog/scripts/build-viewer.mjs"
  - manual: "Otwórz viewer → przełącz board w headerze → listy, liczniki i dashboard pokazują TYLKO ten board; #BL-NNN z innego boarda przełącza scope zamiast pokazywać pustkę"
---

## Cel

Boardy istnieją w danych (TL-9), ale viewer ich nie zna — a to jest powierzchnia, na której founder faktycznie pracuje. Board ma tam działać jako **scope**, nie jako kolejny dropdown obok Epic.

## Kontekst

Różnica jest mierzalna, nie estetyczna. Filtr zawęża listę kart, ale `computeDashboard()` liczy z `TASKS`; gdyby board był filtrem, dashboard dalej pokazywałby tempo, kolejkę i burndown zmieszane z obu boardów, opisane nagłówkiem sugerującym jeden. Scope zawęża źródło, więc każda liczba w UI mówi o tym samym zbiorze.

Implementacja: `ALL_TASKS` (pełny zbiór) + `TASKS` (widok w scope) i jedna funkcja `applyScope()`. Wszystkie miejsca czytające `TASKS` — filtry, karty, statystyki, dashboard — zawężają się bez własnej wiedzy o boardach.

Stany sąsiednie do pokrycia:
- `#BL-NNN` z innego boarda (link z czatu, zakładka) — musi przełączyć scope, nie pokazać pustki;
- tryb live (File System Access) ma WŁASNY parser frontmattera w kliencie — bez `board` odświeżenie z dysku wyzerowałoby przypisania;
- task z boardem spoza rejestru wstrzykniętego w build (dodany po buildzie) — selektor dopisuje taki board zamiast go połykać.

## Acceptance criteria

- [x] Selektor boarda w headerze; wybór trzyma się przez reload (localStorage) i da się podać dalej w URL.
- [x] Listy, liczniki i dashboard respektują scope.
- [x] `#BL-NNN` spoza scope przełącza scope na board tego taska.
- [x] Kliencki parser live-mode czyta `board`.
- [x] Testy modułu zielone.

## Verification

```bash
node --test backlog/scripts/tests/boards.test.mjs
node backlog/scripts/build-viewer.mjs
```

## Log

- 2026-08-29 in_progress — claude — start; scope zamiast filtra, uzasadnienie w ## Kontekst
- 2026-08-29 done — claude — scope w headerze + dashboardzie; sprawdzone w przeglądarce na żywym viewerze (przełączanie zakresu, przeliczone liczniki, `#TL-1` z innego boarda przełącza scope). Przy okazji: kliencki parser live-mode gubił też `focus` — dopisane, ta sama klasa (dwa parsery jednej schemy)
