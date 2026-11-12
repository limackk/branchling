---
id: TL-713
title: "A mutation run terminated by a signal removes its work directory"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-11
updated: 2026-11-11
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: signal-cleans-up
    bash: "node --test --test-name-pattern=\"terminated by a signal\" scripts/tests/mutation-run.test.mjs"
---

## Goal

A mutation run that is terminated by a signal removes its work directory and kills its Stryker child, as a run that returns does.

## Context

scripts/mutation-run.mjs runStryker() creates a work directory with mkdtempSync(join(tmpdir(), "mutation-run-")) and removes it in a `finally` block, and sweeps leftover processes only after spawnSync returns. A run cut off by `timeout 1800` (SIGTERM), which the supervised-loop instructions wrap every mutation run in, dies without running either: on 2026-11-11 a chunked run of mutation-run.mjs over lines 313-404 was cut at 30 minutes (exit 124) and its /tmp/mutation-run-* directory, holding a full sandbox copy of the repository, stayed behind; six such directories were present in /tmp that afternoon. spawnSync also blocks the event loop, so a SIGTERM handler in the parent cannot run until Stryker returns; the fix likely needs an async spawn (or a detached Stryker in its own process group) plus SIGTERM/SIGINT handlers that kill the group, sweep with sweepLeftovers(work + sep), and remove the work directory.

## Steps

1. Reproduce: start a run with a fake Stryker (runStryker's injectable binary) that sleeps, send SIGTERM to the run, and observe the work directory and the child remain
2. Make the run handle SIGTERM and SIGINT by killing Stryker's process group, sweeping, removing the work directory, and exiting with the signal's conventional code
3. Add the test in scripts/tests/mutation-run.test.mjs with a positive control

## Acceptance criteria

- [ ] a run terminated by SIGTERM leaves neither its work directory nor a process naming it [proof: signal-cleans-up]
