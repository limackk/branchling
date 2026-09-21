---
id: TL-397
title: "The plan guard outlived the plan it froze"
type: task
labels: []
board: main
epic: "branchling"
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
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
verification:                      # HOW to check the task is really done
  - id: plan-guard
    bash: "node --test scripts/tests/product-boundary-plan.test.mjs"
  - id: suite
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

`node --test scripts/tests/product-boundary-plan.test.mjs` is green against
whatever `backlog/plan.yaml` currently holds, and stays green the next time the
plan is rewritten — while still FAILING if the plan schedules a cancelled task
or reopens a managed-fleet wave.

## Context

`scripts/tests/product-boundary-plan.test.mjs` has two tests. The first one —
the reviewed cancellation set is cancelled, with a non-reserved reason in
`backlog/history/` — is about facts that never change again and is not in
question here.

The second one carried two different things in one body. The enduring half is
an invariant: no cancelled task is scheduled, and managed fleets have no wave.
The stale half was a frozen membership list — `TL-378`..`TL-383` each scheduled
and each before `TL-384` — which described the PREVIOUS execution plan. That
plan closed completely on 2026-09-21 and `backlog/plan.yaml` was rewritten;
the file's own header says so and explains why the closed waves were not
repeated. From that rewrite on, the guard asserted that a finished plan is
still scheduled, so it failed with "TL-378 is scheduled in the reduction plan"
in the main checkout at b96c1e8 — and every task whose verification entry is
`node --test scripts/tests/*.test.mjs` inherited a red suite that was not its
own.

Freezing the membership of ONE plan is what cannot survive the next rewrite,
and the plan is data that is expected to be rewritten. The assertion therefore
has to be made against whatever the file currently holds: the plan parses,
`validatePlan` reports no errors (existence of every scheduled id and no
duplicate scheduling are already ITS rules, not this guard's), no scheduled id
is cancelled, and no wave names managed fleets. "No scheduled id is DONE" is
deliberately not asserted: a plan legitimately keeps naming work while that
work is being finished, so it would be the same staleness one step later.

A guard written against live data can pass because the data happens to be
empty or clean, so it needs a positive control: the same check run over a
synthetic plan that schedules a cancelled id must report exactly that.

## Pre-flight reading

1. `scripts/tests/product-boundary-plan.test.mjs` — the guard, both halves
2. `backlog/plan.yaml` — the current plan and its header about the closed one
3. `scripts/plan.mjs` — `parsePlanYaml` and `validatePlan`, whose rules this
   guard must not re-implement

## Steps

1. Replace the frozen wave-membership assertion with the invariant stated
   above, evaluated against the plan on disk.
2. Add a positive control that runs the same check over a synthetic plan
   scheduling a cancelled id, and asserts it is reported.
3. Run the file, then the whole suite.

## Acceptance criteria

- [x] The guard file passes against the current `backlog/plan.yaml` and names
      no task id of any single plan. [proof: plan-guard]
- [x] A synthetic plan scheduling a cancelled task is reported by the same
      check, inside the test file. [proof: plan-guard]
- [x] The whole suite is green. [proof: suite]
