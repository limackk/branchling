---
id: TL-358
title: "Agent output and liveness are observed while it runs"
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
blocked_by: [TL-357]               # ids of tasks that MUST be closed before this one starts
blocks: [TL-359, TL-360]           # ids this task will unblock
related_docs: [scripts/run-loop.mjs, docs/backlog-time-tracking.md]
verification:                      # HOW to check the task is really done
  - id: live-supervision
    bash: "node --test scripts/tests/run.test.mjs scripts/tests/run-agent-profiles.test.mjs scripts/tests/run-stuck-status.test.mjs scripts/tests/run-live-supervision.test.mjs"
---

## Goal

Branchling observes an agent process while it runs: output reaches the log
incrementally, process liveness is refreshed, and optional adapter progress is
recorded without confusing an alive process with productive work.

## Context

`workOne()` currently uses `spawnSync`, so the run loop cannot update state,
stream output or react until the adapter exits or times out. Replace that
blocking boundary with supervised asynchronous execution while preserving
stdin, timeout, retry, secret redaction and output-size safety. A generic
adapter can prove only that its process lives and emits bytes. A conforming
adapter may emit structured progress through a separate protocol; neither
signal proves that useful work will finish.

## Pre-flight reading

1. `scripts/run-loop.mjs` — replace only the agent process boundary and retain
   all claim and verification semantics around it.
2. `scripts/activity.mjs` — do not turn supervisor ticks into engaged-time
   heartbeats.
3. `docs/backlog-time-tracking.md` — preserve the distinction between activity
   evidence and elapsed process time.

## Steps

1. Spawn adapters asynchronously and stream redacted stdout and stderr into the
   existing per-leg log.
2. Refresh process-liveness and last-output timestamps at bounded intervals.
3. Accept optional versioned progress events while treating ordinary output as
   unstructured activity only.
4. Terminate the process tree on timeout and record why it ended.
5. Preserve retry, handoff, never-ran and verification outcomes with regression
   coverage.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] Output is visible in the run log before the adapter exits.
      [proof: live-supervision]
- [x] Liveness, last output and last structured progress are separate fields.
      [proof: live-supervision]
- [x] A silent live process is reported as alive and quiet, never as confirmed
      productive work. [proof: live-supervision]
- [x] Timeout terminates descendants and leaves one explicit terminal outcome.
      [proof: live-supervision]
- [x] Existing raw-command and profile contracts remain compatible.
      [proof: live-supervision]
