---
id: TL-77
title: "Completions do shella z wartościami ze słowników config.yaml"
type: code
labels: [post-launch]
board: main
epic: "Powierzchnia CLI"
priority: P3
status: pending
owner: unassigned
estimate: 4h
confidence: medium
created: 2026-08-31
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs: []
verification:
  - bash: "node --test scripts/tests/completions.test.mjs"
  - manual: "W nowej powłoce zsh po instalacji: `worktrail query --status <TAB>` podpowiada statusy z config.yaml tego backlogu, nie literały z kodu"
---

## Cel

`worktrail completion install` zakłada uzupełnianie w bash/zsh/fish, a
podpowiadane wartości pochodzą ze słowników `config.yaml` czytanego backlogu.

## Kontekst

Dziś użytkownik musi PAMIĘTAĆ, że statusy to `pending/in_progress/blocked/done/
cancelled` — wartości, które są własnością jego projektu, nie narzędzia. Skoro
nieznana wartość i tak oblewa (III prawo), to całe uzupełnianie jest już
policzalne: słowniki są zamknięte i leżą w configu. Completions to praktycznie
odczyt tego, co i tak walidujemy.

Backlog.md ma to dla czterech shelli, z dynamicznym uzupełnianiem ID tasków przy
`edit <TAB>`.

Rozstrzygnięte: wartości ZAWSZE z configu backlogu rozwiązanego przez
`resolveBacklogDir()`, nigdy z literałów wpisanych w skrypt uzupełniania.
Skrypt statyczny z zaszytymi statusami rozjeżdża się z projektem przy pierwszej
zmianie configu i uczy wartości, które oblewają.

Otwarte: PowerShell odpuszczamy do czasu, aż ktoś o niego poprosi — nie mamy
środowiska, żeby to sprawdzić, a nieprzetestowany skrypt uzupełniania jest
gorszy niż jego brak.

## Pre-flight reading

1. `scripts/cli.mjs` — tablica komend i flag; to z niej ma powstawać lista, a
   nie z drugiej, ręcznie utrzymywanej kopii.
2. `scripts/config.mjs` — odczyt słowników projektu.
3. `scripts/paths.mjs` — `resolveBacklogDir()`; uzupełnianie musi działać w
   katalogu, w którym użytkownik akurat stoi.

## Kroki

1. `worktrail completion <shell>` — wypisuje skrypt na stdout.
2. `worktrail completion install [--shell <s>]` — wykrywa powłokę i instaluje;
   mówi DOKŁADNIE, który plik zmienił.
3. Skrypt uzupełniania woła z powrotem `worktrail` po wartości dynamiczne (ID
   tasków, statusy, priorytety, boardy, etykiety, właściciele) — bez literałów.
4. Lista komend i flag generowana z tablicy w `cli.mjs`, nie duplikowana.
5. `scripts/tests/completions.test.mjs` — wygenerowany skrypt zawiera każdą
   komendę z tablicy `cli.mjs` (test oblewa po dodaniu komendy bez odświeżenia)
   i podaje statusy z fixture'owego, NIEDOMYŚLNEGO configu.

## Acceptance criteria

- [ ] `completion` obsługuje bash, zsh i fish.
- [ ] Wartości dynamiczne pochodzą z `config.yaml` rozwiązanego backlogu.
- [ ] Lista komend i flag jest generowana z definicji w `cli.mjs`.
- [ ] `install` nazywa plik, który zmienia, i nie nadpisuje go po cichu.
- [ ] Test wiąże skrypt z tablicą komend, więc nowa komenda bez odświeżenia oblewa.

## Log

2026-08-31 pending — agent:claude — założony z analizy Backlog.md (github.com/MrLesk/Backlog.md), punkt 6.
2026-09-01 pending — agent:claude — obniżony P2→P3 z analizy konkurencyjności — jak TL-76: parity czeka za wyróżnikiem.
