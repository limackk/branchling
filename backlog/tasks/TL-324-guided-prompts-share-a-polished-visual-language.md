---
id: TL-324
title: "Guided prompts share a polished visual language"
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
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: [TL-325, TL-326]           # ids this task will unblock
related_docs: [scripts/terminal-ui.mjs, scripts/ui.mjs]
verification:                      # HOW to check the task is really done
  - id: prompt-style
    bash: "node --test scripts/tests/terminal-ui.test.mjs scripts/tests/ui.test.mjs"
---

## Goal

Give every keyboard-enabled guided choice a compact visual hierarchy comparable
to a polished Clack prompt without adding a runtime dependency.

## Context

TL-320 established raw-input safety, but its choice list deliberately remained
plain. The project already owns semantic ANSI roles in `ui.mjs`; this task uses
them only when interaction is eligible and keeps symbols meaningful without
colour.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/terminal-ui.mjs` — selector drawing and restoration boundary.
2. `scripts/ui.mjs` — semantic painter and terminal control ownership.

## Steps

1. Add a prompt frame with a heading, selected option, muted alternatives and key hint.
2. Render the selection through semantic colors and symbols, never raw sequences.
3. Keep rendering deterministic and independently testable with the plain painter.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] The active option has a visible symbol and semantic emphasis; inactive options and hints are quieter. [proof: prompt-style]
- [x] No option loses meaning when output is plain. [proof: prompt-style]
