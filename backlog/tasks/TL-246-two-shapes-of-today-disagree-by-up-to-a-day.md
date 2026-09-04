---
id: TL-246
title: "two shapes of today disagree by up to a day"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P3
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1h
confidence: medium                 # how much you trust the estimate
created: 2026-09-04
updated: 2026-09-04
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: one-shape
    bash: "grep -rn 'function today()' scripts/*.mjs; test $(grep -rlc 'function today()' scripts/*.mjs | wc -l) -eq 0"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

One shape for "today", written in one place. Every command that stamps a date —
`created:`, `updated:` in a task, `updated:` in `plan.yaml` — writes the same
day for the same moment, whatever the machine's timezone.

## Context

There are three implementations of the same three-line function and TWO answers:

- `scripts/take-task.mjs` exports `todayStamp(now)` — `toISOString().slice(0,10)`,
  i.e. UTC. Its own comment says it is exported "because every command that
  touches `updated:` has to write the same shape".
- `scripts/done-task.mjs` has a private `today()` — also UTC, and therefore
  agreeing with the above by coincidence rather than by reuse.
- `scripts/new-task.mjs` has a private `today()` built from `getFullYear()`,
  `getMonth()` and `getDate()` — the LOCAL day.

In a timezone ahead of UTC, in the hours before midnight, `new` writes tomorrow's date
while `done` and `take` write today's; in one behind UTC, early in the morning,
it writes yesterday's. Nothing fails, no guard notices, and the field that is
wrong is the one every report about "when" reads.

TL-213 measured the same disagreement inside ONE command: `new --wave` writes
the task's `created:` in local time and `plan.yaml`'s `updated:` in UTC, because
the plan writer took `todayStamp` (one shape for one file) and `new` kept its
own. That is why this is a task and not a line in that one: which of the two
answers is right is a decision — a person reading a backlog thinks in their own
day, and a fleet spread over several machines thinks in one — and it belongs to whoever
makes it, not to a change about writing `plan.yaml`.

## Pre-flight reading

1. `scripts/take-task.mjs` — `todayStamp()` and the comment that invites reuse.
2. `scripts/new-task.mjs` — the local-day copy, and everything it stamps.
3. `scripts/done-task.mjs` — the third copy.
4. `scripts/plan-write.mjs` — the newest caller, which reuses `todayStamp`.

## Steps

1. Decide UTC or local, and record it with `branchling decide` — the reasoning
   is the deliverable here, not the line of code.
2. ONE exported function, in a module both `new` and `done` may import without
   dragging in a lock and a history writer. `take-task.mjs` is the wrong home
   for it precisely because importing it costs that graph.
3. Delete the two private copies and call it instead.
4. A test that fails on a fourth copy, so this cannot come back.

## Acceptance criteria

- [ ] No `scripts/*.mjs` file defines its own `today()`; every date stamp comes
      from one exported function. [proof: one-shape]
- [ ] The suite is green. [proof: suite-green]
