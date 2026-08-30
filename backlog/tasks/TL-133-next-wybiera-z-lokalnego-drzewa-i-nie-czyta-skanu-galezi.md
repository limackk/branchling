---
id: TL-133
title: "next wybiera z lokalnego drzewa i nie czyta skanu gałęzi"
type: task
labels: []
board: main
epic: "Wyróżniki agentowe"
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
estimate: 2h                       # 30m | 2h | 1d | 1w | 1mo
created: 2026-09-01
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs: []
verification:
  - id: two-trees
    bash: "node --test scripts/tests/next-cross-branch.test.mjs"
  - id: docs-say-clone
    manual: "W dwóch worktree jednego repozytorium: task wzięty na gałęzi bocznej nie wychodzi z `worktrail next` w głównym checkoucie, a komunikat nazywa gałąź; po `cross_branch_state: false` ten sam układ wydaje go; README.md i `worktrail instructions autonomous-loop` mówią „klon", nie „maszyna""
---

## Cel

`worktrail next` przestaje wydawać task, o którym INNA gałąź albo inny worktree
już mówi, że jest w toku. Dziś wybór czyta wyłącznie pliki z bieżącego drzewa,
podczas gdy `query`, `stats` i viewer czytają także skan gałęzi (TL-73) — więc
komenda, która jako JEDYNA coś zapisuje, ma węższą wiedzę niż te, które tylko
czytają.

## Kontekst

To nie jest teoria. CLAUDE.md opisuje przebieg z 2026-09-01: TL-74 zamknięty
o 13:41 na jednej gałęzi, o 13:43 druga sesja dostała ten sam task z `next`, bo
w jej drzewie miał jeszcze status `pending`. Rezerwacja tego nie łapie —
lockfile jest kluczowany przez `git rev-parse --git-common-dir`, więc wyklucza
sesje działające JEDNOCZEŚNIE w worktree jednego klona, a nie stan zapisany na
cudzej gałęzi. Skan gałęzi jest dokładnie tą brakującą informacją i już istnieje:
`scripts/branch-scan.mjs`, sterowany kluczami `cross_branch_state` oraz
`active_branch_days`.

Uwaga na granicę, bo od niej zależy kształt rozwiązania: skan czyta LOKALNE
referencje, nigdy `git fetch`. Rozwiązuje więc przypadek wielu worktree i wielu
gałęzi jednego klona, a nie dwóch maszyn. Dokumentacja (`README.md`, temat
`autonomous-loop` w `instructions`) mówi dziś, że granicą jest maszyna — i to ma
zostać prawdą, tylko przesuniętą we właściwe miejsce.

Rozstrzygnięcia do podjęcia w tasku, nie z góry:

- Czy rozjazd (`pending` tu, `in_progress` gdzie indziej) ma task WYKLUCZAĆ
  z puli, czy tylko przesuwać na koniec, jak grupa odzyskiwana z TL-104.
- Co z kosztem: skan płaci się przy każdym `next`, a pętla autonomiczna woła
  `next` w kółko. `cross_branch_state: false` musi zostawiać dzisiejsze
  zachowanie, jawnie.

## Pre-flight reading

1. `scripts/next-task.mjs` — `selectCandidates()`; tu zapada wybór i tu dziś
   nie ma ani jednego odwołania do skanu.
2. `scripts/branch-scan.mjs` — co skan zwraca i ile kosztuje.
3. `scripts/task-select.mjs` — `parseTaskRecord()` ustawia `elsewhere: []`, a
   `allStatuses()` pokazuje, jak `query` łączy stan lokalny z cudzym.
4. `backlog/tasks/TL-73-*.md` — dlaczego skan powstał i czego świadomie nie robi.
5. `scripts/tests/cross-branch-state.test.mjs` — istniejące pokrycie skanu.

## Kroki

1. Wpiąć skan w `selectCandidates()` za `cross_branch_state`, z decyzją
   „wyklucz" albo „na koniec" podjętą i UZASADNIONĄ w kodzie.
2. Odmowa/pominięcie ma NAZYWAĆ gałąź i status, które o tym zdecydowały —
   milczące pominięcie wygląda jak pusta kolejka.
3. Zaktualizować granicę gwarancji w `README.md` i w temacie `autonomous-loop`
   (`scripts/instructions.mjs`): dziś oba mówią „maszyna", po zmianie prawdą
   będzie „klon".
4. Test na dwóch worktree jednego repozytorium: task w toku na gałęzi bocznej
   nie wychodzi z `next` w głównym checkoucie. Kontrola pozytywna: przy
   `cross_branch_state: false` ten sam układ task wydaje.

## Acceptance criteria

- [ ] `next` nie wydaje taska, który na innej AKTYWNEJ gałęzi lub w innym worktree jest w toku. [proof: two-trees]
- [ ] Powód pominięcia nazywa gałąź i status, nie jest cichy. [proof: two-trees]
- [ ] `cross_branch_state: false` zostawia dzisiejsze, jednodrzewowe zachowanie. [proof: two-trees]
- [ ] Granica gwarancji w `README.md` i w `instructions autonomous-loop` mówi „klon", nie „maszyna". [proof: docs-say-clone]
- [ ] Test na dwóch worktree z kontrolą pozytywną przy wyłączonym skanie. [proof: two-trees]
