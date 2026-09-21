---
id: TL-219
title: "skippedUnplanned counts open work outside the active wave, not work the plan does not schedule"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-03
updated: 2026-09-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: plan-order
    bash: "node --test scripts/tests/plan-order.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

`next --plan` says "N open task(s) the plan does not schedule — `--plan` never
hands those out", and N is not that number. It is the number of open tasks
outside the ACTIVE WAVE, so every task the plan schedules in a LATER wave is
counted as unscheduled. The sentence has to state the quantity it actually
computed, or the quantity has to become the one the sentence claims.

## Context

Measured on 2026-09-03 in this repository, while closing TL-186:

    $ branchling plan
      unplanned open tasks: 16

    $ branchling run --plan --agent "true" --actor agent:sub-b
      stopped: plan wave 2 (The run can be watched while it happens) is not
      finished — 1 of 4 task(s) in it are still open and none was free to take,
      and 34 open task(s) the plan does not schedule were left alone

16 and 34 are answers to the same question from two functions in the same tool,
one minute apart. `planState` in `scripts/plan.mjs` is right: `unplanned` is the
open tasks whose id appears in no wave at all. The 34 comes from
`selectCandidates` in `scripts/next-task.mjs`, where the counter is incremented
for every open record that is not in `filters.planIds` — and `filters.planIds`
is the active wave's ids and nothing else, exactly as its comment says. So the
count is correct for what it counts and wrong for what it is called.

**Where the two numbers diverge, precisely.** 34 = the open tasks of waves 3 to
13, plus the 16 the plan really does not schedule, minus what the species gate
removed before the plan gate ran (that gate order is deliberate and is not the
defect). A backlog whose plan has one wave shows the same number for both, which
is why the fixture in `plan-order.test.mjs` that asserts `skippedUnplanned === 1`
has been green since TL-183: one wave is exactly the case where the two
definitions coincide.

**It is now printed in two places.** TL-186 built the `run --plan` stop sentence
out of this field, and had to phrase the active-wave branch as "outside that
wave" — true, but a report that has to route around a field's name is the field
telling you it is wrong. The finished-plan branch of that sentence still says
"the plan does not schedule", and there it is accurate: with no active wave, an
open task is unscheduled by definition.

**Which way to fix it is a real choice.** Renaming the field to
`skippedOutsideWave` keeps the number and makes both messages honest, but a
consumer that has been reading the JSON since TL-183 loses a key. Making it
count the genuinely unplanned tasks matches its name and both messages, but the
"how much open work did `--plan` step over" figure — the one a fleet operator
actually wants — disappears, and it is the more useful of the two. Reporting
both is a third option and the honest one; it is also a wider JSON contract.
Decide it in Decisions, do not pick silently.

## Pre-flight reading

1. `scripts/next-task.mjs` — `selectCandidates`, the `filters.planIds` gate and
   `skippedUnplanned`; then the empty-queue `details` further down, which prints
   the sentence.
2. `scripts/plan.mjs` — `planState`, whose `unplanned` is the definition the
   `plan` command prints and the one this field's name promises.
3. `scripts/run-loop.mjs` — `planStop` (TL-186), the second reader, and the
   comment there explaining why its two branches word the clause differently.
4. `scripts/json-envelope.mjs` — the `plan` object of the `task-take` kind, if
   a key is renamed or added.

## Steps

1. Decide, and record it in Decisions, before touching a message.
2. Whichever way it goes, `branchling plan` and `next --plan` must answer the
   same number to the same question, or must visibly be answering two different
   questions.
3. A fixture with a MULTI-WAVE plan and open work in a later wave — the case
   where the two definitions disagree. The existing single-wave fixture is a
   positive control that stays green either way and proves nothing on its own.
4. If a key is renamed or added, update `planStop` in `run-loop.mjs` with it.

## Acceptance criteria

- [x] On a multi-wave fixture with open work in a later wave and open work in no
      wave at all, the number `next --plan` reports and the number `plan`
      reports are reconcilable, and each message states which of the two it
      means. [proof: plan-order]
- [x] The `run --plan` stop sentence no longer needs two different wordings for
      the same field. [proof: suite-green]
