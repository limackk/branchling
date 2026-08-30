---
id: TL-97
title: "Pole role taska: wymog roli ze slownika konfiguracji"
type: task
labels: []
board: main
epic: "Wyróżniki agentowe"
priority: P1
status: done
owner: agent:claude-code
estimate: 2h
confidence: high
created: 2026-08-31
updated: 2026-09-01
blocked_by: []
blocks: [TL-98, TL-99, TL-100]
related_docs:
  - docs/backlog-config-and-portability.md
verification:
  - id: role-end-to-end
    bash: "node --test scripts/tests/task-role.test.mjs"
  - id: field-schema
    bash: "node --test scripts/tests/task-fields.test.mjs scripts/tests/config.test.mjs"
  - id: whole-suite
    bash: "node --test scripts/tests/*.test.mjs"
---

## Cel

Task dostaje opcjonalne pole frontmattera `role:` — wymóg mówiący, KTO może
go wziąć (developer, analityk, docs, reviewer…). Słownik ról mieszka
w `config.yaml` (`roles:`), pole jest walidowane i edytowalne w viewerze jak
każde inne, a jego zmiany trafiają do historii. Task bez roli może wziąć
każdy.

Fundament podziału pracy między wyspecjalizowanych agentów i ludzi: dyspozytor
filtruje po roli (TL-98), przekazanie taska zmienia rolę ze śladem
(TL-99), detektor driftu dokumentacji zakłada taski z rolą docs (TL-100).

## Kontekst

Powstało z decyzji produktowej (2026-08-31): taski mają wskazywać
wyspecjalizowanego wykonawcę, np. analityka podejmującego decyzje, których
agent-developer podejmować nie powinien.

Rozróżnienie, bez którego to pole się rozmyje — zapisać je też w opisie pola:

| Pojęcie | Pytanie | Gdzie |
|---|---|---|
| `role` | kto MOŻE wziąć task | frontmatter (to pole) |
| `owner` | kto trzyma go TERAZ | frontmatter (istnieje) |
| `actor` | kto zapisał zmianę | historia (istnieje) |

Decyzje:
- **Słownik w konfiguracji projektu, nie w kodzie** (Prawo 3 — role to
  wartości projektu; zespół bez analityka po prostu go nie deklaruje).
  Wartość spoza słownika oblewa jak każdy nieznany element słownika;
  brak klucza `roles` w konfiguracji = pole wolne tekstowo? NIE — brak
  klucza znaczy, że projekt ról nie używa, i wtedy niepuste `role:` oblewa
  z komunikatem wskazującym, gdzie słownik zadeklarować. Cicha akceptacja
  literówki stworzyłaby rolę-widmo, której żaden dyspozytor nie obsłuży.
- **Pole opcjonalne i JEDNO.** Nie lista ról, nie reguły przejść, nie stany
  per rola — silnik workflow jest świadomie poza zakresem; procesy składa
  się kompozycją (Prawo 4).
- **Rola bramkuje DYSPOZYTOR, nie jawne wzięcie** (decyzja 2026-08-31).
  `role:` istnieje po to, żeby kolejka bez człowieka nie oddała decyzji
  analityka developerowi. Gdy człowiek każe agentowi zrobić wskazany task
  („zrób TL-1234" w Claude Code / Codex), jawne polecenie bije podpowiedź
  pola: `take` (TL-87) i bezpośrednia edycja plików działają bez zmian,
  a wzięcie poza rolą jest ODNOTOWANE w historii, nigdy blokowane.
  Egzekwowanie ról żyje wyłącznie w selekcji `next` i mapie komend `run`
  (TL-98). Dzisiejszy tryb pracy jednego głównego agenta pozostaje więc
  nietknięty — role nie wchodzą mu w drogę.
- Nowe pole = jedna zmiana w `task-fields.mjs` (kształt) + słownik
  w `config.mjs` — viewer i walidacja serwera mają wyjść z tej samej schemy
  bez osobnych zmian (tak działa `buildFieldSpecs`).

## Pre-flight reading

- [docs/backlog-config-and-portability.md](../../docs/backlog-config-and-portability.md)
  §3 — linia kod-kształt / konfiguracja-wartości i jak dochodzi nowy klucz.
- `scripts/task-fields.mjs` — `FIELD_SHAPES`, `EDITABLE_FIELDS`; wzorzec
  istniejącego pola słownikowego (np. `priority`).
- `scripts/config.mjs` — walidacja słowników i spójności między nimi.

## Kroki

1. Klucz `roles:` w konfiguracji + walidacja (duplikaty, kształt sluga).
2. Pole `role` w `FIELD_SHAPES` jako opcjonalny enum ze słownika; edycja
   w viewerze i zapis historii przychodzą z istniejącej mechaniki pól.
3. Filtr `worktrail query --role <r>` (w tym `--role ""` dla tasków bez roli).
4. `_template.md`: pole z komentarzem objaśniającym różnicę role/owner.
5. Testy: wartość ze słownika przechodzi, spoza słownika oblewa, niepuste
   `role:` bez zadeklarowanego słownika oblewa z pomocnym komunikatem,
   task bez roli przechodzi wszędzie.

## Acceptance criteria

- [x] Rola spoza słownika oblewa build z komunikatem nazywającym plik i wartość. [proof: role-end-to-end]
- [x] Niepuste `role:` przy braku klucza `roles` w konfiguracji oblewa, nie przechodzi po cichu. [proof: role-end-to-end]
- [x] Pole jest edytowalne w viewerze, a zmiana zapisuje wpis historii — bez zmian w kodzie viewera poza schemą. [proof: field-schema]
- [x] `query --role` filtruje; task bez roli nie znika z widoków ogólnych. [proof: role-end-to-end]
- [x] Żadna nazwa roli nie występuje w kodzie (test w duchu bramki generyczności DEFAULTS). [proof: field-schema]
- [x] `worktrail take TL-NNNN` na tasku z rolą inną niż deklarowana przez wołającego PRZECHODZI, a zdarzenie w `history/` odnotowuje, że wzięcie było poza rolą. Kryterium przyszło z [TL-87](TL-87-worktrail-next-atomowy-przydzial-taska-dla-agenta.md), gdzie `take` powstał: tam nie było czego udowodnić, bo pola `role:` jeszcze nie ma. `take` świadomie nie ma i nie dostanie bramki roli — bramkuje dyspozytor (TL-98), a jawne polecenie człowieka jest ponad nim. [proof: role-end-to-end]

## Log

Append-only. Format: `YYYY-MM-DD status — kto — notatka`.

- 2026-08-31 pending — agent:claude — task założony z decyzji o rolach
  subagentów; fundament dla TL-98/1509/1510.
- 2026-08-31 revised — agent:claude — zapisana zasada „rola bramkuje
  dyspozytor, nie jawne wzięcie": tryb bezpośredni głównego agenta pozostaje
  bez zmian, wzięcie poza rolą jest odnotowywane.
