---
id: TL-359
title: "Detached runs can be inspected waited for and cancelled"
type: code
labels: []
board: main
epic: "Controlled and observable agent execution"
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:codex
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-09-07
updated: 2026-09-07
blocked_by: [TL-358]               # ids of tasks that MUST be closed before this one starts
blocks: [TL-360, TL-362]           # ids this task will unblock
related_docs: [scripts/cli.mjs, scripts/run-loop.mjs, scripts/lock.mjs]
verification:                      # HOW to check the task is really done
  - id: run-control
    bash: "node --test scripts/tests/run-control.test.mjs scripts/tests/run.test.mjs"
---

## Goal

A caller can start a run without blocking its own session, receive a stable run
ID, inspect or wait for that run, and cancel its supervised process tree with a
recorded outcome.

## Context

A blocking `run` leaves a parent Codex or Claude session unable to distinguish
work from a hang until the command returns. A detached mode must not require a
permanent daemon: a small supervisor process can own one run and its external
state record. Control commands read that record and verify process identity
before signaling anything. Cancellation is an operator decision and must not
silently claim that the task failed or completed.

## Pre-flight reading

1. `scripts/run-loop.mjs` — separate run ownership from the terminal process
   that requested it.
2. `scripts/lock.mjs` — reuse repository identity and prevent stale PID reuse
   from targeting another process.
3. `scripts/cli.mjs` — design one discoverable command family with consistent
   JSON envelopes and exit codes.

## Steps

1. Add `run --detach` returning a run ID after the supervisor is durably ready.
2. Add list, show, wait and cancel operations over local run records.
3. Make wait bounded and machine-readable so another agent session can poll
   without holding an opaque tool call indefinitely.
4. Cancel with TERM, a documented grace period and KILL fallback for the owned
   process group.
5. Reconcile a supervisor crash into an explicit stale or interrupted outcome.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] Detached start returns only after a readable run record exists.
      [proof: run-control]
- [x] List, show and bounded wait expose the same run identity and terminal
      result in text and JSON. [proof: run-control]
- [x] Cancel terminates the owned adapter descendants and records `cancelled`
      without closing the task. [proof: run-control]
- [x] A stale record or reused PID cannot signal an unrelated process.
      [proof: run-control]
- [x] Foreground `run` preserves its current contract. [proof: run-control]
