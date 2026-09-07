---
id: TL-326
title: "Polished prompts preserve plain terminal contracts"
type: task
labels: []
board: main
epic: "Polished terminal prompts"  # free text — the group this task counts towards
priority: P1                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:codex
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-07
updated: 2026-09-07
blocked_by: [TL-324, TL-325]       # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: [scripts/terminal-ui.mjs, scripts/ui.mjs, scripts/agent-profiles.mjs]
verification:                      # HOW to check the task is really done
  - id: polished-contract
    bash: "node --test scripts/tests/terminal-ui.test.mjs scripts/tests/agent-profile-setup.test.mjs scripts/tests/ui.test.mjs"
---

## Goal

Verify visual polish remains optional and every guided command still has an
accessible plain-text path.

## Context

The project promises no raw terminal control in pipes, JSON, NO_COLOR or
TERM=dumb. This final task prevents visual work changing that contract.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/terminal-ui.mjs` — interaction eligibility.
2. `scripts/tests/terminal-ui.test.mjs` — positive controls for both modes.

## Steps

1. Exercise the polished frame in colour and plain modes.
2. Confirm text fallback remains numbered and no escape sequences escape `ui.mjs`.
3. Document user-facing keyboard clues added by the visual work.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] NO_COLOR, TERM=dumb and non-TTY execution retain complete plain text. [proof: polished-contract]
- [x] JSON and setup cancellation paths remain unchanged. [proof: polished-contract]
