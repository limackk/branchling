---
id: TL-378
title: "Activity telemetry no longer ships in the core product"
type: task
labels: []
board: main
epic: "Evidence-gated product focus"
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-08
updated: 2026-09-21
blocked_by: [TL-377]
blocks: []                         # ids this task will unblock
related_docs:
  - docs/backlog-time-tracking.md
  - README.md
verification:
  - id: telemetry-absent
    bash: "node --test scripts/tests/no-activity-product-surface.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

The shipped product no longer records or reports developer activity,
heartbeats, time, sessions, actor scorecards, token cost or estimate
calibration. Removing that subsystem eliminates a privacy and retention product
that does not strengthen task authorization, scope or proof.

## Context

The activity subsystem spans commands, local raw logs, versioned rollups,
configuration, reports, hooks and viewer panels. This is a product removal, not
a deletion of historical facts. Existing versioned rollups and append-only task
history stay readable in old commits. Do not delete user-local raw logs during
an install or upgrade; document that the new binary ignores them and how a user
may remove them deliberately.

`audit` remains, but judges task declarations against task history. It must not
score actors or reconstruct working time. `quote` is removed with calibration;
task estimates remain ordinary project data.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/activity.mjs` and `scripts/activity-command.mjs` — map writes and
   privacy behaviour before removal.
2. `scripts/session-report.mjs`, `scripts/time-report.mjs` and
   `scripts/actors.mjs` — identify derived reporting surfaces.
3. `scripts/cli.mjs` — remove commands and help as one closed surface.
4. `scripts/config.mjs` and `docs/backlog-time-tracking.md` — remove accepted
   keys and replace documentation with a concise migration note.
5. `scripts/build-viewer.mjs` — remove telemetry consumers without redesigning
   the remaining viewer; TL-379 owns that redesign.

## Steps

1. Remove `activity`, `focus`, `time`, `sessions`, `session`, `actors` and
   `quote` from the CLI, JSON/MCP registry and public documentation.
2. Remove their implementation, hooks, viewer inputs, configuration keys and
   tests that only prove the removed capability.
3. Keep task estimates and the task-history audit independent of telemetry.
4. Add a migration note covering ignored local logs and preserved historical
   rollups; perform no automatic destructive cleanup.
5. Add a positive control proving an unknown removed command fails and the
   ordinary evidence-gated loop still works.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] No telemetry command or configuration key is part of the shipped public
      surface. [proof: telemetry-absent]
- [x] A clean install writes no activity or session data unless an external
      program independently chooses to do so. [proof: telemetry-absent]
- [x] `audit` still judges task evidence without actor scoring or time data.
      [proof: telemetry-absent]
- [x] Existing local data is not deleted automatically and the migration note
      states how to remove it deliberately. [proof: telemetry-absent]
- [x] The complete remaining suite passes. [proof: suite-green]
