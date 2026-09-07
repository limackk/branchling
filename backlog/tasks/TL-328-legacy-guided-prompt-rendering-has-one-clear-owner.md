---
id: TL-328
title: "Legacy guided prompt rendering has one clear owner"
type: task
labels: []
board: main
epic: "Clack guided setup"         # free text — the group this task counts towards
priority: P1                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:codex
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-07
updated: 2026-09-07
blocked_by: [TL-327]               # ids of tasks that MUST be closed before this one starts
related_docs: [scripts/agent-profiles.mjs, scripts/ui.mjs]
verification:                      # HOW to check the task is really done
  - id: renderer-ownership
    bash: "node --test scripts/tests/agent-profile-setup.test.mjs scripts/tests/ui.test.mjs"
---

## Goal

Make ownership of guided prompt rendering unambiguous after Clack migration.

## Context

Keeping two visual prompt renderers for one wizard would cause drift. Decide
whether the small internal selector still serves a different consumer or remove
it with its now-redundant tests.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/terminal-ui.mjs` — custom selector scope.
2. `scripts/agent-profiles.mjs` — migrated consumer.

## Steps

1. Audit remaining consumers.
2. Remove unused renderer code or document its separate responsibility.
3. Keep one tested visual implementation per interaction.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] No guided setup path silently chooses between two visual renderers. [proof: renderer-ownership]
