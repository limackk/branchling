---
id: TL-126
title: "README opisuje sekcję ## Log, której szablon nie ma od TL-105"
type: task
labels: []
board: main
epic: ""
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
estimate: 30m
created: 2026-09-01
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs: []
verification:                      # JAK sprawdzić, że task naprawdę jest zrobiony
  - id: no-log-section
    bash: "! grep -n 'append-only log' README.md"
  - id: sections-match-template
    manual: "each body section README names is a heading present in _template.md"
---

## Cel

`README.md` przestaje opisywać sekcję `## Log` w pliku taska. Po zmianie opis
ciała taska w README zgadza się z tym, co naprawdę jest w `_template.md` i co
pisze `worktrail done`, a „dlaczego" wskazuje na pole `reason` rekordu
w `backlog/history/`.

## Kontekst

TL-105 usunął `## Log` z szablonu i z drogi zapisu: powód zmiany jedzie
z ZAPISEM, nie z prozą w pliku. README tego nie zauważył. Linia 175
(sekcja `## The task file`) nadal wymienia wśród sekcji ciała
„an append-only log of the form `YYYY-MM-DD status — kto — notatka`".

To nie jest kosmetyka. README jest PUBLICZNĄ powierzchnią i pierwszym, co czyta
obcy użytkownik: opisuje sekcję, której `worktrail new` nigdy nie utworzy, więc
uczy ręcznego prowadzenia dziennika obok mechanizmu, który powstał żeby go
zastąpić. Stare taski z `## Log` zostają — to zdania, których nikt nie odtworzy
— ale README nie ma tego zalecać nowym.

Znalezione przy okazji TL-94 (`worktrail seed`), który generuje ciało taska
i celowo nie pisze `## Log`.

## Pre-flight reading

1. `README.md` — sekcja `## The task file`, akapit pod blokiem YAML (ok. linia
   171-179): lista sekcji ciała.
2. `_template.md` — co szablon NAPRAWDĘ zawiera; to jest źródło prawdy dla tego
   akapitu.
3. `CLAUDE.md` — akapit „Powód zmiany jedzie z ZAPISEM, nie z prozą w pliku
   (TL-105)".

## Kroki

1. Popraw akapit w README tak, żeby wymieniał sekcje, które szablon ma,
   i nie wymieniał `## Log`.
2. Dopisz jedno zdanie mówiące, gdzie jest „dlaczego": pole `reason` rekordu
   w `history/`, i że `reason_required_statuses` decyduje, kiedy jest wymagane.
3. Sprawdź, czy ten sam nieistniejący dziennik nie jest opisany gdzie indziej
   w README ani w `scripts/instructions.mjs`.

## Acceptance criteria

- [ ] README nie opisuje `## Log` jako części pliku taska. [proof: no-log-section]
- [ ] Każda sekcja ciała, którą README wymienia, jest nagłówkiem w `_template.md`. [proof: sections-match-template]
