---
id: TL-79
title: "worktrail board export — snapshot boarda jako markdown do wklejenia"
type: code
labels: [post-launch]
board: main
epic: "Powierzchnia CLI"
priority: P3
status: pending
owner: unassigned
estimate: 2h
confidence: high
created: 2026-08-31
updated: 2026-08-31
blocked_by: []
blocks: []
related_docs: []
verification:
  - bash: "node --test scripts/tests/board-export.test.mjs"
  - bash: "node scripts/cli.mjs board export --stdout | head -20"
---

## Cel

`worktrail board export` produkuje czytelny markdown ze stanem boarda — do
wklejenia w README, do issue albo do commita jako migawka.

## Kontekst

Backlog żyje w terminalu i w viewerze. Kto nie ma narzędzia (klient,
współpracownik zaglądający do repo na GitHubie), nie widzi nic. Markdown jest
w tym wypadku formatem wymiany, a nie kolejnym widokiem do utrzymania.

Zgodne z II prawem: eksport jest w całości wyliczony, więc wolno go skasować i
odtworzyć jedną komendą. Jeśli kiedykolwiek zaboli jego skasowanie, znaczy że
ktoś zaczął go ręcznie edytować i to jest błąd do naprawienia, nie do obejścia.

Wariant `--readme` z Backlog.md: wstrzyknięcie między znaczniki w istniejącym
pliku, z zachowaniem reszty treści. To jest ta część, którą łatwo zrobić źle —
nadpisanie cudzego README to utrata pracy.

## Pre-flight reading

1. `scripts/build-backlog.mjs` — jak liczone są boardy dzisiaj; eksport ma z
   tego korzystać, nie liczyć drugi raz po swojemu.
2. `scripts/cli.mjs` — komenda `board` i jej flagi.
3. `.gitignore` — co jest wyliczone i niewersjonowane; eksport domyślnie należy
   do tej samej kategorii.

## Kroki

1. `worktrail board export [plik]` — zapis do pliku; `--stdout` na potok.
2. `--readme [plik]` — podmiana zawartości między znacznikami, z zachowaniem
   reszty pliku. Brak znaczników = oblewa z instrukcją, NIE nadpisuje.
3. Istniejący plik bez `--force` = oblewa. Nigdy cichego nadpisania.
4. `scripts/tests/board-export.test.mjs` — eksport zawiera taski z fixture'a;
   `--readme` zachowuje tekst przed i za znacznikami; brak znaczników oblewa;
   istniejący plik bez `--force` oblewa.

## Acceptance criteria

- [ ] `board export` zapisuje markdown ze stanem boarda; `--stdout` pisze na wyjście.
- [ ] `--readme` podmienia tylko obszar między znacznikami.
- [ ] Brak znaczników i istniejący plik bez `--force` oblewają, nie nadpisują.
- [ ] Eksport liczy z tego samego kodu co `build`, nie z drugiej implementacji.

## Log

2026-08-31 pending — agent:claude — założony z analizy Backlog.md (github.com/MrLesk/Backlog.md), punkt 8.
