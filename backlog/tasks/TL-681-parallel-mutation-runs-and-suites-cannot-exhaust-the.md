---
id: TL-681
title: "Parallel mutation runs and suites cannot exhaust the machine's memory"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-2
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-10
updated: 2026-11-11
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: mutation-slot
    bash: "node --test scripts/tests/mutation-run.test.mjs"
---

## Goal

Two mutation runs on one machine never run at once, and a mutation run's default concurrency is bounded by available memory, so parallel loops stop being killed by the kernel OOM killer.

## Context

On 2026-11-08 (14:02, about 16:00) and 2026-11-09 (09:08-09:13) the kernel OOM killer took down the agent session running supervised loops, once together with the user's systemd manager, D-Bus and PipeWire. Measured then: 411-459 node processes, about 25 GB, with no mutation run at all; `node --test` runs cores-1 files at once, and scripts/mutation-run.mjs defaults to `--concurrency` = cores/2 (defaultConcurrency(), around line 384), 16 Stryker workers each running the selected suite. The loops throttled themselves outside the tool: a `node` wrapper on PATH adding --test-concurrency=4, `flock -w 1800 <lock> timeout 1800 npm run mutation -- --concurrency 4`, cutting four loops to three, `--concurrency 2`. It still OOM'd with the wrapper. Session state outside the repository already has a home: scripts/lock.mjs and the BACKLOG_STATE_DIR / XDG state directory (TL-87).

## Steps

1. Give mutation-run.mjs a machine-wide slot lock in the state directory (not keyed by repository: the memory is the machine's), created atomically like lock.mjs's reservations; a second run waits with a message naming the holder, or is refused with --no-wait
2. Compute the default --concurrency from os.freemem() and a measured per-worker footprint, never above cores/2; print the chosen value and why
3. Stale-lock handling: a holder whose PID is dead is reclaimed, as lock.mjs does
4. Test the lock with two concurrent processes and the default with a stubbed free-memory figure

## Acceptance criteria

- [x] a second concurrent mutation run waits for or is refused the machine-wide slot, and the default concurrency follows free memory [proof: mutation-slot]
