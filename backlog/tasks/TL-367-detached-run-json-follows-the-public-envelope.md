---
id: TL-367
title: "Detached run JSON follows the public envelope"
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
  - id: detached-json-envelope
    bash: "node --test scripts/tests/run-detach.test.mjs scripts/tests/json-envelope.test.mjs"
---

## Goal

`branchling run --detach --json` returns the same public JSON envelope as the
other CLI reading and lifecycle commands. The detached-start response is an
automation boundary: consumers need `schemaVersion` and `ok`, rather than a
special bare object that only this code path emits.

## Context

Found during a real detached run on 2026-09-07. The profile check returned a
valid envelope, then `run --detach --json` printed only `kind`, `run`, and
`phase`. The regular `runs` commands already use the public envelope. A client
cannot reliably consume both shapes without a provider-specific exception,
which contradicts the JSON contract.

Do not change detached process ownership or lifecycle behavior to fix the
response shape. This task is limited to the boundary emitted by the parent
process and a regression test for it.

## Pre-flight reading

1. `scripts/run-loop.mjs` — inspect the detached parent response and the normal
   JSON reporting path.
2. `scripts/json-envelope.mjs` — use the established envelope constructor and
   field conventions.
3. `scripts/tests/run-detach.test.mjs` and
   `scripts/tests/json-envelope.test.mjs` — extend the existing command-level
   contract coverage rather than adding a parallel assertion style.

## Steps

1. Route the detached parent response through the public JSON envelope helper.
2. Preserve the run identifier and initial phase in the envelope payload.
3. Add a command-level regression test for `run --detach --json` that does not
   leave a background process behind.

## Acceptance criteria

- [x] The detached JSON response includes `schemaVersion`, `ok`, `kind`, run
      identifier, and initial phase. [proof: detached-json-envelope]
- [x] The detached response remains machine-readable JSON and does not change
      the child process lifecycle. [proof: detached-json-envelope]
