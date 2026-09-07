---
id: TL-320
title: "Terminal interaction has one safe TTY contract"
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
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: [scripts/ui.mjs, scripts/agent-profiles.mjs]
verification:                      # HOW to check the task is really done
  - id: terminal-tests
    bash: "node --test scripts/tests/terminal-ui.test.mjs scripts/tests/ui.test.mjs"
---

## Goal

Provide one safe, reusable terminal selector for every interactive CLI flow.

## Context

Profile setup currently accepts typed numbers. Arrow-key selection should be a
TTY enhancement, never a second command contract or a pipe hazard. `ui.mjs`
already owns colors and terminal control; selection belongs beside that boundary.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/ui.mjs` — retain the one owner of terminal sequences and NO_COLOR.
2. `scripts/agent-profiles.mjs` — first consumer after the primitive is proven.

## Steps

1. Add a small Node raw-input selector with Up/Down, Enter and Escape.
2. Render selected state with existing semantic colors and symbols.
3. Provide numbered line-input fallback when raw interaction is unavailable.
4. Restore input and cursor state on every exit path.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] Selection works with keys in a TTY and text fallback elsewhere.
  [proof: terminal-tests]
- [x] JSON, pipe, NO_COLOR and TERM=dumb remain free of raw interaction.
  [proof: terminal-tests]
