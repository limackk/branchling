---
id: TL-73
title: "Stan taska liczony z aktywnych gałęzi, nie z bieżącego checkoutu"
type: code
labels: [post-launch]
board: main
epic: "Integralność danych"
priority: P1
status: done
owner: agent:claude
estimate: 1d
confidence: medium
created: 2026-08-31
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs:
  - docs/worktrail-state-and-sync.md
verification:
  # Jeden wpis na CAŁY plik, nie po jednym na kryterium: każdy test w nim ma
  # własną kontrolę pozytywną, a wzorzec nazwy, który nie trafia w żaden test,
  # kończy się zielono i zerem testów — dowód bez mocy dowodowej.
  - id: suite
    bash: "node --test scripts/tests/cross-branch-state.test.mjs"
  - id: no-regression
    bash: "node --test scripts/tests/*.test.mjs"
  - id: manual-two-branches
    manual: "W repo z dwiema gałęziami, gdzie task jest `pending` na main i `in_progress` na feature: `worktrail query --status in_progress` z main pokazuje go i mówi, z której gałęzi pochodzi stan"
---

## Cel

`query`, `stats` i viewer pokazują stan taska widziany na WSZYSTKICH aktywnych
gałęziach, nie tylko na bieżącym checkoucie — i mówią wprost, skąd stan
pochodzi. Po tym tasku dwie sesje w dwóch worktree nie widzą dwóch różnych
backlogów.

## Kontekst

I prawo: dane jadą z gałęzią. To jest zaleta (task przechodzi przez review) i
zarazem jedyna wada tego modelu: widok policzony z jednego checkoutu KŁAMIE o
reszcie. Task ruszony na gałęzi `feature/x` jest na `main` wciąż `pending`, a
`worktrail query --status pending` poda go jako wolny do wzięcia. Dokładnie ten
tryb awarii, dla którego odrzuciliśmy zewnętrzne trackery, tylko odwrócony.

Połowa maszynerii już istnieje i jest sprawdzona w boju: `next-backlog-id.mjs`
skanuje `git worktree list` i `git for-each-ref refs/heads`, a taski czyta przez
`git ls-tree` — właśnie po to, żeby nie przydzielić numeru zajętego gdzie
indziej. Ten task uogólnia ten sam skan z „jakie numery są zajęte" na „jaki jest
stan taska".

Rozstrzygnięcia do podjęcia w trakcie, nie z góry:

1. **Co znaczy „aktywna" gałąź.** Backlog.md używa okna dni od ostatniego commita
   (`activeBranchDays: 30`), z wyłącznikiem na wydajność. Bez okna skan rośnie
   z liczbą martwych gałęzi w repo.
2. **Konflikt stanów.** Gdy dwie gałęzie mają różny `status` tego samego taska,
   narzędzie NIE wybiera zwycięzcy po cichu. Pokazuje oba i nazywa gałęzie.
   Milczący wybór to ta sama klasa błędu co widok z jednego checkoutu.
3. **Praca offline.** Skan czyta wyłącznie lokalne refy. Żadnego `git fetch` bez
   jawnej zgody — narzędzie ma działać bez sieci.

## Pre-flight reading

1. `scripts/next-backlog-id.mjs:89-160` — `worktreeRoots()`, `localRefs()`,
   `fromWorkingTree()`. To jest kod do wydzielenia, nie do napisania od nowa.
2. `scripts/query.mjs` — gdzie dziś wchodzą taski i gdzie wpiąć drugie źródło.
3. `docs/worktrail-state-and-sync.md` — co już rozstrzygnięto o synchronizacji
   stanu; nie podważaj tego bez powodu.

## Kroki

1. Wydziel skan gałęzi/worktree z `next-backlog-id.mjs` do wspólnego modułu
   (`scripts/branch-scan.mjs`), bez zmiany zachowania `next-id`.
2. Dołóż czytanie frontmattera tasków z każdej aktywnej gałęzi (`git ls-tree` +
   `git show`), z oknem czasowym z configu.
3. Klucze konfiguracji w warstwie projektu: okno w dniach i wyłącznik skanu.
   Nieznany klucz oblewa (III prawo) — nie dokładaj warstwy priorytetów.
4. `query` i `stats`: gdy stan na innej gałęzi różni się od lokalnego, pokaż oba
   i nazwij gałąź. Bez skanu (poza repo git) zachowanie jak dziś, z komunikatem.
5. Viewer: ten sam sygnał, ta sama definicja różnicy.
6. `scripts/tests/cross-branch-state.test.mjs` — fixture z dwiema gałęziami i
   rozbieżnym statusem. Test MUSI oblewać, gdy skan zwraca tylko lokalny stan.

## Acceptance criteria

- [x] Skan gałęzi i worktree jest w jednym module, używanym przez `next-id` i przez odczyt stanu. [proof: suite]
- [x] Rozbieżny status jest pokazany z nazwą gałęzi, nigdy rozstrzygnięty po cichu. [proof: suite, manual-two-branches]
- [x] Okno aktywności i wyłącznik skanu są kluczami konfiguracji projektu. [proof: suite]
- [x] Żadna ścieżka nie robi `git fetch` bez jawnej zgody użytkownika. [proof: suite]
- [x] Poza repozytorium git komenda działa i mówi, że stan jest tylko lokalny. [proof: suite]
- [x] Test ma fixture z realną rozbieżnością między gałęziami. [proof: suite, no-regression]

## Log

2026-08-31 pending — agent:claude — założony z analizy Backlog.md (github.com/MrLesk/Backlog.md), punkt 2 (`checkActiveBranches`).
