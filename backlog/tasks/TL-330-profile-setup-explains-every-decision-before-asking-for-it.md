---
id: TL-330
title: "Profile setup explains every decision before asking for it"
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
  - id: setup-copy
    bash: "node --test scripts/tests/agent-profile-setup.test.mjs"
---

## Goal

Make each `profile setup` decision understandable to a developer who has never
seen profiles, adapters, launches or provider-neutral execution before.

## Context

The Clack migration improved interaction but did not explain terminology.
Questions must name their outcome, selects must state the practical difference
between options, and credential handling must make its safety boundary explicit.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/agent-profiles.mjs` — setup conversation and Clack adapter.
2. `scripts/tests/agent-profile-setup.test.mjs` — transcript contract.

## Steps

1. Reword profile, adapter, prompt and fleet questions in user-goal language.
2. Add concise option hints and examples where terminology is unavoidable.
3. Test that a transcript includes the decision context and retains its write boundary.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] Generalist, fleet and adapter choices state their practical consequence. [proof: setup-copy]
- [x] Prompt and credential fields explain their purpose and give safe examples. [proof: setup-copy]
