---
id: TL-417
title: "run does not refuse a task that has crossed the same boundary twice"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-21
updated: 2026-09-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: the-loop-refuses
    bash: "node --test scripts/tests/pipeline-deadlock.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

`branchling run` stops handing out a task that has already crossed the same
pair of roles in both directions, and says why, instead of dispatching it a
third time.

## Context

TL-277 measured the deadlock: TL-151 crossed `spec`↔`dev` three times in eleven
hours, four agent runs, 5624 seconds, with every hand correct at every step. It
decided the substantive question (a registration table is not a proof) and made
the second crossing OBSERVABLE — `branchling audit` reports an open task handed
both ways across the same pair of roles, with the count and both hands' reasons
(`handedBackAcross` in `scripts/audit.mjs`).

What it deliberately did not do is act on that inside the dispatcher. TL-277 ran
while `scripts/run-loop.mjs` and `scripts/next-task.mjs` were held by other
branches, and a refusal is the weaker half of the answer anyway: a report
survives the run and is read by the person who has to decide, while a refusal
only stops one loop. Both are wanted; this is the second.

The shape to settle here: does `run` skip such a task and count it in its
report, or does it stop? `next` has a family of `skipped*` keys in its envelope
already, and this is a third possibility — a task that is neither takeable nor
finished. A skip that says nothing would reproduce the original defect, where
`held elsewhere` and a deadlock read the same.

## Pre-flight reading

1. `backlog/tasks/TL-277-two-hands-pass-one-task-back-and-forth-because-neither-may.md`
   — the measurement, and the decision this rests on
2. `scripts/audit.mjs` — `handedBackAcross`, the detector to reuse rather than
   reimplement: one definition of what a deadlock is
3. `scripts/tests/pipeline-deadlock.test.mjs` — what is already proved, so this
   task adds to it instead of repeating it

## Steps

1. Decide skip-and-report versus stop, and record it with `branchling decide`.
2. Reuse `handedBackAcross` in the selection path; do not write a second
   definition of the same finding.
3. Name the task, the pair of roles and both reasons wherever the run reports
   it — on the terminal and under `--json`.

## Acceptance criteria

- [ ] A task that crossed the same boundary in both directions is not handed
      out again as ordinary work, and the run's report names it as a deadlock
      rather than as held elsewhere. [proof: the-loop-refuses]
- [ ] A task handed on ONCE is dispatched exactly as before.
      [proof: suite-green]
