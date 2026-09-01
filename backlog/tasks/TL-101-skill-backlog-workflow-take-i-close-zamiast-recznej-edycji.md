---
id: TL-101
title: "Skill backlog-workflow: take i close zamiast recznej edycji"
type: task
labels: []
board: main
epic: "Wyróżniki agentowe"
priority: P2
status: pending
owner: unassigned
estimate: 2h
confidence: high
created: 2026-08-31
updated: 2026-08-31
blocked_by: [TL-87, TL-93]
blocks: []
related_docs: []
verification:
  - id: guides-say-primitives
    bash: "node --test scripts/tests/instructions.test.mjs"
  - id: skill-points-at-the-guide
    bash: "grep -q 'worktrail instructions overview' .claude/skills/backlog-workflow/SKILL.md"
---

## Cel

Przewodniki, które agent czyta przed pracą i przed zamknięciem taska, KAŻĄ mu
używać prymitywów (`take`, `done`) i opisują ręczną edycję pól jako drogę
zapasową — i jest to pilnowane testem, a nie tylko prawdą w dniu, w którym
ktoś to napisał.

Tryb bezpośredni („zrób TL-1234" powiedziane głównemu agentowi w Claude Code
/ Codex) dostaje w ten sposób lock, atrybucję i fokus sesji za darmo — mniej
kroków dla agenta, lepsze ślady dla człowieka.

## Kontekst

Task przepisany 2026-09-01 przy rozstrzygnięciu TL-139; poprzedni zakres
(przepisanie sekcji „Work a task" i „Close a task" w
`.claude/skills/backlog-workflow/SKILL.md`) jest NIEAKTUALNY, bo tych sekcji
już nie ma. Skill świadomie nie niesie żadnej procedury ani słownictwa i
odsyła do `worktrail instructions overview`; powód stoi w jego własnym ciele —
kopia procedury w pliku skilla zamarza w dniu, w którym powstała, i myli się
wtedy najgorszym możliwym sposobem: nadal konkretnie i pewnie.

Treść, której chciał pierwotny TL-101, JEST już dowieziona — tylko gdzie
indziej. `instructions task-execution` mówi wprost „Do not edit the status by
hand to claim it" i podaje `next`/`take`; `instructions task-finalization`
mówi „ONE COMMAND CLOSES A TASK" i zakazuje robienia tych kroków ręcznie;
oba wskazują `worktrail history --source manual` jako drogę dla zmian zrobionych
ręcznie. Nie ma więc pracy do wykonania w prozie — brakuje DOWODU, że tak
zostanie.

Bo nic tego nie pilnuje. `scripts/tests/instructions.test.mjs` sprawdza
routing z `overview`, podstawienie słownictwa i to, że nieznany placeholder
wywala się zamiast trafić do terminala — ale ani jednej asercji, że przewodniki
w ogóle każą używać `take`/`done` zamiast edycji pól. Zdanie, na którym stoi
cały tryb bezpośredni, można dziś usunąć jednym commitem i suita zostanie
zielona.

Granica: to jest strażnik nad TEZĄ przewodnika, nie nad jego brzmieniem.
Asercja na całe zdanie zmusiłaby do poprawiania testu przy każdej redakcji
stylu, więc byłaby pierwszą rzeczą, którą ktoś rozluźni.

## Pre-flight reading

- `scripts/instructions.mjs` — tematy `task-execution` i `task-finalization`;
  tam stoją zdania, które ten task obejmuje strażnikiem.
- `scripts/tests/instructions.test.mjs` — czego suita już dowodzi i w jakiej
  konwencji (kontrola pozytywna przy każdym twierdzeniu).
- `.claude/skills/backlog-workflow/SKILL.md` — dlaczego skill NIE niesie
  procedury; kontrakt na ten plik mierzy wyłącznie wskaźnik.

## Kroki

1. W `instructions.test.mjs`: asercja, że `task-execution` niesie zakaz ręcznej
   zmiany statusu i podaje `take`/`next`, a `task-finalization` — że zamyka
   jedna komenda uruchamiająca kontrakt. Nazwy komend brać z `PRODUCT_NAME`
   i z tabeli komend, nie z literałów.
2. Kontrola pozytywna: asercja ma OBLEWAĆ, gdy zdanie zniknie z szablonu —
   test, który przechodzi na pustym tekście, jest zielony bez mocy dowodowej.
3. Sprawdzić, czy przewodniki opisują ręczną edycję jako drogę zapasową
   (`history --source manual`); jeśli nie — dopisać jedno zdanie, nie wykład.

## Acceptance criteria

- [ ] `task-execution` każe wziąć task komendą i zabrania ręcznej zmiany statusu; strażnik oblewa, gdy to zdanie zniknie. [proof: guides-say-primitives]
- [ ] `task-finalization` mówi, że zamyka jedna komenda uruchamiająca `verification:`. [proof: guides-say-primitives]
- [ ] Skill nie niesie procedury — jego kontrakt sprawdza wyłącznie, że odsyła do przewodnika. [proof: skill-points-at-the-guide]
- [ ] Żaden wpis `verification:` nie wymaga wpisania procedury z powrotem do `.claude/skills/`. [proof: skill-points-at-the-guide]

## Log

Append-only. Format: `YYYY-MM-DD status — kto — notatka`.

- 2026-08-31 blocked — agent:claude — task założony z decyzji o trybie
  bezpośrednim; czeka na take (TL-87) i close (TL-93).
