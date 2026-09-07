---
id: TL-331
title: "Fleet setup reports its unmet prerequisite clearly"
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
  - id: fleet-feedback
    bash: "node --test scripts/tests/agent-profile-setup.test.mjs"
---

## Goal

Show the unmet fleet prerequisite and a practical next step instead of hiding
the reason behind a generic cancellation message.

## Context

Fleet setup validates backlog roles and local profiles before asking for
routing. The interactive wrapper currently discards typed problems, so a
developer cannot distinguish missing roles, profiles or an invalid store.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/agent-profiles.mjs` — fleet validation results and Clack wrapper.

## Steps

1. Preserve typed fleet failures through the Clack outcome.
2. Add a command-shaped next step for missing roles and profiles.
3. Test the rendered failure message without a pseudo-terminal.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] A missing role or profile is named explicitly with a next step. [proof: fleet-feedback]
- [x] Cancellation remains quiet and makes no write. [proof: fleet-feedback]
