---
id: TL-491
title: "run says when the rest of the queue is held in other trees, and can wait for it"
type: task
labels: []
board: main
epic: "Parallel worktree loops"
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-10-27
updated: 2026-10-30
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: wait
    bash: "node --test scripts/tests/run-wait.test.mjs"
---

## Goal

When `run` stops because every eligible task is claimed in another tree of the clone, its report says how many are held elsewhere, and `run --wait <s> [--wait-max <s>]` keeps polling in the foreground until one is free instead of exiting.

## Context

Observed in a downstream repository on the night of 2026-10-26/27: three `branchling run` loops, one per git worktree of one clone, each driven by a wrapper script that merges the base branch into the loop branch before a task and back after it, and pauses every loop on any failure. The loops paused many times in one night. Pain point 8: each pass ended with 'stopped: the queue is empty' while other loops held the remaining tasks, so the supervisor relaunched `run` every 5 minutes with a new actor. `next --json` already returns skippedElsewhere; the planStop comment in scripts/run-loop.mjs (~289) calls waiting a different feature. Foreground waiting keeps TL-381's sequential model.

## Steps

1. Report held-elsewhere counts in the handed.status === 3 branch (~1860).
2. Add --wait and --wait-max with polling while skippedElsewhere or an in-flight plan wave is non-empty.
3. Tests.

## Acceptance criteria

- [x] the report counts tasks held elsewhere and --wait resumes when one is released [proof: wait]
