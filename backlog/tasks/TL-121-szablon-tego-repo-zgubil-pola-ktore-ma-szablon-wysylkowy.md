---
id: TL-121
title: "Szablon tego repo zgubił pola, które ma szablon wysyłkowy"
type: task
labels: []
board: main
epic: "Historia i atrybucja"
priority: P2
status: pending
owner: unassigned
estimate: 2h
confidence: medium
created: 2026-09-01
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs: []
verification:
  - id: shape-parity
    bash: "node --test scripts/tests/template-shape.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Cel

`backlog/_template.md` i korzeniowy `_template.md` mają ten sam KSZTAŁT: te same
klucze frontmattera, wpis `verification:` z `id:` i sekcję kryteriów uczącą
`[proof: <id>]`. Różnią się WYŁĄCZNIE językiem prozy. Pilnuje tego test, który
listę pól WYLICZA z szablonu wysyłkowego, zamiast ją przepisywać.

## Kontekst

Repozytorium trzyma dwa szablony i to jest w porządku: korzeniowy `_template.md`
jedzie w tarballu do cudzych repozytoriów (angielski, pod strażą
`check --language`), a `backlog/_template.md` jest szablonem TEGO backlogu
i po polsku. Wada nie polega na tym, że są dwa — tylko na tym, że rozjechały
się w wymiarze, w którym rozjechać się nie mogą.

Granica biegnie tam, gdzie CLAUDE.md ją stawia: **kod zna KSZTAŁT, dane znają
WARTOŚCI.** Klucze frontmattera i struktura wpisu `verification:` to kształt —
czyta je `task-fields.mjs` i `criteria.mjs`. Nagłówek `## Acceptance criteria`
też jest kształtem: `criteria.mjs` ma go zaszytego po angielsku
(`CRITERIA_HEADING`) właśnie dlatego, że to FORMAT, a nie słownictwo projektu.
Prozą — i po polsku — są `## Cel`, `## Kontekst`, `## Kroki` i teksty adnotacji.

**Zmierzony rozjazd (2026-09-01):**

| czego brakuje w `backlog/_template.md` | koszt |
|---|---|
| `confidence:` | 106 ze 120 tasków ma to pole — dopisywane RĘCZNIE, bo szablon go nie daje |
| `id:` przy wpisie `verification:` | bez niego kryterium nie ma na co wskazać; `check --criteria` melduje 62 z 63 otwartych tasków bez linku |
| akapit uczący `[proof: <id>]` | narzędzie odhacza kryterium po zielonym przebiegu, a szablon o tym nie mówi |
| `## Pre-flight reading` | 89 ze 121 tasków ma tę sekcję, po angielsku — konwencja istnieje, tylko nie w szablonie |
| ramka nagłówkowa z frontmattera | mówi, skąd biorą się słowniki (`config.yaml`), a nie z szablonu |

Osobno: `id: BL-NNN` w `backlog/_template.md` niesie prefiks sprzed migracji
TL-111, a `task_id_prefix` w `config.yaml` to `TL`. Nie psuje to `new`, bo
`createTask` i tak podmienia całą linię `^id:`, ale placeholder KŁAMIE
człowiekowi, który otworzy plik.

**Dlaczego to zostało zauważone.** TL-120 usuwał `## Log` z tego samego pliku
i przy okazji okazało się, że plik jest stary także pod innymi względami.
TL-120 świadomie tego nie tknął — to inny defekt niż ten, który tam naprawiano.

**Czego ten task NIE robi.** `scripts/migrate-prefix.mjs` w ogóle nie dotyka
`_template.md` — grep po `TEMPLATE`/`_template` w tym pliku nie daje trafień.
Czyli KAŻDE repozytorium, które zmieni prefiks, zostanie z placeholderem na
starym; tutaj poprawimy skutek, nie przyczynę. To defekt narzędzia, nie danych,
i należy do osobnego taska.

