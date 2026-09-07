---
id: TL-334
title: "Guided setup supports explicit step-back navigation"
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
  - id: step-back
    bash: "node --test scripts/tests/agent-profile-setup.test.mjs"
---

## Goal

Allow a user to revisit an earlier guided setup decision without cancelling the
whole setup or writing local configuration.

## Context

Clack distinguishes cancellation from selection but does not supply this
wizard's state history. The conversation owns a pending state until its final
confirmation, so it can safely expose a deliberate Back value.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/agent-profiles.mjs` — setup choices and pending state.

## Steps

1. Add a visible Back option to non-initial selects.
2. Map text fallback numbering to the same semantic value.
3. Return to the preceding profile identity step without writing.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] A user can return from adapter source to profile name and change it. [proof: step-back]
- [x] Escape remains whole-flow cancellation and leaves the store unchanged. [proof: step-back]
