---
id: TL-106
title: "Ekonomia kontekstu jako reguła projektu — pytaj zapytaniem, nie czytaj drzewa"
type: code
labels: [post-launch]
board: main
epic: "Onboarding"
priority: P2
status: pending
owner: unassigned
estimate: 3h
confidence: high
created: 2026-09-01
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs:
  - CLAUDE.md
  - docs/funkcjonalnosci.md
verification:
  - bash: "node --test scripts/tests/context-budget.test.mjs"
  - bash: "node scripts/cli.mjs query --status pending --count"
  - manual: "`CLAUDE.md` w korzeniu i temat `context-budget` w `worktrail instructions` niosą tę samą regułę, z tabelą kosztów policzoną z bieżącego drzewa, a nie wpisaną na sztywno"
---

## Cel

Agent wie — z reguły projektu, nie z domysłu — że o backlog się PYTA komendą,
a nie czyta się go plikami. Koszt sesji zostaje funkcją jednego taska także
wtedy, gdy backlog urośnie do kilkuset pozycji.

## Kontekst

Architektura jest dziś właściwa: na starcie sesji ładuje się wyłącznie
`CLAUDE.md`, backlog nie wchodzi do kontekstu, dopóki agent po niego nie sięgnie.
Pomiar na tym drzewie (88 tasków, 44 aktywne, 2026-09-01):

```
CLAUDE.md (automatycznie)                      ~940 tok
SKILL.md (gdy skill się odpali)              ~1 810 tok
worktrail stats                                  ~200 tok
query --status pending (44 taski)            ~2 130 tok
jeden plik taska (mediana)                   ~1 130 tok
─────────────────────────────────────────────────────────
typowa sesja na jeden task                   ~6 000 tok   ≈ 3% okna 200k

ścieżka naiwna: cat tasks/*.md            ~115 500 tok   ≈ 58% okna
backlog/INDEX.yaml                           ~2 400 tok   (i NIEŚWIEŻY)
```

Trzy rzeczy tę architekturę psują i żadna nie jest dziś nigdzie zapisana:

1. **Szukanie pracy skaluje się liniowo, praca nie.** `query --status pending`
   kosztuje ~48 tokenów na task. Przy 44 taskach ~2 100; przy 400 — **~19 400
   tokenów tylko po to, żeby zapytać „co teraz"**, czyli trzykrotnie więcej niż
   cała reszta sesji. Docelowe rozwiązanie to `worktrail next` (TL-104, koszt
   stały); do tego czasu regułą jest `--count` i `stats` zamiast pełnej listy,
   a pełna lista tylko z filtrem.
2. **Nic nie broni przed ścieżką naiwną.** `Read` na katalogu tasków albo szeroki
   grep wciąga 115k tokenów i sesja jest ugotowana, zanim zacznie pracę.
   `CLAUDE.md` nie mówi o tym ani słowa; skill mówi dopiero, gdy się odpali,
   a odpala się nie zawsze.
3. **`INDEX.yaml` jest pułapką podwójną**: kosztuje ~12× więcej niż `stats`
   i jest snapshotem ostatniego `build`, więc odpowiada nieświeżo. Leży przy tym
   w oczywistym miejscu i wygląda jak indeks, po który się sięga.

Przy 88 taskach to nie boli. Przy 400 zdecyduje, czy tryb autonomiczny w ogóle
działa — a backlog rośnie właśnie dlatego, że narzędzie działa.

**Rozstrzygnięte: reguła ma jedno źródło.** Trafia do `CLAUDE.md` (bo to jedyna
rzecz ładowana automatycznie) ORAZ jako temat `context-budget` w `worktrail
instructions` (TL-74) — ale jako jeden tekst z jednego miejsca, nie dwie kopie,
które się rozjadą. Jeśli TL-74 jeszcze nie wszedł, zacznij od `CLAUDE.md`
i zostaw punkt zaczepienia.

**Rozstrzygnięte: tabela kosztów jest LICZONA, nie wpisana.** Liczby wpisane na
sztywno zestarzeją się przy pierwszym urośnięciu backlogu i zaczną uczyć
nieprawdy — a to jest ta sama klasa błędu co README opisujący cudzy projekt.
Stąd `worktrail stats --context` albo równoważne: koszt odpowiedzi każdej drogi
policzony z bieżącego drzewa.

## Pre-flight reading

1. `CLAUDE.md` — sekcja „Zanim zmienisz kod"; reguła ma tam pasować tonem
   i zwięzłością. To plik ładowany do KAŻDEJ sesji, więc każde zdanie kosztuje.
2. `.claude/skills/backlog-workflow/SKILL.md` — sekcja „Find work"; dziś mówi
   o `--count`, ale nie mówi DLACZEGO ani czego nie robić.
3. `scripts/stats.mjs` i `scripts/query.mjs` — skąd wziąć liczby do wyliczenia.
4. `backlog/tasks/TL-104-*.md` — `worktrail next`, docelowe rozwiązanie punktu 1.

## Kroki

1. Napisz regułę: **pytaj `query`/`stats`/`next`, nie czytaj `tasks/*.md`
   hurtem i nie czytaj widoków generowanych.** Krótko — to jedzie w każdej sesji.
2. Wpisz ją do `CLAUDE.md` z jednym zdaniem uzasadnienia (58% okna za jeden
   nieostrożny odczyt) i z powodem, dla którego widoki generowane odpadają
   podwójnie: koszt i nieświeżość.
3. `worktrail stats --context` (albo równoważne): koszt odpowiedzi każdej drogi
   policzony z bieżącego drzewa — ile kosztuje `--count`, `stats`, pełna lista,
   jeden task, całe drzewo.
4. Temat `context-budget` w `instructions` (TL-74) z tego samego źródła.
5. Rozważ ostrzeżenie w `doctor`, gdy pełna lista przekracza próg — i rozstrzygnij
   próg wartością, nie przeczuciem (np. udział w typowym oknie).
6. `scripts/tests/context-budget.test.mjs`: `--count` jest o rząd wielkości
   tańszy niż pełna lista na fixture; liczby w tabeli pochodzą z drzewa
   (test oblewa, gdy ktoś je wpisze na sztywno); reguła jest obecna w
   `CLAUDE.md`. Kontrola pozytywna: fixture z inną liczbą tasków daje inne liczby.

## Acceptance criteria

- [ ] Reguła „pytaj, nie czytaj" jest w `CLAUDE.md`, krótko i z uzasadnieniem.
- [ ] Istnieje jedno źródło reguły; `instructions` i skill z niego korzystają, nie kopiują.
- [ ] Koszty są liczone z bieżącego drzewa, nie wpisane na sztywno.
- [ ] Powód odrzucenia widoków generowanych obejmuje OBA argumenty: koszt i nieświeżość.
- [ ] Test oblewa, gdy liczby zostaną zaszyte w kodzie albo gdy reguła zniknie z `CLAUDE.md`.

## Log

2026-09-01 pending — agent:claude — założony po pomiarze ładowania kontekstu: sesja na jeden task to ~6 000 tokenów (3% okna), ale `cat tasks/*.md` to ~115 500 (58%), a szukanie pracy rośnie liniowo — ~19 400 tokenów przy 400 taskach. Architektura jest dobra, nigdzie nie jest regułą.
