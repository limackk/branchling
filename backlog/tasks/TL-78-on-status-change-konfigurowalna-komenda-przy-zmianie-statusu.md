---
id: TL-78
title: "on_status_change — konfigurowalna komenda przy zmianie statusu"
type: code
labels: [post-launch]
board: main
epic: "Konfigurowalność"
priority: P3
status: pending
owner: unassigned
estimate: 3h
confidence: medium
created: 2026-08-31
updated: 2026-08-31
blocked_by: []
blocks: []
related_docs:
  - docs/backlog-config-and-portability.md
verification:
  - bash: "node --test scripts/tests/on-status-change.test.mjs"
---

## Cel

Zmiana statusu taska może uruchomić komendę z konfiguracji, z ID, tytułem oraz
starym i nowym statusem w środowisku. Uogólnienie `regen-hook` z jednego
zaszytego przypadku na wyzwalacz, który użytkownik konfiguruje sam.

## Kontekst

`worktrail regen-hook` obsługuje JEDEN scenariusz: edytor zapisał task, przebuduj
widoki. Wejście jest, mechanizm jest, brakuje tylko tego, żeby użytkownik mógł
podpiąć własną reakcję (powiadomienie, wpis do CI, `git commit`) bez patchowania
naszego kodu. To jest IV prawo — rozszerzalność przez kompozycję — zastosowane
do strony piszącej.

Backlog.md ma `onStatusChange` z `$TASK_ID`, `$OLD_STATUS`, `$NEW_STATUS`,
`$TASK_TITLE` i nadpisaniem per task w frontmatterze.

Rozstrzygnięcia:

1. **Warstwa.** Klucz należy do warstwy UŻYTKOWNIKA lub projektu — rozstrzygnij
   i uzasadnij w tasku. Wersjonowana komenda powłoki, która odpala się każdemu,
   kto sklonuje repo, to wykonanie cudzego kodu przy `worktrail build`. Skłaniaj
   się ku warstwie użytkownika i jawnej zgodzie.
2. **Awaria komendy nie może zjeść zapisu taska.** Status jest zapisany, hook
   zawiódł — narzędzie mówi to głośno i wychodzi z kodem !=0, ale nie cofa
   zapisu.
3. **Nadpisanie per task** (jak u nich) rozważ dopiero, gdy warstwa jest
   rozstrzygnięta; klucz w frontmatterze to ta sama kwestia zaufania.

## Pre-flight reading

1. `scripts/regen-hook.mjs` — istniejące wejście hookowe i jego kontrakt na stdin.
2. `scripts/config.mjs` — warstwy konfiguracji i to, która za co odpowiada.
3. `docs/backlog-config-and-portability.md` — rozstrzygnięcia o przenośności
   konfiguracji; nie podważaj ich mimochodem.

## Kroki

1. Rozstrzygnij warstwę klucza i zapisz uzasadnienie (bezpieczeństwo, nie gust).
2. Wykryj zmianę statusu przy zapisie i uruchom komendę ze zmiennymi środowiska.
3. Kod wyjścia !=0 z hooka jest zgłaszany i propagowany; zapis taska zostaje.
4. Udokumentuj w README, wraz z ostrzeżeniem o wykonaniu cudzej komendy.
5. `scripts/tests/on-status-change.test.mjs` — hook dostaje właściwe zmienne;
   awaria hooka nie cofa zapisu; brak klucza to brak wywołania.

## Acceptance criteria

- [ ] Zmiana statusu uruchamia komendę z ID, tytułem, starym i nowym statusem.
- [ ] Warstwa klucza jest rozstrzygnięta i uzasadniona bezpieczeństwem.
- [ ] Awaria hooka jest głośna i nie cofa zapisanego statusu.
- [ ] Bez skonfigurowanego klucza nic się nie uruchamia.

## Log

2026-08-31 pending — agent:claude — założony z analizy Backlog.md (github.com/MrLesk/Backlog.md), punkt 7.
