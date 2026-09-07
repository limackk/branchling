---
id: TL-332
title: "Setup explains when an adapter path is required"
type: task
labels: []
board: main
epic: "Guided setup clarity"       # free text — the group this task counts towards
priority: P1                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:codex
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-07
updated: 2026-09-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: [scripts/agent-profiles.mjs, scripts/tests/agent-profile-setup.test.mjs]
verification:                      # HOW to check the task is really done
  - id: adapter-guidance
    bash: "node --test scripts/tests/agent-profile-setup.test.mjs"
---

## Goal

Prevent new users from mistaking an adapter executable for a provider CLI or
model identifier during guided setup.

## Context

An adapter is a Branchling process-contract wrapper. Most first-time users need
the copied reference adapter, while a path is only correct for an adapter they
already created or maintain.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/agent-profiles.mjs` — adapter source choice and custom path field.

## Steps

1. Mark custom adapters as advanced and reference adapters as the recommended path.
2. Explain that the custom field takes an executable wrapper path, not `claude` or a model.
3. Add a transcript assertion for both pieces of guidance.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] The custom adapter choice explains exactly when it is appropriate. [proof: adapter-guidance]
- [x] The path prompt supplies a safe, concrete example. [proof: adapter-guidance]
