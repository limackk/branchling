---
id: TL-404
title: "the template's criterion placeholder fails the gate once verification is written"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P3
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-21
updated: 2026-09-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: check-1
    bash: "node --test scripts/tests/new-task-passes-check.test.mjs"
---

## Goal

The template's acceptance-criterion placeholder stops failing the release gate. `_template.md` ships `- [ ] Verifiable, not subjective. [proof: the-name]`, and the moment an author writes a real `verification:` block and leaves that line standing, `check --criteria` reports a hard error: "`[proof: the-name]` names no `verification:` entry".

## Context

Measured on 2026-09-21 in TL-262, which fixed the other half. TL-262 decided that the verification placeholder announces itself by its COMMAND (`command to run`, the string `done` refuses), so `auditTask` in `scripts/criteria.mjs` no longer reports it as proving no criterion. The criteria side was deliberately left alone: a dangling `[proof: ...]` is an ERROR, not a warning, and whether the template's own sentence should be exempt from it is a separate decision.

Reproduce: `branchling init --dir <d> --no-example`, `branchling new --dir <d> --title x`, replace the `verification:` block with a real entry (`- id: mine` / `bash: "true"`), keep the template's criterion line, then `branchling check --criteria --dir <d>`. The gate fails on a line the tool wrote.

The options are the mirror of TL-262's: recognise the template's criterion by its sentence, ship no criterion item at all (the guard then warns that the list is empty), or leave it and accept that half of the template must be edited before the other half is.

## Steps

1. Decide with `branchling decide` whether the template's criterion is recognisable to the guard, absent, or left as it is.
2. Implement the decision in `scripts/criteria.mjs` and `_template.md` together - the two placeholders must be consistent after TL-262.
3. Extend `scripts/tests/new-task-passes-check.test.mjs` with the mirror case: a real verification block plus the template's criterion line.

## Acceptance criteria

- [ ] A task whose verification block was written but whose criteria were not does not fail the release gate on the template's own line. [proof: check-1]
