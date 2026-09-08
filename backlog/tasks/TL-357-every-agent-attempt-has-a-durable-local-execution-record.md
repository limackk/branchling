---
id: TL-357
title: "Every agent attempt has a durable local execution record"
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
blocked_by: [TL-355]               # ids of tasks that MUST be closed before this one starts
blocks: [TL-358]                   # ids this task will unblock
related_docs: [scripts/lock.mjs, scripts/run-loop.mjs]
verification:                      # HOW to check the task is really done
  - id: execution-record
    bash: "node --test scripts/tests/run.test.mjs scripts/tests/run-agent-profiles.test.mjs scripts/tests/session-report.test.mjs scripts/tests/execution-records.test.mjs"
---

## Goal

Every run and attempt has a local execution record that can be read while the
process exists and after it exits. The record identifies what was requested,
what phase is current and when its evidence last changed.

## Context

Today an execution receipt is appended only after an agent returns, while the
task and history expose only claim-time state. Store operational state outside
Git beside locks and run logs: it is local, replaceable control-plane data, not
task truth. Use one run ID and one attempt ID per leg so retries and handoffs do
not overwrite each other. Atomic writes must leave either the old complete
record or the new complete record after a crash.

## Pre-flight reading

1. `scripts/run-loop.mjs` — map claims, attempts, handoffs, verification and
   terminal outcomes into phases.
2. `scripts/activity.mjs` — keep execution records distinct from heartbeats and
   privacy-sensitive activity measurement.
3. `scripts/lock.mjs` — reuse repository identity and the external state root.

## Steps

1. Define versioned run and attempt records with stable IDs and timestamps.
2. Persist `starting`, `running`, `verifying` and terminal phases atomically in
   the external state directory.
3. Record actor, task, role, profile, requested model, effort and delegation
   policy without prompts, secrets or adapter paths.
4. Add readers that tolerate an interrupted final write and older schema.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] A reader can observe each run leg and attempt before it finishes and after
      it exits. [proof: execution-record]
- [x] Retries and role handoffs have distinct records and stable parent run
      identity. [proof: execution-record]
- [x] Records live outside the repository and contain no prompt, secret or
      personal adapter path. [proof: execution-record]
- [x] An interrupted write never produces a plausible partial record.
      [proof: execution-record]