**Sąsiedni task, który to NIE jest.** TL-69 dotyczy tego samego pliku
z drugiej strony: tam chodzi o WARTOŚCI przemycane z szablonu po zmianie
słowników w cudzym repozytorium, tu o KSZTAŁT szablonu w tym repozytorium.
Nie blokują się wzajemnie i nie należy ich łączyć.

**Czego NIE wolno zrobić.** Nie tłumacz `backlog/_template.md` na angielski —
CLAUDE.md mówi wprost, że `backlog/` jest po polsku i że guard go nie czyta.
Nie ruszaj istniejących tasków: braki `confidence:` w czternastu z nich to nie
jest sprzątanie do tego taska.

## Pre-flight reading

1. `_template.md` — wzorzec kształtu; stąd ma pochodzić lista pól w teście.
2. `backlog/_template.md` — plik do wyrównania.
3. `scripts/criteria.mjs:55-70` — `CRITERIA_HEADING` i `PROOF_ID`; dowód, że
   nagłówek kryteriów jest formatem, a nie słownictwem.
4. `scripts/task-fields.mjs:185-215` — lista pól i ich rodzaje, w tym
   `confidence` (`allowEmpty: true`, dlatego brak nie oblewa builda i rozjazd
   mógł żyć niezauważony).
5. `scripts/tests/_repo.mjs` — stąd bierze się katalog backlogu.
6. `scripts/tests/change-reason.test.mjs` (ogon, TL-120) — wzór strażnika
   porównującego oba szablony i kontrola pozytywna.
7. `CLAUDE.md`, „Zanim zmienisz kod" — reguła kształt/wartości i granica języka.

## Kroki

1. Dopisz do `backlog/_template.md` brakujące pole `confidence:` w tej samej
   pozycji co w szablonie wysyłkowym (po `estimate:`).
2. Rozbuduj wpis `verification:` o `id:`, tak jak w wysyłkowym, i dopisz do
   sekcji kryteriów akapit o `[proof: <id>]` oraz przykładowe kryterium
   z linkiem. Nagłówek `## Acceptance criteria` zostaje po angielsku.
3. Dodaj sekcję `## Pre-flight reading` — po angielsku, bo taką nazwę noszą
   89 istniejące taski, a zmiana nazwy rozjechałaby je z szablonem.
4. Popraw `id: BL-NNN` na prefiks z `config.yaml`.
5. Nowy plik `scripts/tests/template-shape.test.mjs`: klucze frontmattera
   `backlog/_template.md` mają być równe kluczom wysyłkowego — listę WYLICZ
   z pliku wysyłkowego, nie wpisuj. Ścieżki bierz z `_repo.mjs`; w układzie
   ko-lokowanym oba wskazują ten sam plik i test ma wtedy przejść trywialnie,
   a nie porównywać plik ze sobą i udawać dowód — powiedz to w kodzie.
6. Dołóż w tym samym teście: wpis `verification:` niesie `id:`, sekcja kryteriów
   zawiera `[proof: …]` pasujące do `PROOF_ID`, a prefiks w `id:` zgadza się
   z `task_id_prefix` z `config.yaml`.
7. Dołóż kontrolę pozytywną: usuń pole w kopii w piaskownicy i sprawdź, że ten
   sam test to WIDZI. Bez tego zielony wynik nie ma mocy dowodowej.
8. Sprawdź `node scripts/cli.mjs check` — liczba tasków bez linku
   `criterion→verification` nie ma wzrosnąć.

## Acceptance criteria

- [ ] Klucze frontmattera obu szablonów są identyczne, a lista jest wyliczona z wysyłkowego. [proof: shape-parity]
- [ ] Wpis `verification:` w szablonie repo niesie `id:`, a kryteria uczą `[proof: <id>]`. [proof: shape-parity]
- [ ] Placeholder `id:` niesie prefiks z `config.yaml`, nie sprzed migracji. [proof: shape-parity]
- [ ] Strażnik OBLEWA po usunięciu pola z kopii — kontrola pozytywna. [proof: shape-parity]
- [ ] Proza w `backlog/_template.md` pozostaje po polsku. [proof: suite-green]
- [ ] Pełny pakiet testów jest zielony. [proof: suite-green]
