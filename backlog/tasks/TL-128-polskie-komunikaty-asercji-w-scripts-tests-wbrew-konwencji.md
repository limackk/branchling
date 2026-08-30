---
id: TL-128
title: "Polskie komunikaty asercji w scripts/tests/ wbrew konwencji \"cały kod po angielsku\""
type: task
labels: []
board: main
epic: "worktrail — narzędzie"
priority: P3
status: pending
owner: unassigned
estimate: 30m
confidence: high
created: 2026-09-01
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs:
  - CLAUDE.md
verification:
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Cel

Komunikaty asercji w `scripts/tests/` są po angielsku wszędzie — dziś w czterech
plikach zostały polskie. Po zrobieniu tego taska nie ma w `scripts/tests/`
polskiego tekstu poza DANYMI testu (fixture'y, tablice transliteracji, treści
tasków w tymczasowych repozytoriach), a te są oznaczone komentarzem, żeby nikt
ich nie „poprawił".

## Kontekst

CLAUDE.md mówi: „Cały kod po angielsku, bez wyjątku. Implementacja, nazwy
identyfikatorów, komentarze, docstringi, komunikaty błędów, **opisy testów**".
`worktrail check --language` tego nie łapie, bo jego granica biegnie po
KATALOGU — `PUBLIC_PATHS` w `scripts/check-public-language.mjs` to `scripts`,
`bin`, `README.md`, `_template.md`, a `scripts/tests/` jest świadomie poza
guardem (test biorący oczekiwaną nazwę z tej samej stałej co kod asertowałby
`N === N`). Więc konwencja obowiązuje, a nic jej tu nie pilnuje.

Zobaczone przy TL-97: `scripts/tests/task-fields.test.mjs` ma
`f.key + " bez etykiety"` i `f.key + " enum bez opcji"` w teście „every editable
field has a label and a known kind". Nowe asercje dopisane w tym samym teście są
po angielsku, więc plik jest dziś dwujęzyczny w jednej funkcji.

Pliki z polskim tekstem (stan 2026-09-01, `grep` po polskich słowach):
`scripts/tests/task-fields.test.mjs`, `scripts/tests/boards.test.mjs`,
`scripts/tests/history.test.mjs`, `scripts/tests/public-language.test.mjs`.

**Uwaga na trzeci z nich.** `public-language.test.mjs` testuje guard języka, więc
polski tekst jest tam prawdopodobnie DANYMI (próbka, na której guard ma pójść na
czerwono). Tłumaczenie takiej próbki rozbroiłoby test. To jest ten przypadek,
w którym trzeba przeczytać, zanim się zmieni.

## Kroki

1. Przejrzeć cztery pliki i rozdzielić: komunikat asercji / opis testu
   (do przetłumaczenia) od danych testu (zostaje).
2. Przetłumaczyć pierwszą grupę.
3. Przy każdej zostawionej polskiej linii dopisać komentarz mówiący, że to dane
   testu — inaczej następna sesja zgłosi to jako ten sam dług drugi raz.

## Acceptance criteria

- [ ] `node --test scripts/tests/*.test.mjs` zielone po zmianie. [proof: suite-green]
- [ ] W `scripts/tests/` nie ma polskiego tekstu w komunikacie asercji ani w opisie testu. [proof: suite-green]
- [ ] Każda pozostawiona polska linia ma obok komentarz mówiący, że to dane testu, a nie dług. [proof: suite-green]
