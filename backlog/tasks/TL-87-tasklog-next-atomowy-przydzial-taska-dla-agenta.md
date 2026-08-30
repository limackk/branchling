---
id: TL-87
title: "worktrail next — atomowy przydział taska dla agenta"
type: task
labels: []
board: main
epic: "Wyróżniki agentowe"
priority: P1
status: done
owner: agent:claude
estimate: 1d
confidence: medium
created: 2026-08-31
updated: 2026-09-01
blocked_by: []
blocks: [TL-96, TL-98, TL-99, TL-101]
related_docs:
  - docs/worktrail-state-and-sync.md
  - docs/backlog-time-tracking.md
verification:
  # Jeden wpis na CAŁY plik, nie po jednym na kryterium z `--test-name-pattern`:
  # wzorzec, który nie trafia w żaden test, kończy się zielono i zerem testów, więc
  # taki dowód byłby zielony bez mocy dowodowej. Testy w tym pliku nazywają się
  # tak jak kryteria i każdy ma własną kontrolę pozytywną.
  - id: suite
    bash: "node --test scripts/tests/next.test.mjs"
  - id: no-regression
    bash: "node --test scripts/tests/*.test.mjs"
---

## Cel

Dwa prymitywy na jednej mechanice rezerwacji:

- **`worktrail take TL-NNNN --actor agent:<nazwa>`** — jawne wzięcie WSKAZANEGO
  taska: lock, `status: in_progress`, `owner`, fokus sesji, zdarzenie
  w historii. To jest tryb bezpośredni („zrób TL-1234" powiedziane agentowi
  w Claude Code / Codex) — bez selekcji i bez ról. `take` na tasku
  zalockowanym przez inną sesję odmawia głośno: o kolizji dowiadujesz się
  przy wzięciu, nie przy merge'u.
- **`worktrail next`** = wybór kandydata → `take`. Selekcja jest cienka
  nakładką na ten sam prymityw.

`worktrail next --actor agent:<nazwa>` wybiera najbliższy wykonywalny task
(najwyższy priorytet, `status: pending`, puste albo w całości zamknięte
`blocked_by`), atomowo go rezerwuje, ustawia `status: in_progress` + `owner`,
zapisuje zdarzenie do `history/` i wypisuje task na stdout (z `--json` dla
maszyn). Dwie sesje wołające `next` równocześnie na tej samej maszynie NIGDY nie
dostają tego samego taska.

Gdy to działa, N sesji agentów w N worktree'ach rozbiera backlog samodzielnie,
bez serwera i bez orkiestratora — backlog staje się kolejką pracy dla floty
agentów. To jest wyróżnik kategorii, nie kolejna komenda odczytu.

## Kontekst

Powstało z przeglądu wyróżników wobec Backlog.md (2026-08-31): konkurencyjne
narzędzia są „przyjazne agentom" biernie; żadne nie rozdziela pracy. Fundament
już istnieje: log zdarzeń z ULID (TL-21), łańcuch atrybucji i pojęcie sesji
(projekt pomiaru czasu), locki w obrębie maszyny opisane w
[docs/worktrail-state-and-sync.md](../../docs/worktrail-state-and-sync.md) §6.1 —
atomowość na jednej maszynie zapewnia pojedynczy pisarz, nie konsensus.

Warianty odrzucone:
- **Demon dyspozytora** — łamie decyzję „bez demona"
  ([docs/worktrail-global-tool.md](../../docs/worktrail-global-tool.md) §10).
- **Lock jako zdarzenie w logu** — LWW rozstrzyga po fakcie, więc nie daje
  wzajemnej wykluczalności (state-and-sync §6.1). Lock musi być lokalnym
  prymitywem: transakcja SQLite, a do czasu jej powstania plik lockfile
  tworzony z `O_EXCL` (`wx`) w katalogu poza gitem.
