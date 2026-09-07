---
id: TL-375
title: "Execution record tests isolate the developer home"
type: task
labels: []
board: main
epic: "Controlled and observable agent execution"
priority: P1
status: cancelled  # pending | in_progress | blocked | done | cancelled
owner: agent:codex
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 30m
confidence: medium                 # how much you trust the estimate
created: 2026-09-07
updated: 2026-09-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: [scripts/tests/execution-records.test.mjs, scripts/tests/run-control.test.mjs, scripts/tests/run-detach.test.mjs, scripts/tests/run-live-supervision.test.mjs] # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: isolated-execution-tests
    bash: "node --test scripts/tests/execution-records.test.mjs scripts/tests/run-control.test.mjs scripts/tests/run-detach.test.mjs scripts/tests/run-live-supervision.test.mjs"
---

## Goal

Archive this duplicate diagnostic task. TL-249 already isolated the execution
record and run-control tests from the developer's real home directory. A second
task for the same test-only correction would falsely inflate the remaining work
in this epic.

## Context

The live execution-test recovery found that several tests could read ambient
profile configuration. Commit `0172d8c` added `isolateHome(...)` to
`execution-records`, `run-control`, `run-detach`, and `run-live-supervision`.
This task was created during that diagnosis, after the code had already been
included in TL-249, and therefore never acquired an independent scope.

Cancellation preserves the fact that the concern was identified while keeping
TL-249 as the sole implementation and verification record.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/tests/execution-records.test.mjs` — confirm file-level home
   isolation for durable execution receipts.
2. `scripts/tests/run-control.test.mjs` — confirm isolated control-command
   fixtures.
3. `scripts/tests/run-detach.test.mjs` and
   `scripts/tests/run-live-supervision.test.mjs` — confirm detached and live
   supervisor fixtures cannot read a developer profile.

## Steps

1. Run the focused execution-record tests with a disposable local state path.
2. Cancel this task with a reason that names TL-249 as the owning correction.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] Execution-record, control, detached-run and live-supervision fixtures
  isolate the developer home. [proof: isolated-execution-tests]
