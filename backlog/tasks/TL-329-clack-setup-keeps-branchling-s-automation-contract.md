---
id: TL-329
title: "Clack setup keeps Branchling's automation contract"
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
blocked_by: [TL-327]               # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: clack-contract
    bash: "node --test scripts/tests/agent-profile-setup.test.mjs scripts/tests/ui.test.mjs"
---

## Goal

Prove the Clack renderer is an interactive enhancement, not a change to the CLI
and API contracts.

## Context

Pipes, JSON and flag commands must never load or depend on an interactive UI.
No credential values may be requested through the terminal.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/agent-profiles.mjs` — interactive guard and flag command path.
2. `scripts/tests/agent-profile-setup.test.mjs` — no-TTY tests.

## Steps

1. Add regression tests around non-TTY and JSON setup invocations.
2. Verify the package remains installable on the supported Node range.
3. Document the separation of interactive and flag-based setup.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] Pipe and JSON calls remain prompt-free and deterministic. [proof: clack-contract]
- [x] Flag-based profile configuration does not require Clack interaction. [proof: clack-contract]
