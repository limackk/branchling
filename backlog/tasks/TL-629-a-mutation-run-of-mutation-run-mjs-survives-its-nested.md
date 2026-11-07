---
id: TL-629
title: The nested Stryker test works inside a mutation run
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-07
updated: 2026-11-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: nested-stryker-runs
    bash: "node scripts/mutation-run.mjs --files scripts/mutation-run.mjs --concurrency 2"
---

## Goal

A mutation run of scripts/mutation-run.mjs completes with scripts/tests/mutation/subprocess-kill.test.mjs among the consulted tests, and its cost is measured and recorded.

## Context

Since TL-591, selectTests() in scripts/mutation-run.mjs also reads the subdirectories of scripts/tests/, so scripts/tests/mutation/subprocess-kill.test.mjs is selected whenever scripts/mutation-run.mjs or a module it imports (scripts/ui.mjs) changes. That test starts Stryker itself. Every mutant of those modules therefore runs a nested Stryker inside the outer Stryker sandbox. Nobody has measured that: the TL-591 mutation run was narrowed with --tests scripts/tests/mutation-run.test.mjs, so it is unknown whether the nested Stryker is found inside the sandbox (node_modules resolution from the sandbox copy), whether the nested run's own temporary directories collide with the outer one, and how long a full run takes. If the nested run fails, every mutant there is reported Killed for the wrong reason, a false score in the opposite direction to the one TL-576 and TL-591 fixed.

Done means: a full `node scripts/mutation-run.mjs --files scripts/mutation-run.mjs` (no --tests) was run after `npm install`. Its wall time and per-mutant time are recorded in this task. It was confirmed that subprocess-kill.test.mjs kills mutants because of an assertion, not because the nested Stryker failed to start. If it cannot work inside the sandbox, the selection or the test is changed so that it does, or the run refuses to report such mutants as Killed.

## Steps

1. Run `npm install`, then `node scripts/mutation-run.mjs --files scripts/mutation-run.mjs --plan` and confirm subprocess-kill.test.mjs is selected
2. Run the same command without --plan and record wall time, mutant count and per-mutant cost
3. For a sample of Killed mutants, confirm that an assertion in subprocess-kill.test.mjs failed rather than the nested Stryker failing to start
4. If the nested run is broken or prohibitively slow, fix the selection or the test and say why in the commit

## Acceptance criteria

- [ ] A mutation run of mutation-run.mjs that consults subprocess-kill.test.mjs completes inside the Stryker sandbox [proof: nested-stryker-runs]
