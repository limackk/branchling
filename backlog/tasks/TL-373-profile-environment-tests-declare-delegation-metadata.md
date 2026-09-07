---
id: TL-373
title: "Profile environment tests declare delegation metadata"
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
  - id: profile-environment-contract
    bash: "node --test scripts/tests/agent-adapter-security.test.mjs"
---

## Goal

The profile adapter environment contract test includes the delegation metadata
that the controlled-execution surface intentionally provides.

## Context

Found while running the full suite for TL-249. The implementation correctly
exports `BRANCHLING_DELEGATION` and `BRANCHLING_DELEGATION_ENFORCEMENT`, but
`agent-adapter-security.test.mjs` still expects the older, smaller map. That
makes the full suite red despite the intended public adapter contract.

## Pre-flight reading

1. `scripts/run-loop.mjs` — identify the documented delegation environment
   values and defaults.
2. `scripts/tests/agent-adapter-security.test.mjs` — update the exact contract
   assertion without broadening secret forwarding.

## Steps

1. Add the two delegation fields and their expected defaults to the assertion.
2. Keep the assertion that no unnamed secret enters the adapter environment.

## Acceptance criteria

- [x] The documented delegation fields are asserted explicitly. [proof: profile-environment-contract]
- [x] The named-secret boundary remains covered. [proof: profile-environment-contract]
