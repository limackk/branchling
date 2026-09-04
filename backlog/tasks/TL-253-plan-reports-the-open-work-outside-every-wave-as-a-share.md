---
id: TL-253
title: "plan reports the open work outside every wave as a share, not a list of ids"
type: task
labels: []
board: main
epic: "Harness"
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-09-04
updated: 2026-09-04
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: plan-coverage
    bash: "node --test scripts/tests/plan-coverage.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"

---

## Goal

`branchling plan` opens its `unplanned` section with the share — `36 of 49
open tasks (73%) are outside every wave` — and `--json` carries the numbers, so
a plan that schedules a minority of the work is read as the debt it is rather
than as a long list of ids nobody finishes reading.

## Context

On 2026-09-04 `plan` lists 13 open tasks across waves 8–13 and then prints
`unplanned open tasks: 36` followed by three wrapped lines of ids. The
dispatcher taught to follow the plan (wave 5) therefore governs about a quarter
of the open work; the rest is handed out by `next`'s default order, which the
plan neither sees nor mentions. `wrapIds()` in `scripts/plan-report.mjs`
already carries a comment saying the ids at the end of the list "are the
point" — but a reader cannot tell from 36 ids whether the plan is nearly
complete or nearly empty.

This is a REPORTING change. Whether those 36 belong in a wave is a planning
decision taken task by task, not by this task. TL-219 is adjacent (what
`skippedUnplanned` counts in `run`) and stays separate: it is about the loop's
count, this is about the plan's report.

Rejected: a threshold that fails `check --plan`. How much unplanned work is
acceptable depends on the project — the third law says that value would belong
in `config.yaml`, and nobody has asked for it yet.

## Pre-flight reading

1. `scripts/plan-report.mjs` — `renderPlan()`, the `unplanned` section and
   `wrapIds()`
2. `scripts/plan.mjs` — where `state.unplanned` is computed and what counts as
   open
3. `scripts/tests/plan-report.test.mjs` — the existing assertions on the text

## Steps

1. Compute `open`, `planned`, `unplanned` counts in the state, not in the
   renderer.
2. The section heading becomes `unplanned open tasks: 36 of 49 (73%)`; the id
   list stays beneath it. With zero unplanned the line reads `none` as today.
3. `--json`: `coverage: {open, planned, unplanned, share}`.
4. Test with a fixture where the numbers are not round, and one with no
   unplanned tasks.

## Acceptance criteria

- [ ] The text heading carries count, total and percentage.
      [proof: plan-coverage]
- [ ] `plan --json` carries `coverage` with the four fields.
      [proof: plan-coverage]
- [ ] A plan with no unplanned tasks still prints the section, as `none`.
      [proof: plan-coverage]

## Decisions

Nothing decided.
