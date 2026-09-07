---
id: TL-354
title: "An unmeasured run releases its task owner"
type: bug
labels: [agents, routing]
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-09-07
updated: 2026-09-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: unmeasured-claim-is-clear
    bash: "node --test scripts/tests/run.test.mjs"
---

## Goal

When a run returns a claim because its agent produced no measurable execution,
restore both queue facts: `status: pending` and an empty `owner:`. A pending
task must be eligible for another dispatcher, not carry an abandoned claimant.

## Context

The live TL-242 profile run took the task as `agent:codex-dispatch` and then
returned `agent-never-ran`. `writeStatus()` changed only `status` to `pending`;
the old owner remained. This was exposed by the stderr-only adapter issue in
TL-353, but is an independent state-transition defect: it also affects a truly
silent agent. Reuse the existing release semantics or make the run's transition
atomic; do not clear an owner when another actor has legitimately taken over.

## Pre-flight reading

1. `scripts/run-loop.mjs` — follow the `agent-never-ran` branch and the status
   writer used to return a claim.
2. `scripts/release-task.mjs` — preserve the established owner and lock release
   semantics.
3. `scripts/tests/run.test.mjs` — extend the silent-agent regression coverage.

1. `path/to/file` — what to look at there

## Steps

1. Make the unmeasured-agent return clear the owner only when this run still
   owns the claim.
2. Keep the protection against overwriting a task held or completed elsewhere.
3. Add a regression assertion for both `pending` and blank `owner` after a
   silent, unchanged attempt.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [ ] A silent, unchanged agent returns a task with `status: pending` and no
      owner. [proof: unmeasured-claim-is-clear]
- [ ] A claim taken by another actor is never cleared by the stale run.
      [proof: unmeasured-claim-is-clear]
