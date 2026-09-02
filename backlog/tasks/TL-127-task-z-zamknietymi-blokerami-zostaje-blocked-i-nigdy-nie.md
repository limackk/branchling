---
id: TL-127
title: "Task z zamknietymi blokerami zostaje blocked i nigdy nie wychodzi z next"
type: task
labels: []
board: main
epic: ""
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:session
estimate: 4h
created: 2026-09-01
updated: 2026-09-02
blocked_by: []
blocks: []
related_docs: []
verification:                      # JAK sprawdzić, że task naprawdę jest zrobiony
  - id: unblocked-is-issuable
    bash: "node --test scripts/tests/unblocking.test.mjs"
---

## Cel

Task, którego wszystkie pozycje `blocked_by` są zamknięte, przestaje być dla
`worktrail next` niewidoczny. Po zmianie kolejka wydaje pracę, która naprawdę
jest gotowa, bez ręcznej edycji statusu przez człowieka.

## Kontekst

Zmierzone 2026-09-01, po zamknięciu TL-94: TRZY taski (TL-95, TL-96,
TL-101) mają status `blocked`, a KAŻDY ich bloker jest już `done`. Żaden z nich
nie wyjdzie z `worktrail next`, bo dyspozytor pomija statusy chronione przez
`reason_required_statuses` (tu: `blocked`, `cancelled`) — słusznie, bo do
`blocked` wchodzi się decyzją, której agent nie ma prawa cofnąć po cichu. Efekt
netto jest jednak taki, że gotowa praca stoi w kolejce, której nikt nie obsłuży,
i wygląda przy tym na zablokowaną.

To jest ta sama klasa wady co niescalona gałąź: stan, który wygląda na aktualny,
a nie jest. Różnica jest istotna: `blocked_by` to FAKT wyliczalny z drzewa
(bloker jest zamknięty albo nie), a `status: blocked` to DEKLARACJA człowieka.
Rozjazd między nimi nie ma dziś żadnego strażnika.

Rozstrzygnąć trzeba jedno i to jest decyzja projektowa, nie implementacja:

- **Kto zdejmuje `blocked`.** Kandydaci: `done` przy zamknięciu blokera (zna
  `blocks:`, ale pisze wtedy do CUDZEGO pliku taska), osobna komenda
  (`worktrail unblock`, jawna i audytowalna), albo NIKT — `next` przestaje
  pomijać `blocked`, gdy `blocked_by` jest domknięte, i sam zdejmuje status przy
  wydaniu, tak jak dziś ustawia `in_progress`.
- **Czy `blocked` z pustym `blocked_by` to inny przypadek.** Task zablokowany
  „z zewnątrz" (czekamy na cudzą decyzję) nie ma czego domknąć i MUSI zostać
  pominięty — inaczej ta zmiana zacznie wydawać pracę, której nie da się zrobić.
- **Ślad w historii.** Zdjęcie `blocked` to zmiana statusu i ma trafić do
  `history/` z aktorem i powodem; powodem jest zamknięcie blokera, nie
  „unknown".

Trzeci wariant wygląda najlepiej, bo nie pisze do cudzego pliku w cudzym
commicie i nie wymaga od nikogo pamiętania o dodatkowej komendzie — ale to jest
teza do sprawdzenia w tym tasku, nie rozstrzygnięcie.

## Pre-flight reading

1. `scripts/next-task.mjs` — `queueStatuses()` i `selectCandidates()`: gdzie
   dokładnie wypadają statusy chronione i gdzie sprawdzane jest `blocked_by`.
2. `scripts/done-task.mjs` — co `done` już wie o `blocks:` przy zamknięciu.
3. `scripts/history.mjs` — `requiresReason()`: reguła mówi o WEJŚCIU w status
   wymagający powodu; wyjście z niego jest dziś nieopisane.
4. `backlog/config.yaml` — `reason_required_statuses`; to WARTOŚCI projektu,
   więc rozwiązanie nie może wpisywać `blocked` do kodu.

## Kroki

1. Rozstrzygnij, kto zdejmuje status, i zapisz odrzucone warianty w tym pliku.
2. Zaimplementuj; nazwa statusu ma pochodzić z konfiguracji, nie z literału.
3. Test `scripts/tests/unblocking.test.mjs`: task `blocked` z domkniętymi
   blokerami JEST wydawany przez `next`, task `blocked` z otwartym blokerem NIE
   JEST, task `blocked` z pustym `blocked_by` NIE JEST (kontrola pozytywna dla
   blokady zewnętrznej), a zmiana statusu ma wpis w `history/` z aktorem.
4. Przejrzyj trzy taski wymienione w kontekście — po zmianie mają być wydawalne.

## Acceptance criteria

- [x] `next` wydaje task `blocked`, którego wszystkie blokery są zamknięte. [proof: unblocked-is-issuable]
- [x] `next` NADAL pomija `blocked` z otwartym blokerem i `blocked` z pustym `blocked_by`. [proof: unblocked-is-issuable]
- [x] Zdjęcie statusu zostawia wpis w `history/` z aktorem i powodem innym niż `unknown`. [proof: unblocked-is-issuable]
