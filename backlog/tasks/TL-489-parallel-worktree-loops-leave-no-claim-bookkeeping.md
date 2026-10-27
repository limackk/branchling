---
id: TL-489
title: "Parallel worktree loops leave no claim bookkeeping uncommitted"
type: task
labels: []
board: main
epic: "Parallel worktree loops"
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-10-27
updated: 2026-10-27
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: gate
    bash: "node --test scripts/tests/run-before-next.test.mjs"
  - id: commit-state
    bash: "node --test scripts/tests/run-commit-state.test.mjs"
---

## Goal

A `run` in one worktree of a clone can be paused and resumed without leaving claim or give-back edits of backlog/tasks/<ID>.md and backlog/history/<ID>.jsonl uncommitted in its tree, so the caller's next merge of the base branch never fails on them, and a paused loop does not claim a task only to give it back.

## Context

Observed in a downstream repository on the night of 2026-10-26/27: three `branchling run` loops, one per git worktree of one clone, each driven by a wrapper script that merges the base branch into the loop branch before a task and back after it, and pauses every loop on any failure. The loops paused many times in one night. Pain point 1: claims are written to the tree on purpose (docs/branchling-state-and-sync.md), but a pause after `next` adds `release` lines; the next merge of the base branch fails on these dirty files and pauses all loops again (cascade). Pain point 2: after each pause the same task was claimed and released again by every new actor. Scope: TL-381 keeps commits and topology with the caller, so add opt-in pieces: (a) `run --before-next <cmd>`, a gate run before `cli(["next", ...])` in scripts/run-loop.mjs (around line 1858) whose non-zero exit stops the run WITHOUT claiming; (b) optional `run --commit-state`, which commits only the task file and its history after each outcome; (c) document in `instructions autonomous-loop` the recipe for a worktree wrapper: call `run --stop` on pause, exit silently so the never-ran path gives the claim back (no release, no kill). The wrapper change itself lives in the downstream repository.

## Steps

1. Add --before-next to run (flag table, help, report reason).
2. Add --commit-state (commit <task>.md and history/<ID>.jsonl only, refuse when other paths are staged).
3. Extend `instructions autonomous-loop` with the parallel worktree recipe.
4. Tests for both flags.

## Acceptance criteria

- [ ] a failing gate stops the run before anything is claimed [proof: gate]
- [ ] after each outcome only the task file and its history are committed [proof: commit-state]
