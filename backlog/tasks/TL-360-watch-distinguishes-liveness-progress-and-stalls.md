---
id: TL-360
title: "Watch distinguishes liveness progress and stalls"
type: code
labels: []
board: main
epic: "Controlled and observable agent execution"
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:codex
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-09-07
updated: 2026-09-07
blocked_by: [TL-358, TL-359]       # ids of tasks that MUST be closed before this one starts
blocks: [TL-362]                   # ids this task will unblock
related_docs: [scripts/watch.mjs, scripts/ui.mjs, scripts/run-loop.mjs]
verification:                      # HOW to check the task is really done
  - id: observable-watch
    bash: "node --test scripts/tests/watch.test.mjs scripts/tests/run-control.test.mjs"
---

## Goal

`branchling watch` shows the complete active wave together with each live run's
phase, requested model, elapsed time, process liveness and age of the last
progress evidence.

## Context

The current watch frame reads task files and history. An agent can run for ten
minutes without changing either, so the display cannot distinguish work from a
hang. Consume the external execution records introduced by TL-357 and the live
signals from TL-358. Use precise labels: `alive` means the owned process exists,
`active` means recent output or progress, `quiet` means alive without recent
evidence, and `stalled` means the configured evidence threshold elapsed. Never
state that a model is productive based only on PID liveness.

## Pre-flight reading

1. `scripts/watch.mjs` — extend the existing quiet single-frame renderer and
   preserve `--once` and `--json`.
2. `scripts/ui.mjs` — use the shared color and non-TTY contract.
3. `scripts/run-loop.mjs` — consume execution state rather than re-deriving
   process truth in the UI.

## Steps

1. Join active-wave tasks with current run and attempt records by task ID.
2. Render phase, profile or model, elapsed time, liveness and last-progress age
   in a stable compact layout.
3. Define quiet and stalled thresholds from local execution policy and display
   their meaning in help.
4. Add run filtering without removing the full-wave context.
5. Preserve flicker-free redraw, plain terminals, `NO_COLOR` and JSON.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] One frame shows every task in the active wave and identifies its current
      run when one exists. [proof: observable-watch]
- [x] Alive, active, quiet, stalled, verifying and terminal phases cannot be
      confused in text or JSON. [proof: observable-watch]
- [x] The displayed model and effort are requested values, never provider
      confirmation unless the receipt contains proof. [proof: observable-watch]
- [x] TTY redraw does not flicker and non-TTY, `NO_COLOR`, `--once` and `--json`
      remain deterministic. [proof: observable-watch]
