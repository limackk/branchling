---
id: TL-239
title: "run --dry-run projects a task this actor handed back, which the run will not take"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-04
updated: 2026-09-04
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

`run --dry-run` must not list a task the run would refuse to take because THIS
actor handed it back. Today the projection lists it and the run skips it, which
is the divergence TL-206 removed for waves, left standing on another axis.

## Context

Found while closing TL-206 (the two paths disagreeing about the same queue).
`next` builds its filters with `actor` in them
(`scripts/next-task.mjs`, `const filters = {...}` before `selectCandidates`),
and `selectCandidates` uses it in `notHandedBack`: a task whose last history
event is a handoff BY THIS ACTOR is not handed out to that same actor again,
because it already judged the task did not fit its session (TL-137, TL-141).

`run`'s dry-run path builds its own filters object
(`scripts/run-loop.mjs`, `const filters = {...}` and then
`const base = { ...filters, callerSpecies: callerSpecies(actor) }`) and does
NOT put `actor` in it. So the projection counts a task as one that would run
and the live loop's `next` never hands it out: the operator is shown a queue
one task longer than the one that will be worked.

TL-206 fixed the wave axis and deliberately did not widen into this one: it is
a different policy field, no test covers it, and a change to the projection's
filters affects every dry run with or without `--plan`.

Not a wording question, so it is neither TL-186 nor TL-199.

## Pre-flight reading

1. `scripts/next-task.mjs` — the `filters` object and `notHandedBack` in
   `selectCandidates`; `skippedHandedBack` is what the count is called.
2. `scripts/run-loop.mjs` — the `filters` object and `base` in the `--dry-run`
   branch; the same `actor` is already resolved a few lines above.
3. `scripts/tests/plan-dry-run-agrees.test.mjs` — the shape of a test that
   compares the projection's ids against the ids the run takes.

## Steps

1. Reproduce in a fixture: one task, `handoff` it as `agent:mine`, then assert
   that `run --dry-run --actor agent:mine` and `run --actor agent:mine` name
   the same ids. A positive control is required — with another actor asking,
   both must list it.
2. Decide whether `--dry-run` reports the skipped task rather than silently
   dropping it, the way the projection now names the wave it stopped at.

## Acceptance criteria

- [ ] `run --dry-run` does not project a task this actor handed back, proven by
      a fixture that compares the projection's ids with the run's.
      [proof: suite-green]
