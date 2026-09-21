---
id: TL-420
title: "A blocker inside one wave is only a warning when the wave's order already settles it"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2                       # P0 blocker | P1 critical | P2 nice | P3 backlog
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
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

`validatePlan` warns about every blocker that sits inside the same wave as the
task it blocks. Since TL-257 the wave's order BINDS the dispatcher, so that
warning is wrong in the case the order already settles: a blocker listed BEFORE
its dependent in the same wave is now provably handed out first, and warning
about it trains the reader to ignore the line.

## Context

`scripts/plan.mjs`, in `validatePlan` (the branch that pushes
`"... share wave ... — fine if the wave is meant to be worked in sequence, wrong
if it is meant to be worked in parallel"`). That wording, and the severity split
documented above it, were written while a wave was a batch whose member order
carried no claim. TL-257 decided the opposite — the record is the `__decision__`
event in `backlog/history/TL-257.jsonl` — and `selectCandidates` now ranks a
wave's candidates by their position in it.

What the warning should become is the work of this task, not a decision made
here in advance. Two readings are open: the blocker BEFORE its dependent is
silent and only the reverse order warns (or errors, since a wave that lists a
dependent before its blocker is now as unexecutable as the cross-wave case that
is already an error); or the line stays and only its wording changes, because a
`together` group has no internal order and the guard cannot see which members
are meant to run as one act.

## Steps

1. Decide which of the two readings holds, with `branchling decide`.
2. Change the check accordingly, and the prose above it — it still says a wave
   is a batch.
3. A fixture for both orders inside one wave: the guard must distinguish them,
   and the case that stays silent needs a positive control beside it.

## Acceptance criteria

- [ ] A blocker listed before its dependent in the same wave does not produce a
      warning, and the reverse order still reports something, proven by a test
      that fails against today's code. [proof: suite-green]
