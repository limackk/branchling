---
id: TL-744
title: "the run projection's spill judges conflict-group holds as next does"
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
estimate: 1h
confidence: medium                 # how much you trust the estimate
created: 2026-11-14
updated: 2026-11-14
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: projection-judges-conflict-holds
    bash: "node --test scripts/tests/run-plan-waiting.test.mjs"
---

## Goal

The `run --plan --dry-run --spill` projection judges a wave waiting on conflict-group holds the same way the live `next --plan --spill` does, so a wave whose only free task is held back by a conflict group that waiting work holds is spilled past in the projection as it is in the live run.

## Context

`next --plan --spill` in scripts/next-task.mjs passes the active wave's `skippedConflict` (`activeConflict`) to `waveWaiting`, which counts a task held back only by a group that waiting work holds as `conflict` and so as waiting. The projection in scripts/run-loop.mjs (the TL-731 block "A WALL `next --plan --spill` WOULD DRAW PAST") calls `waveWaiting(..., config, [], [], admitted)`: its `conflictHeld` is an empty array, although the same `selectCandidates` call already destructures `skippedConflict`. Measured on 2026-11-14 while implementing TL-743: plan wave 1 [A in progress under another actor, conflict_group [g]; B pending, conflict_group [g]], wave 2 [C]. `next --plan --spill --dry-run --json` spills into wave 2 and names C; `run --plan --dry-run --spill --json` reports `spill: null` and stops at wave 1. The mutation run of TL-743 also left the `[]` literal on that line surviving, because no test distinguishes it. Deliberately left out of TL-743, whose thesis is the caller's filters (`admitted`).

## Steps

1. Reproduce the divergence above in scripts/tests/run-plan-waiting.test.mjs, asserting the live `next` answer first so the fixture is proved to be the case it claims
2. Pass the wave's `skippedConflict` from the same `selectCandidates` call into the projection's `waveWaiting`, checking that `closedByRun` (which only closes tasks) does not make the holders stale: a holder the run closes is no longer waiting
3. Add the control: when the group is held by a task outside the wave (in progress in a later wave), `next` calls the wave `nothing-to-take` and the projection must stop at wave 1 too, so the fix does not spill past every conflict hold

## Acceptance criteria

- [ ] the run projection's spill treats a wave as waiting on a conflict-group hold exactly when `next --plan --spill` does [proof: projection-judges-conflict-holds]