- **Wybór po stronie agenta** („przeczytaj query i weź pierwszy") — okno
  wyścigu między odczytem a zapisem jest dokładnie tym, co ta komenda usuwa.

Zakres świadomie lokalny: gwarancja obejmuje jedną maszynę (wspólny dysk,
worktree'y). Wykluczalność między maszynami to wersja hostowana — nie udawać
jej tutaj.

## Pre-flight reading

- [docs/worktrail-state-and-sync.md](../../docs/worktrail-state-and-sync.md) §5–§6
  — kto wygrywa przy rozjeździe, granica locków lokalnych.
- `scripts/task-fields.mjs` — jedyna definicja zapisu frontmattera; `next`
  pisze przez nią, nie własnym kodem.
- `scripts/history.mjs` — zapis zdarzenia o wzięciu taska.
- `scripts/query.mjs` — istniejąca selekcja i sortowanie; `next` ma je
  wykorzystać, nie powielić.

## Kroki

0. Prymityw `take <ID>`: walidacja istnienia i statusu taska, lock, zapis
   pól jedną istniejącą drogą (`task-fields.mjs`), fokus sesji, zdarzenie
   w historii; zajęty lock = głośna odmowa z informacją, czyja sesja go
   trzyma. `take` na tasku z niepustą rolą inną niż deklarowana przez
   wołającego PRZECHODZI, ale zapisuje w zdarzeniu, że wzięcie było poza
   rolą (rola bramkuje dyspozytor, nie jawne polecenie człowieka —
   TL-97/1508).
1. Selekcja kandydata: reużyj filtrów `query` (status, priorytet wg kolejności
   z `config.yaml`, rozwiązane `blocked_by`); flagi zawężające `--board`,
   `--label`, `--priority`.
2. Rezerwacja: lockfile `wx` per task w katalogu stanu poza gitem; zajęty lock
   = następny kandydat. Wygaśnięcie locka po `lock_ttl_minutes` z konfiguracji
   (kod zna kształt, konfiguracja wartości).
3. Zapis: `status: in_progress`, `owner`, `updated` przez `task-fields.mjs`;
   zdarzenie do `history/` z aktorem z `--actor` (przestrzeń obowiązkowa).
4. Wyjście: pełny task na stdout, `--json` strukturalnie; brak kandydata =
   komunikat + kod wyjścia odróżnialny od błędu wywołania.
5. Test współbieżności: dwa równoległe wywołania `next` na tym samym drzewie
   dostają dwa różne taski — kontrola pozytywna: bez locka ten test MUSI
   oblewać.

## Acceptance criteria

- [x] Dwa równoległe `next` nigdy nie zwracają tego samego taska — test z prawdziwą współbieżnością, nie sekwencyjny. [proof: suite]
- [x] `take` na tasku zalockowanym przez inną sesję odmawia z komunikatem i kodem błędu; nie nadpisuje cudzego locka. [proof: suite]
- [x] `next` jest zaimplementowany jako selekcja + `take` — nie ma drugiej ścieżki rezerwacji (test importów). [proof: suite]
- [x] Task zablokowany przez niezamknięty `blocked_by` nie jest wydawany. [proof: suite]
- [x] `--actor` bez przestrzeni nazw oblewa (spójnie z TL-21). [proof: suite]
- [x] Pusty backlog / brak kandydata daje jednoznaczny komunikat, nie ciszę. [proof: suite]
- [x] Zdarzenie wzięcia taska jest w `history/` z właściwym aktorem. [proof: suite]
- [x] Reszta narzędzia nie regresuje pod równoległym zapisem. [proof: no-regression]

Kryterium „wzięcie poza rolą jest odnotowane w zdarzeniu, nigdy blokowane"
PRZENIESIONE do [TL-97](TL-97-pole-role-taska-wymog-roli-ze-slownika-konfiguracji.md),
który wprowadza pole `role:`. Nie da się go tutaj udowodnić: pola nie ma ani we
frontmatterze, ani w słowniku konfiguracji, więc test brałby fixture z polem,
którego nic innego nie zapisuje — zielony na próbce, której w drzewie nie ma.
Połowa, która jest prawdziwa dziś, jest zrobiona: `take` NIE ma bramki roli
i mieć jej nie będzie (rola bramkuje dyspozytor — decyzja z TL-97).

## Log

Append-only. Format: `YYYY-MM-DD status — kto — notatka`.

- 2026-08-31 pending — agent:claude — task założony z przeglądu wyróżników
  agentowych wobec Backlog.md; źródło: docs/worktrail-state-and-sync.md §6.1.
- 2026-08-31 revised — agent:claude — rozcięte na prymitywy take/next, żeby
  tryb bezpośredni („zrób TL-1234" powiedziane agentowi) dostał lock,
  atrybucję i fokus bez dyspozytora; wzięcie poza rolą odnotowywane, nie
  blokowane.
