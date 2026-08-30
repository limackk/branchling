---
id: TL-135
title: "Renumeracja backlogu od 1: mapa, migracja i przekierowania"
type: task
labels: []
board: main
epic: "Integralność danych"
priority: P3                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
estimate: 1w                       # 30m | 2h | 1d | 1w | 1mo
created: 2026-09-01
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs: []
verification:                      # JAK sprawdzić, że task naprawdę jest zrobiony
  - id: decyzja-zapisana
    manual: "W tym pliku stoi rozstrzygnięcie WARIANTU (A/B/C) z uzasadnieniem, albo task jest cancelled z powodem."
  - id: tree-green
    bash: "node scripts/cli.mjs check && node scripts/cli.mjs doctor"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Cel

Backlog ma ciągłą numerację `TL-1`..`TL-135`, a żadne odwołanie nie wskazuje po
migracji na INNY task niż przed nią. **Zrobione 2026-09-01.**

## Decyzja

**Wybrany wariant A — pełna renumeracja.** Analiza rekomendowała wariant C
(numer porządkowy jako wyliczony widok, `id:` bez zmian), bo koszt A leży
w miejscach, których migracja nie dosięga. Decyzja właściciela repozytorium
padła na A i została podtrzymana po przedstawieniu tego kosztu.

Co to kosztowało, wprost — te trzy rzeczy są nadal prawdziwe i nie da się ich
cofnąć migracją:

1. **62 commity mają stary numer w tytule**, a 108 unikalnych ID stoi
   w tytułach i treściach `git log`. Historia jest niezmienna.
2. **192 markery `BL-*` w 50 z 101 plików `scripts/`** przestały zestawiać się
   z drzewem po numerze. Zostawione świadomie: to ślad pochodzenia sprzed
   wydzielenia, a nie odwołanie, które narzędzie ma prawo przepiąć.
3. **Wzmianki wewnątrz rekordów `history/*.jsonl`** (4 sztuki) mówią starymi
   numerami. Log jest append-only — `reason` napisany przez człowieka jest jego
   zdaniem, nie polem, które migracja może poprawić.

Wszystkie trzy zakrywa **tabela przekierowań w `LINEAGE.md`**, kluczowana
NUMEREM, nie prefiksem — dzięki temu obsługuje i `TL-1404`, i `BL-1404`.

## Jak to zrobiono

`worktrail renumber` (`scripts/renumber.mjs`) — osobna komenda, nie flaga do
`migrate-prefix`, bo trzy rzeczy różnią się co do istoty:

- **Rekord niesie CAŁĄ mapę.** Migracja prefiksu jest funkcją starego ID i jej
  rekord może być regułą; renumeracja funkcją nie jest. Stąd
  `kind: "renumber"` w `history/.migrations.jsonl`, a `applyPrefixMigrations`
  zmieniło nazwę na `applyIdMigrations` i rozgałęzia się po rodzaju.
- **Proza jest PRZEPISYWANA, nie liczona.** Po zmianie prefiksu odwołanie
  zostawione w prozie prowadzi donikąd i czytelnik wie, że coś się przesunęło.
  Po renumeracji stary numer nadal istnieje i oznacza inny task — czytelnik nie
  zostaje zatrzymany, tylko wprowadzony w błąd.
- **Przestrzenie ID zachodzą na siebie**, więc rename idzie przez nazwę
  tymczasową w dwóch przebiegach.

Przebieg: 135 tasków, 135 logów historii, **1375 odwołań przepisanych w 368
plikach**, 20 ID nieznanych mapie zostawionych nietkniętych i wypisanych.

## Co wyszło po drodze i jest osobnym tematem

Komenda **nie odróżnia odwołania od PRZYKŁADU**. Komentarze ilustrujące
(„`TL-1303` staje się `TL-1`") zwinęły się w „`TL-1` staje się `TL-1`"
w `scripts/renumber.mjs`, `scripts/history.mjs` i `scripts/task-id.mjs`.
Naprawione ręcznie przez przepięcie przykładów na obcy prefiks `PROJ-`, którego
żadna mapa nie obejmie. Osobny task na to: [[TL-136]].

## Acceptance criteria

- [x] Wariant (A / B / C) jest rozstrzygnięty i uzasadniony w tym pliku. [proof: decyzja-zapisana]
- [x] Jeśli A: mapa `old → new` jest zacommitowanym plikiem, a nie efektem ubocznym uruchomienia. [proof: decyzja-zapisana]
- [x] Jeśli A: `LINEAGE.md` niesie tabelę przekierowań dla ID wspominanych w `git log`. [proof: decyzja-zapisana]
- [x] Jeśli A: żadne odwołanie w prozie nie wskazuje po migracji na INNY task niż przed nią — pominięcia są wypisane, nie przemilczane. [proof: tree-green]
- [x] `check` i `doctor` zielone po zmianie. [proof: tree-green]
- [x] Pełna suita zielona po zmianie. [proof: suite-green]
