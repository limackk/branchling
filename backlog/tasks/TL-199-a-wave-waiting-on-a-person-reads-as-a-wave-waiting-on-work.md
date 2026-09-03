---
id: TL-199
title: "A wave waiting on a person reads as a wave waiting on work"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-09-03
updated: 2026-09-03
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
  - id: guards-green
    bash: "node scripts/cli.mjs check"
  - id: waits-on-a-person
    bash: "node --test scripts/tests/plan-executor.test.mjs"
---

## Goal

`branchling plan` says which of the tasks it lists an unattended run can
never take. Today it lists them as equals, so a wave that has stopped because
it is waiting for a PERSON is indistinguishable from one that is waiting for
work.

## Context

Measured on 2026-09-03, on this repository's own plan. Wave 2 prints:

    next up (wave 2 — The run can be watched while it happens):
      TL-188
      TL-122
      TL-189

TL-122 carries `executor: human`, because its contract has a `manual:` entry
and no unattended session can vouch for one. A fleet pointed at this plan will
close TL-188 and TL-189, ask again, be told there is nothing to take, and
leave the wave open — correctly, and in silence. `run` does print a
`waiting for an executor this run is not` block, but that is the RUN's report:
it is gone when the run is, and a person reading `plan` a day later sees three
identical rows and no reason for the stall.

**Why the plan is the right place and the run is not.** The run already says
what IT could not take. The plan is the document somebody opens to ask "where
has this got to", and a stall it cannot explain is exactly the rot the
`unplanned` list was added to expose. The same argument, one level up.

**What must be shown.** Beside each `next up` entry, whether it asks for an
executor an unattended run is not; and, per wave, whether the wave can be
finished by a fleet at all or ends on a person. `--json` carries the same
fields — a dispatcher deciding whether to keep polling needs the second one.

**What must NOT happen.** The plan must not start refusing, reordering, or
hiding those tasks. `executor:` is a filter the dispatcher applies; the plan
reports the order somebody decided, and a task waiting on a person is still
part of that order. This is a sentence added to a report, not a rule added to
the plan.

## Pre-flight reading

1. `scripts/plan.mjs` — `validatePlan()` and what the five definitions
   (`active wave`, `next up`, `in progress`, `unplanned`, `stale`) already
   compute; this adds a field, not a definition.
2. `scripts/next-task.mjs:164` and the `skippedExecutor` reporting around
   line 572 — the vocabulary already used for this, which must be reused
   rather than reinvented.
3. `docs/manual.md` §the plan — the five definitions as documented for a
   reader.

## Steps

1. Read `executor:` alongside status when the plan view is assembled.
2. Mark the affected `next up` rows, and say per wave whether it ends on a
   person.
3. The same in `--json`.
4. `scripts/tests/plan-executor.test.mjs` over a fixture whose wave holds one
   `executor: human` task, asserting both the human-readable mark and the JSON
   field — and asserting that the row is still listed, in the same order.

## Decisions

Nothing decided. Open: whether `executor: agent` deserves the same treatment
for a HUMAN reader of the plan; the symmetric case is real but nobody has
asked for it.
