---
id: TL-322
title: "Core CLI reports share a readable terminal presentation"
type: task
labels: []
board: main
epic: "Terminal interaction standard"
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:codex
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-09-07
updated: 2026-09-07
blocked_by: [TL-320]               # ids of tasks that MUST be closed before this one starts
blocks: [TL-323]                   # ids this task will unblock
related_docs: [scripts/ui.mjs]
verification:                      # HOW to check the task is really done
  - id: report-presentation
    bash: "node --test scripts/tests/ui.test.mjs scripts/tests/watch.test.mjs"
---

## Goal

Give the human-facing progress reports one compact, semantic presentation while
leaving machine output and stable text parsing unchanged.

## Context

The CLI already centralises colour and live-frame control in `ui.mjs`. This task
extends that vocabulary rather than adding a renderer per command. It starts
with watch because the user uses it to follow active work.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/ui.mjs` — semantic roles and the sole terminal-control boundary.
2. `scripts/watch.mjs` — live and one-shot progress report.

## Steps

1. Add reusable status and timestamp presentation helpers to the UI boundary.
2. Apply them to the watch frame without changing JSON shape or pipe output.
3. Cover colourless and live-terminal paths with focused tests.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] Watch identifies the active task, all wave tasks and their latest update in a readable frame. [proof: report-presentation]
- [x] Plain, JSON and non-TTY output retain complete information without terminal control. [proof: report-presentation]
