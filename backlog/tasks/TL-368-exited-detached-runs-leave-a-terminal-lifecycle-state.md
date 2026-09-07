---
id: TL-368
title: "Exited detached runs leave a terminal lifecycle state"
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
  - id: exited-run-terminal-state
    bash: "node --test scripts/tests/run-control.test.mjs scripts/tests/run-detach.test.mjs"
---

## Goal

A detached run whose supervisor has exited is recorded with a truthful terminal
lifecycle state. `runs show` must never leave a dead process in `starting` or
`running`, because an operator relies on that record to decide whether action is
needed.

## Context

Found in a real detached profile run on 2026-09-07. `run-88f9c3b52c70953f99074430`
was stored as `starting`, its supervisor PID was no longer alive, and no attempt
record existed. `runs show` exposed `alive: false` but did not reconcile the
run phase. A reader of `runs list` sees only the misleading active state.

This is distinct from cancellation: the implementation must retain the run
record and state why it ended, not delete it or assume every missing PID was
cancelled by the user.

## Pre-flight reading

1. `scripts/run-control.mjs` — inspect PID liveness checks and record updates.
2. `scripts/execution-records.mjs` — inspect terminal phase vocabulary and
   durable write behavior.
3. `scripts/tests/run-control.test.mjs` and `scripts/tests/run-detach.test.mjs`
   — extend lifecycle coverage with an exited supervisor fixture.

## Steps

1. Reconcile a non-live supervisor before displaying or listing a nonterminal
   run record.
2. Preserve an explicit terminal phase and finish timestamp without changing
   still-live runs.
3. Add regression coverage for a run that exits before recording an attempt.

## Acceptance criteria

- [x] A dead detached supervisor is no longer reported as `starting` or
      `running`. [proof: exited-run-terminal-state]
- [x] The run record remains inspectable with a terminal phase and end time.
      [proof: exited-run-terminal-state]
