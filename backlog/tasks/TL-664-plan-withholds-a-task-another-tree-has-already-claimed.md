---
id: TL-664
title: "plan withholds a task another tree has already claimed"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P1                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-2
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 3h
confidence: medium                 # how much you trust the estimate
created: 2026-11-08
updated: 2026-11-11
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: plan-claimed-elsewhere
    bash: "node --test scripts/tests/plan-claimed-elsewhere.test.mjs"
---

## Goal

`branchling plan` leaves out of next up, and names as withheld, a task that another branch or worktree of this clone has already moved on (claimed, closed, blocked), exactly as `next` and `run` skip it, so `plan` and `run --dry-run --plan` agree about a wave whose open tasks are claimed in other trees.

## Context

TL-645 made `planState` in scripts/plan.mjs mark each open task with `unattendedHold` (awaiting a vouch, a protected status, a fresh or parked claim, person-only, over-size), drop the non-startable holds from next up, and name them under the active wave; `projectionWall` names the same holds where `run --dry-run --plan` stops. It reads only the record in THIS tree. The dispatcher also skips a task whose `elsewhere` observations (scripts/next-task.mjs `heldElsewhere`, attached by `readDispatchRecords` from `crossBranchState`) report a status it would not hand out: a task pending here but in_progress on another worktree's branch. Observed on 2026-11-08 with four loops running: `plan` in one loop worktree listed six tasks of wave 8 as next up, while `run --dry-run --plan` in the same tree said "7 of 7 open task(s) in it are not this run's to take", because the others were claimed in sibling worktrees (and one was held by a conflict group). scripts/plan-report.mjs attaches `history` to every task but not `elsewhere`, so `plan` cannot see those claims. A conflict-group hold depends on what is in progress anywhere and is arguably also `next`'s to name; deciding whether `plan` reports it is part of this task.

## Steps

1. In scripts/plan-report.mjs, attach `elsewhere` the way `readDispatchRecords` does (same module, same scan), and teach `unattendedHold` a `claimed-elsewhere` kind (not startable) naming the tree and status reported, with a `describeHold` sentence.
2. Decide whether a conflict-group hold belongs in `plan` too; implement it or state in the commit why not.
3. Test with a fixture clone holding two worktrees: a task claimed in the second is withheld in the first's `plan`, with the reason, and `plan` agrees with `run --dry-run --plan` about where the projection stops; a positive control with no claim elsewhere lists it as next up.

## Acceptance criteria

- [x] plan withholds and names a task another tree has claimed, as next and run skip it [proof: plan-claimed-elsewhere]
