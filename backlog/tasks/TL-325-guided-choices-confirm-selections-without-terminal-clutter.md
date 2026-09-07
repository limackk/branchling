---
id: TL-325
title: "Guided choices confirm selections without terminal clutter"
type: task
labels: []
board: main
epic: "Polished terminal prompts"  # free text — the group this task counts towards
priority: P2                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:codex
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-07
updated: 2026-09-07
blocked_by: [TL-324]               # ids of tasks that MUST be closed before this one starts
blocks: [TL-326]                   # ids this task will unblock
related_docs: [scripts/agent-profiles.mjs]
verification:                      # HOW to check the task is really done
  - id: prompt-completion
    bash: "node --test scripts/tests/terminal-ui.test.mjs scripts/tests/agent-profile-setup.test.mjs"
---

## Goal

Replace a completed interactive choice with one stable confirmation line so a
guided conversation reads as a clean sequence of decisions.

## Context

The selector currently leaves its frame visible after Enter. A short summary is
more useful in a setup transcript and avoids accumulating stale prompt lists.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/terminal-ui.mjs` — selector lifecycle.
2. `scripts/agent-profiles.mjs` — setup write boundary.

## Steps

1. Define a final selected and cancelled prompt state.
2. Replace the live frame before restoring raw mode.
3. Test Enter and Escape with a fake TTY.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] Enter leaves a concise selected-value confirmation, not a stale option list. [proof: prompt-completion]
- [x] Escape remains explicit and does not alter setup's write boundary. [proof: prompt-completion]
