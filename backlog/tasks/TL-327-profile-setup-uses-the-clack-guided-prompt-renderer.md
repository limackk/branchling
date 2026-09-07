---
id: TL-327
title: "Profile setup uses the Clack guided-prompt renderer"
type: task
labels: []
board: main
epic: "Clack guided setup"         # free text — the group this task counts towards
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
blocks: [TL-328, TL-329]           # ids this task will unblock
related_docs: [scripts/agent-profiles.mjs, package.json]
verification:                      # HOW to check the task is really done
  - id: clack-setup
    bash: "node --test scripts/tests/agent-profile-setup.test.mjs"
---

## Goal

Render `profile setup` through Clack while retaining its existing local-profile
format, validation and no-write-before-confirmation boundary.

## Context

The custom selector is safe but does not deliver the polished wizard experience
users expect. Clack is an intentional dependency for guided human input only;
the flag-based API remains the automation surface.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/agent-profiles.mjs` — state machines and shared write boundary.
2. `scripts/tests/agent-profile-setup.test.mjs` — transcript safety contract.

## Steps

1. Add the minimal Clack dependency.
2. Adapt real TTY setup input to Clack selects and text fields.
3. Preserve injected transcript functions for deterministic tests.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] A capable terminal sees Clack select, text and confirmation prompts during profile setup. [proof: clack-setup]
- [x] Cancellation and invalid values leave the profile store unchanged. [proof: clack-setup]
