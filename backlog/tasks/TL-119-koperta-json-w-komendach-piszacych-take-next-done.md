---
id: TL-119
title: "Koperta JSON w komendach piszących: take, next, handoff, done"
type: code
labels: []
board: main
epic: "Powierzchnia CLI"
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
estimate: 2h                       # 30m | 2h | 1d | 1w | 1mo
created: 2026-09-01
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs:
  - docs/worktrail-global-tool.md
verification:
  - bash: "node --test scripts/tests/json-envelope.test.mjs"
---

## Cel

`take`, `next`, `handoff` i `done` odpowiadają na `--json` w tej samej kopercie
co komendy czytające (`schemaVersion`, `kind`, ładunek). Po tym tasku konsument JSON-a ma
JEDEN kontrakt na całe CLI, a nie dwa zależne od tego, czy komenda pisze.

## Kontekst

TL-72 wprowadził kopertę (`scripts/json-envelope.mjs`) i przepiął na nią
`query`, `stats`, `doctor`, `board` i `next-id`. Zakres tamtego taska był
rozstrzygnięty przed startem na komendy CZYTAJĄCE i celowo nie został
rozszerzony w trakcie — stąd ten task, a nie cicha zmiana obok.

To, co zostało, jest dokładnie tym problemem, dla którego powstała koperta:
`worktrail next --actor agent:claude --json` zwraca goły obiekt, więc dołożenie
do odpowiedzi pola (na przykład ostrzeżenia o przejętym locku) wymaga zmiany
korzenia. README opisuje ten stan jawnie — sekcja „The `--json` contract" mówi,
że komendy piszące jadą jeszcze bez koperty — i to zdanie ma zniknąć razem
z tym taskiem.

`handoff` (TL-99) DOŁĄCZYŁ do tej trójki świadomie, choć powstał już po
kopercie. Powód: gdyby wszedł od razu w kopertę, cztery komendy piszące
odpowiadałyby dwoma kształtami naraz — konsument `take`/`next` czytałby jeden
obiekt, a konsument `handoff` drugi. Jeden kształt dziś i jedna zmiana dla
wszystkich czterech jest tańsza niż jedna komenda „już poprawna" i trzy do
nadrobienia. Test koperty pilnuje kompletu przez tabelę rodzajów, więc dopisanie
`handoff` do niej jest jedną linią.

Uwaga na `done --json`: jego ładunek niesie `entries[]` z kodami wyjścia
weryfikacji i jest czytany przez `jq` w README. Zmiana kształtu jest łamiąca,
a wersja pakietu to nadal `0.1.0` — robimy ją bez ścieżki migracyjnej.

## Pre-flight reading

1. `scripts/json-envelope.mjs` — tabela `KINDS` i reguły pustki; nowe rodzaje
   dopisuje się TAM, nie w emiterze.
2. `scripts/take-task.mjs` (`takeJson()`), `scripts/next-task.mjs`,
   `scripts/handoff-task.mjs` (`handoffJson()`), `scripts/done-task.mjs` —
   cztery dzisiejsze emitery i ich ścieżki odmowy
   (`{ ok: false, kind, id, message, details }`), które też są odpowiedzią.
3. README, sekcja „The `--json` contract" — tabela rodzajów i zdanie o komendach
   piszących do usunięcia.
4. `scripts/tests/json-envelope.test.mjs` — tabela `READING` i kontrola
   pozytywna; nowe rodzaje mają wejść w ten sam mechanizm.

## Kroki

1. Nadaj rodzaje: `task-take` (wspólny dla `take` i `next` — obie zwracają ten
   sam ładunek), `verification-run` dla `done`, osobny dla `handoff` (jego
   ładunek to trzy pary `from`/`to` i komentarz, nie zadanie do wykonania). Rozstrzygnij JEDNĄ decyzję:
   czy odmowa (`ok: false`) to ten sam rodzaj z polem `ok`, czy osobny rodzaj
   `refusal`; zapisz powód w komentarzu przy `KINDS`.
2. Przepnij emitery na `printJson`; żaden nie buduje koperty sam.
3. `next --json` niesie dziś `passedOver` i `considered` — zadeklaruj je
   w rodzaju zamiast doklejać do ładunku `take`.
4. Zaktualizuj README (tabela + usunięcie zdania o komendach piszących) i
   przykłady `jq`.
5. Rozszerz `scripts/tests/json-envelope.test.mjs`: rodzaje piszące wchodzą do
   tej samej tabeli, więc test „rodzaj bez komendy" dalej pilnuje kompletu.
   Dołóż przypadek ODMOWY — to ścieżka, którą łatwo zostawić bez koperty.

## Acceptance criteria

- [ ] `take`, `next`, `handoff` i `done` z `--json` zwracają kopertę z `schemaVersion` i `kind`.
- [ ] Odmowa (`ok: false`) też jest kopertą, nie gołym obiektem.
- [ ] README nie zawiera już zdania o komendach piszących bez koperty.
- [ ] Test pokrywa rodzaje piszące i ścieżkę odmowy.
