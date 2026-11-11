---
id: TL-673
title: "A mutation run judges mutation-contain.mjs with its own mutant active"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-3
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: [mutation]  # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-09
updated: 2026-11-11
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: contain-judged
    bash: "node --test scripts/tests/mutation/no-orphan-processes.test.mjs"
---

## Goal

A mutation run of scripts/mutation-contain.mjs judges each mutant with that mutant active, or refuses to report a score for it.

## Context

scripts/mutation-contain.mjs is judged by exactly one test, scripts/tests/mutation/no-orphan-processes.test.mjs (`node scripts/mutation-run.mjs --files scripts/mutation-contain.mjs --plan`), and only through a NESTED Stryker run: the test starts the sandbox copy of scripts/mutation-run.mjs, whose CONTAIN_ENTRY is the sandbox copy of mutation-contain.mjs, which the OUTER run has instrumented. The nested Stryker's command runner then executes that outer-instrumented file with `__STRYKER_ACTIVE_MUTANT__` set to the INNER run's mutant ids, and with no id at all during the inner initial run (TL-629 removes the inherited id in runStryker(), because it broke the inner initial run). Both runs share one environment variable and one numbering, so inside the nested chain the outer mutant under test is never the active one; whichever outer mutant happens to share the inner id is. A Killed or Survived result for mutation-contain.mjs is therefore not evidence about that mutant. Found while working TL-629, which fixed the same collision for mutants of mutation-run.mjs, where the mutated code runs in the test process and is not re-executed by the inner Stryker. Options to weigh: CONTAIN_ENTRY always resolving to a file outside the sandbox (the repository's own copy, which would stop a mutation run from judging mutation-contain.mjs at all and must then say so), a test that runs mutation-contain.mjs directly rather than through a nested Stryker, or mutation-run.mjs refusing to report mutation-contain.mjs mutants judged only through a nested run.

## Steps

1. Confirm the collision: run the outer run of mutation-contain.mjs and, for a sample of mutants, check which outer mutant is active inside the contained process
2. Choose between a direct test of mutation-contain.mjs, a CONTAIN_ENTRY outside the sandbox, or a refusal, and record why in the commit
3. Add a regression test that fails while an inner mutant id selects an outer mutant of mutation-contain.mjs

## Acceptance criteria

- [x] mutation-contain.mjs is judged with the mutant under test active, not one that shares an inner run's id [proof: contain-judged]
