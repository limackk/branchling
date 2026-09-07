---
id: TL-372
title: "A finished adapter cannot leave its supervisor running"
type: task
labels: []
board: main
epic: "Controlled and observable agent execution"
priority: P0
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
  - id: adapter-exit-finishes-run
    bash: "node --test scripts/tests/run-live-supervision.test.mjs scripts/tests/run-control.test.mjs"
---

## Goal

A completed adapter always lets its detached `run-loop` supervisor complete and
write a terminal run record. An agent process disappearing must not leave a
live supervisor that has to be cancelled manually.

## Context

Found in the real TL-249 profile run on 2026-09-07. The Codex adapter and its
child process had exited, while `run-loop.mjs` remained alive and the run stayed
in `running`. Its log contained only the provenance header. Manual `runs cancel`
was needed to stop the supervisor.

This is not the same as reconciling a dead detached supervisor in TL-368. Here
the supervisor itself remains alive because its child-process completion path
does not settle. The fix must cover the process boundary and leave normal
timeouts and explicit cancellation intact.

## Pre-flight reading

1. `scripts/run-loop.mjs` — inspect `superviseAgent`, stream completion, and
   detached child ownership.
2. `scripts/tests/run-live-supervision.test.mjs` — add an adapter-exit fixture
   that asserts the loop resolves.
3. `scripts/execution-records.mjs` — preserve terminal run and attempt updates.

## Steps

1. Reproduce a child adapter that exits after producing no terminal output.
2. Ensure the stream and child completion promises settle the supervisor.
3. Record a terminal outcome and add regression coverage for detached execution.

## Acceptance criteria

- [x] An adapter process exiting causes the detached loop to resolve without a
      manual cancellation. [proof: adapter-exit-finishes-run]
- [x] The final run and attempt records have terminal phases. [proof: adapter-exit-finishes-run]
