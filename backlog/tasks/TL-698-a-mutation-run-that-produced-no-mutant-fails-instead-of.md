---
id: TL-698
title: "A mutation run that produced no mutant fails instead of passing"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-3
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-10
updated: 2026-11-12
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: mutation-zero-mutants
    bash: "node --test scripts/tests/mutation-run.test.mjs"
---

## Goal

`mutation-run.mjs` exits non-zero, naming the mutated line ranges, when Stryker ran but produced zero mutants.

## Context

scripts/mutation-run.mjs refuses `nothing to mutate` only before Stryker starts (around line 613, when the change added no line). When the selected lines hold no mutable code — comments, CSS inside a template literal — Stryker runs, reports `All files | n/a` and the script exits 0: the score over an empty set its own header (around line 29) says must fail. Seen twice on 2026-11-10 with `--named-only --changed-lines`: TL-656 (`scripts/field-write.mjs:136-138`, done in 4 seconds, 0 mutants) and TL-652 (`scripts/build-viewer.mjs:1088-1095`, `All tests (covered 0)`, exit 0). Both supervisors could have read a green run as evidence.

## Steps

1. In main(), after summarise(run.report), fail with exit 1 when the report holds no mutant, naming the line ranges and saying that a change with no mutable code has no mutation evidence
2. Make --plan say the same when it can tell beforehand
3. Test with a fixture whose changed lines are only a comment

## Acceptance criteria

- [x] a run with zero mutants exits non-zero naming the ranges [proof: mutation-zero-mutants]
