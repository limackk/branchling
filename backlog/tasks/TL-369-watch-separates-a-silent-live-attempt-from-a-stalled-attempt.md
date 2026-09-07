---
id: TL-369
title: "Watch separates a silent live attempt from a stalled attempt"
type: task
labels: []
board: main
epic: "Controlled and observable agent execution"
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:codex
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 30m
confidence: medium                 # how much you trust the estimate
created: 2026-09-07
updated: 2026-09-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: silent-live-attempt
    bash: "node --test scripts/tests/watch.test.mjs scripts/tests/run-live-supervision.test.mjs"
---

## Goal

`branchling watch` distinguishes a live attempt that has not printed output
from an actually stalled attempt. Operators must not be told an agent is stuck
when the supervised process is alive and still within its configured timeout.

## Context

Found during the real TL-249 profile execution on 2026-09-07. `runs show`
reported the supervisor alive and `watch` showed the task as `stalled` because
the attempt had not emitted output after the liveness timestamp. Silent coding
is normal for a provider wrapper, so output age alone cannot classify a live
child as stuck.

Keep a separate signal for stale output: it is useful to an operator. The fix
must make its meaning clear, not hide a quiet process behind a generic active
label.

## Pre-flight reading

1. `scripts/watch.mjs` — inspect execution-state classification and terminal
   rendering.
2. `scripts/run-loop.mjs` — inspect supervision heartbeat and output timestamps.
3. `scripts/tests/watch.test.mjs` and
   `scripts/tests/run-live-supervision.test.mjs` — add a live-but-silent case
   beside genuine stale-process coverage.

## Steps

1. Use process liveness and timeout state when classifying a running attempt.
2. Render a distinct quiet or no-output state when the process is alive but its
   output is old.
3. Cover both a live silent process and a dead or overdue process in tests.

## Acceptance criteria

- [x] A live silent attempt is not labeled `stalled`. [proof: silent-live-attempt]
- [x] A process that is dead or has exceeded its supervision timeout remains
      visibly stalled or terminal. [proof: silent-live-attempt]
