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
  - bash: "grep -q 'worktrail take' .claude/skills/backlog-workflow/SKILL.md"
  - bash: "grep -q 'worktrail close' .claude/skills/backlog-workflow/SKILL.md"
---

## Cel

Skill `backlog-workflow` (instrukcja dla agentów pracujących z backlogiem)
przechodzi z ręcznej edycji frontmattera na nowe prymitywy:

- „Take it" = `worktrail take <ID> --actor agent:<nazwa>` zamiast trzech
  ręcznych zmian pól + `build`;
- „Close a task" = `worktrail close <ID>` zamiast ręcznego uruchamiania
  wpisów `verification:` i ustawiania `done`.

Tryb bezpośredni („zrób TL-1234" powiedziane głównemu agentowi w Claude Code
/ Codex) dostaje w ten sposób lock, atrybucję i fokus sesji za darmo — mniej
kroków dla agenta, lepsze ślady dla człowieka.

## Kontekst

Powstało z decyzji 2026-08-31 o zachowaniu dzisiejszego trybu pracy przy
wprowadzaniu ról: rola bramkuje dyspozytor (TL-98), a tryb bezpośredni
używa `take` (TL-87) i `close` (TL-93) bez sprawdzania ról.

Skill jest instrukcją, nie kodem — ale jest częścią produktu (jedzie do
konsumentów) i rozjazd między nim a CLI to klasa „ta sama decyzja w dwóch
miejscach". Stąd task, a nie poprawka przy okazji: zmiana ma przejść razem
z dowiezieniem obu komend, nie przed nimi.

Zakres:
- sekcje „Work a task" i „Close a task" w skillu: prymityw zamiast listy
  ręcznych kroków; ręczna edycja pól zostaje opisana jako droga zapasowa
  (działa zawsze — to sens architektury), z notą, że traci lock i fokus;
- wzmianka o `handoff` (TL-99), jeśli jest już dowieziony — jednym
  akapitem, bez wykładu o rolach;
- bez zmian w sekcjach query/new/check.

## Kroki

1. Zaktualizować `.claude/skills/backlog-workflow/SKILL.md` po dowiezieniu
   TL-87 i TL-93: kroki take/close, ręczna edycja jako fallback.
2. Przejrzeć przykłady komend w skillu pod kątem spójności z faktycznym
   `--help` obu komend (nazwy flag, kody wyjścia).
3. Jeśli repo konsumenta ma własną kopię skilla — odnotować w tasku
   konsumenta, nie kopiować ręcznie stamtąd.

## Acceptance criteria

- [ ] Skill nie instruuje ręcznej edycji statusu jako drogi pierwszej;
      `take`/`close` są krokami głównymi, edycja fallbackiem.
- [ ] Każda komenda cytowana w skillu istnieje i ma dokładnie te flagi
      (sprawdzone ręcznie wobec `--help`).
- [ ] Weryfikacje grep z frontmattera przechodzą.

## Log

Append-only. Format: `YYYY-MM-DD status — kto — notatka`.

- 2026-08-31 blocked — agent:claude — task założony z decyzji o trybie
  bezpośrednim; czeka na take (TL-87) i close (TL-93).
