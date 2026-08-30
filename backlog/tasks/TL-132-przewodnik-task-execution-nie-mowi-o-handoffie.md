---
id: TL-132
title: "Przewodnik task-execution nie mówi o handoffie"
type: task
labels: []
board: main
epic: "Wyróżniki agentowe"
priority: P2
status: pending
owner: unassigned
estimate: 2h
confidence: medium
created: 2026-09-01
updated: 2026-09-01
blocked_by: [TL-99]
blocks: []
related_docs: []
verification:
  - id: guides-render
    bash: "node --test scripts/tests/instructions.test.mjs"
---

## Cel

`worktrail instructions task-execution` wylicza w sekcji „WHILE YOU WORK", co
zrobić, gdy zakres rośnie i gdy trafi się na blokadę — ale nie mówi, co zrobić,
gdy decyzja jest POZA MANDATEM wykonawcy. Od TL-99 istnieje na to komenda
(`worktrail handoff`), a przewodnik jej nie zna, więc żadna sesja jej nie użyje:
przewodnik jest jedynym miejscem, z którego agent uczy się procedury.

Po zrobieniu: przewodnik wymienia handoff jako trzecią odpowiedź obok „nowy
task" i „blocked".

## Kontekst

Powstało przy TL-99, świadomie zostawione poza tamtym zakresem, bo wymaga
osobnej decyzji projektowej: **role są opcjonalne**. W backlogu bez `roles:`
w `config.yaml` (jak ten) `handoff --to-role` z definicji oblewa, więc wiersz
wypisany bezwarunkowo uczyłby komendy, której w tym projekcie nie da się
wywołać — dokładnie ta klasa, co obiecywanie flagi, której nie ma.

Przewodniki są renderowane słownictwem PROJEKTU (`scripts/instructions.mjs`,
`vocabulary()` + `render()`), a mechanizm podstawiania nie ma dziś warunków:
`render()` zna tylko `{{klucz}}` i RZUCA na nieznanym. Trzeba więc rozstrzygnąć
jedno:

- albo tekst jest bezwarunkowy i sformułowany tak, żeby był prawdziwy również
  bez ról (np. mówi o `handoff --to-owner`, które działa zawsze),
- albo `instructions.mjs` dostaje sekcje warunkowe — a to zmiana mechanizmu,
  nie tekstu, i wtedy potrzebuje własnego testu obu gałęzi.

Rekomendacja: zacząć od pierwszego wariantu. Sekcje warunkowe to nowa
maszyneria dla jednego akapitu.

## Kroki

1. Dopisać wiersz do „WHILE YOU WORK" w `TASK_EXECUTION` w
   `scripts/instructions.mjs`.
2. Jeśli tekst ma wymieniać role — dołożyć placeholder do `vocabulary()`
   i test renderowania dla backlogu BEZ `roles:` i z nimi.
3. Sprawdzić, czy `overview` nie wymaga zdania o tym samym.

## Acceptance criteria

- [ ] `instructions task-execution` wymienia handoff jako odpowiedź na „decyzja poza mandatem". [proof: guides-render]
- [ ] Tekst jest prawdziwy w backlogu BEZ `roles:` — nic nie obiecuje, czego tam nie ma. [proof: guides-render]
- [ ] Każdy topic nadal renderuje się bez nieznanego placeholdera. [proof: guides-render]
