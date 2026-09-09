---
id: TL-333
title: "First setup leads with a general agent before fleet routing"
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
related_docs: [scripts/agent-profiles.mjs, backlog/tasks/TL-382-provider-execution-uses-one-thin-user-owned-adapter-path.md]
verification:                      # HOW to check the task is really done
  - id: first-setup-flow
    bash: "node --test scripts/tests/agent-profile-setup.test.mjs"
---

## Goal

Lead a first-time user to one working general agent before exposing fleet routing.

## Context

Fleets route existing local profiles to repository roles. Offering that option
when no profiles exist creates a predictable failure instead of a useful path.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/agent-profiles.mjs` — initial mode selection and fleet setup.

## Steps

1. Offer only general setup when no local profile exists.
2. Explain when fleet routing becomes available.
3. Test mode availability without an interactive terminal.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] A first-time user is led to a general agent, not a fleet failure. [proof: first-setup-flow]
- [x] Existing-profile users can still select specialist fleet routing. [proof: first-setup-flow]
