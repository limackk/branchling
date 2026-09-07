---
id: TL-323
title: "Terminal interaction preserves automation and accessibility"
type: task
labels: []
board: main
epic: "Terminal interaction standard"
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:codex
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-09-07
updated: 2026-09-07
blocked_by: [TL-321, TL-322]       # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: [scripts/terminal-ui.mjs, scripts/agent-profiles.mjs, scripts/watch.mjs]
verification:                      # HOW to check the task is really done
  - id: terminal-contract
    bash: "node --test scripts/tests/terminal-ui.test.mjs scripts/tests/agent-profile-setup.test.mjs scripts/tests/ui.test.mjs scripts/tests/watch.test.mjs"
---

## Goal

Prove the terminal standard remains an enhancement, never a barrier to scripts,
assistive technology or contributors who prefer plain text.

## Context

Raw mode is powerful and fragile. The relevant commands must be auditable as
ordinary text interfaces: explicit labels, numeric fallback, cancellation and
no ANSI or raw input in JSON, pipes, NO_COLOR or TERM=dumb.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/terminal-ui.mjs` — eligibility and restoration boundaries.
2. `scripts/tests/terminal-ui.test.mjs` — positive controls for both paths.

## Steps

1. Add cross-command regression cases for opt-out environments and cancellation.
2. Ensure help documents the keyboard and text alternatives where needed.
3. Run the focused terminal contract as one final compatibility gate.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] All interactive additions have visible labels and a numbered, keyboard-free path. [proof: terminal-contract]
- [x] Automation modes remain free of prompts, raw mode and ANSI control sequences. [proof: terminal-contract]
