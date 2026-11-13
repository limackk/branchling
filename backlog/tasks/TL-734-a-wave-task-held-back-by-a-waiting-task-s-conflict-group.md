---
id: TL-734
title: "a wave task held back by a waiting task's conflict group waits"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 3h
confidence: medium                 # how much you trust the estimate
created: 2026-11-13
updated: 2026-11-13
blocked_by: [TL-707]  # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: conflict-hold-waits
    bash: "node --test scripts/tests/plan-waiting-conflict.test.mjs"
---

## Goal

`next --plan` calls a wave WAITING when an open task in it is held back only by a conflict group that a waiting task of the same wave holds, so `run --plan --wait` polls it instead of ending at once.

## Context

`waveWaiting` in scripts/next-task.mjs (TL-683) accounts for each open task of the active wave as awaitingMerge, claimed, or behind (every unresolved `blocked_by` is itself waiting); any task left over makes the answer `nothing-to-take`. It does not consider the conflict-group hold `selectCandidates` applies (`unconflicted`, TL-492, reported in `skippedConflict`). So a wave [A, B] where A is in progress under another actor and B is pending in the same `conflict_group` is answered `nothing-to-take`, although B is handed out the moment A is closed and merged: waiting WOULD help. Since TL-707, `run --plan --wait` decides whether to poll from `next`'s refusal kind alone (`planWaiting` in scripts/run-loop.mjs), so this wave now ends the run at once, where before TL-707 the run polled it because `plan.open > 0`. A supervisor reading `next --plan` directly is misled the same way. The fix belongs in `waveWaiting`, not in `run`: `run` must keep reading one judgement, not re-derive it.

## Steps

1. In `waveWaiting` (scripts/next-task.mjs), treat a task as waiting when every conflict-group holder that keeps it back is itself one of the wave's waiting tasks (claimed or awaiting merge), alongside the existing `behind` pass; decide in the same pass whether such a task is reported under `waitingBehind` or a new list, and name it in `waitingIds`
2. Decide what a holder OUTSIDE the active wave means (an in-progress task in another wave or unplanned) and write the reason into the function's comment
3. Test in scripts/tests/plan-waiting-conflict.test.mjs with a fixture tree: the wave [A claimed, B same group] is `wave-claimed-elsewhere` naming B, `run --plan --wait` polls it, and a wave whose B is held back by a role stays `nothing-to-take`

## Acceptance criteria

- [ ] a wave task held back only by a waiting task's conflict group makes the wave waiting [proof: conflict-hold-waits]
