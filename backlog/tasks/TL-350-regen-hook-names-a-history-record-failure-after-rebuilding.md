---
id: TL-350
title: "Regen hook names a history-record failure after rebuilding"
type: bug
labels: [history, hooks]
board: main
epic: ""                           # free text — the group this task counts towards
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
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: hook-tests
    bash: "node --test scripts/tests/history.test.mjs scripts/tests/cli.test.mjs"
---

## Goal

When `regen-hook` cannot record history after rebuilding views, it exits
non-zero and names the failure. It must never print a successful rebuild as the
only result after a status transition was not recorded.

## Context

Two independent reviews of TL-225 found that `scripts/regen-hook.mjs` spawns
`history-record.mjs` with all output ignored, discards the exit status and then
returns 0. The success path is covered, but a locked or unwritable history path
silently loses the required evidence. This violates TL-225's explicit
alternative: record the status change, or say why it could not be recorded.

The TL-225 fixture also inherits its actor while asserting `agent:claude`, so
the regression test depends on ambient `BACKLOG_ACTOR` or user configuration.
Its snapshot assertion must read the snapshot as well as history to defend
ordering rather than merely test a successful append.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/regen-hook.mjs` — inspect child-process error handling and exit
   semantics.
2. `scripts/history-record.mjs` — preserve its failure messages and exit codes.
3. `scripts/tests/history.test.mjs` — make the TL-225 fixture hermetic and
   assert snapshot ordering.
4. `scripts/tests/regen-hook.test.mjs` — add the end-to-end child failure
   control, or create it if that command lacks a direct test surface.

## Steps

1. Propagate a `history-record` failure from `regen-hook` after retaining its
   diagnostic on stderr.
2. Keep a successful rebuild plus recorded history a successful hook result.
3. Add a failure fixture that proves a history write failure is visible and
   non-zero.
4. Isolate TL-225's actor environment and assert both history and snapshot
   ordering.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] A failed `history-record` invocation makes `regen-hook` fail loudly after
  rebuilding, rather than reporting only success. [proof: hook-tests]
- [x] A successful hook still records the post-seed status transition before
  the snapshot advances. [proof: hook-tests]
- [x] The regression fixtures do not depend on the caller's actor settings.
  [proof: hook-tests]
