---
id: TL-492
title: "Conflict groups keep two loops off tasks that touch the same area"
type: task
labels: []
board: main
epic: "Parallel worktree loops"
priority: P2
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
  - id: groups
    bash: "node --test scripts/tests/next-conflict-group.test.mjs"
---

## Goal

A task can name `conflict_group:` values (e.g. a module), and `next` and `run` do not hand it out while a task of the same group is in progress in this tree or reported elsewhere by the scan; skipped candidates are reported as skippedConflict.

## Context

Observed in a downstream repository on the night of 2026-10-26/27: three `branchling run` loops, one per git worktree of one clone, each driven by a wrapper script that merges the base branch into the loop branch before a task and back after it, and pauses every loop on any failure. The loops paused many times in one night. Pain point 6, the main source of pauses: three loops worked on tasks of the same module at once and collided on the same files and the same database migration numbers, every merge needing a hand resolution. TL-418 (handoff --with files) only records files, it is not a dispatch rule. Group values come from local frontmatter, so the scan needs no change.

## Steps

1. Field spec in scripts/task-fields.mjs and optional vocabulary in scripts/config.mjs.
2. Skip rule in selectCandidates (scripts/next-task.mjs ~648) using local in_progress and elsewhere claims.
3. Report in next --json and run.
4. Tests.

## Acceptance criteria

- [ ] a task whose group is in progress elsewhere is skipped and reported [proof: groups]
