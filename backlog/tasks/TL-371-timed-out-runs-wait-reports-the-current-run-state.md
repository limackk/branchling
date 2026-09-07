---
id: TL-371
title: "Timed out runs wait reports the current run state"
type: task
labels: []
board: main
epic: "Controlled and observable agent execution"
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
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
  - id: wait-timeout-result
    bash: "node --test scripts/tests/run-control.test.mjs"
---

## Goal

`branchling runs wait --json` returns a machine-readable result when its
timeout expires while the run remains active. A caller must be able to tell
that it timed out and inspect the latest run state without issuing a second
command or interpreting an empty stream.

## Context

Found while monitoring a real detached profile run on 2026-09-07. Three calls
to `runs wait <run-id> --timeout 60 --json` reached their timeout and printed
nothing, although `runs show` immediately afterwards confirmed the run was
alive. Empty output is ambiguous to both a terminal user and an API caller.

Do not turn a wait timeout into a failure of the supervised run. The command's
own response should report the timeout while preserving the current lifecycle
record.

## Pre-flight reading

1. `scripts/run-control.mjs` — inspect `wait` timeout and JSON rendering paths.
2. `scripts/json-envelope.mjs` — use the public response format.
3. `scripts/tests/run-control.test.mjs` — add a bounded live-run fixture that
   exercises timeout without sleeping for a production interval.

## Steps

1. Emit a JSON envelope on a wait timeout with an explicit timeout outcome and
   the latest run record.
2. Keep a terminal run's completed response distinct from an active run that
   merely exceeded the caller's wait budget.
3. Add regression coverage for JSON and human output timeout cases.

## Acceptance criteria

- [ ] A timed-out JSON wait reports an explicit timeout outcome and the current
      run record. [proof: wait-timeout-result]
- [ ] A wait timeout does not alter the phase of a still-live run.
      [proof: wait-timeout-result]
