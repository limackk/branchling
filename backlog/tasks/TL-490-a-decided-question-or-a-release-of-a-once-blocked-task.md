---
id: TL-490
title: "A decided question or a release of a once-blocked task returns it to the queue"
type: bug
labels: []
board: main
epic: "Parallel worktree loops"
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-10-27
updated: 2026-10-27
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: decide
    bash: "node --test scripts/tests/decide.test.mjs scripts/tests/handoff.test.mjs"
---

## Goal

After `ask` then `decide`, and after `release` of a task that was blocked by a question before it was claimed, the task is in a queue status (pending) with no owner, so `next` and `run` hand it out again.

## Context

Observed in a downstream repository on the night of 2026-10-26/27: three `branchling run` loops, one per git worktree of one clone, each driven by a wrapper script that merges the base branch into the loop branch before a task and back after it, and pauses every loop on any failure. The loops paused many times in one night. Pain point 3: ask moved in_progress -> blocked and cleared the owner; `decide --choose 1` (liftQuestionBlock, scripts/decide-task.mjs ~305) called requeueStatus (scripts/handoff-task.mjs ~198), which restores the `from` of the last change, so the task became in_progress with owner ""; `release` then restored blocked. Nothing picks such a task up; it was fixed by editing status to pending and `history --source manual`. Workaround today: `release --status pending`.

## Steps

1. In requeueStatus skip `from` values that are the in-progress status, or a protected status whose question is answered; fall back to queueStatuses(config).
2. Regression tests for ask -> decide and ask -> decide -> release.

## Acceptance criteria

- [ ] decide and release end in pending with no owner [proof: decide]
