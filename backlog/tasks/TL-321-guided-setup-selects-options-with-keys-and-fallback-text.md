---
id: TL-321
title: "Guided setup selects options with keys and fallback text"
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
blocked_by: [TL-320]               # ids of tasks that MUST be closed before this one starts
blocks: [TL-323]                   # ids this task will unblock
related_docs: [scripts/agent-profiles.mjs, scripts/terminal-ui.mjs]
verification:                      # HOW to check the task is really done
  - id: setup-choices
    bash: "node --test scripts/tests/agent-profile-setup.test.mjs scripts/tests/terminal-ui.test.mjs"
---

## Goal

Make the guided profile and fleet setup keyboard-first while preserving its
current typed-number transcript for callers without raw terminal input.

## Context

The setup flow already separates local configuration from provider execution.
TL-320 supplies a safe selector; this task applies it only at finite choices.
Free-form prompts remain ordinary line input, so scripts and accessibility tools
keep the same contract.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/agent-profiles.mjs` — guided state machines and their write boundary.
2. `scripts/terminal-ui.mjs` — selector result and fallback contract.

## Steps

1. Use the shared selector for setup mode, adapter source, references and confirmation.
2. Keep conversation functions injectable and transcript-testable without a TTY.
3. State keyboard hints and leave no store changed on cancellation.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] Every finite setup choice supports arrows, Enter and Escape in an eligible terminal. [proof: setup-choices]
- [x] Numbered text answers still drive the same profile and launch writes. [proof: setup-choices]
