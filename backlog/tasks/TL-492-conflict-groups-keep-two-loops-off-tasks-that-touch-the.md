---
id: TL-492
title: "Conflict groups keep two loops off tasks that touch the same area"
type: task
labels: []
board: main
epic: "Parallel worktree loops"
priority: P1
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
  - id: groups
    bash: "node --test scripts/tests/next-conflict-group.test.mjs"
---

## Goal

A task can name `conflict_group:` values (e.g. a module), and `next` and `run` do not hand it out while a task of the same group is in progress in this tree or reported elsewhere by the scan; skipped candidates are reported as skippedConflict.

## Context

Observed in a downstream repository on the night of 2026-10-26/27: three `branchling run` loops, one per git worktree of one clone, each driven by a wrapper script that merges the base branch into the loop branch before a task and back after it, and pauses every loop on any failure. The loops paused many times in one night. Pain point 6, the main source of pauses: three loops worked on tasks of the same module at once and collided on the same files and the same database migration numbers, every merge needing a hand resolution. TL-418 (handoff --with files) only records files, it is not a dispatch rule. Group values come from local frontmatter, so the scan needs no change.

Measured again downstream on 2026-10-29 with three loops: every real code conflict was two loops working in the same module at once (the same manifest, job declarations, tests and migration numbers). The downstream side has since removed the bookkeeping pauses on its own (its wrapper commits claims, pauses only the conflicting loop and names migrations after their task). What remains is this dispatch rule. A backlog of several hundred tasks will not get a new frontmatter field by hand: a task without `conflict_group:` should fall back to a configured default, such as its `epic:` where a project keeps one epic per module, so the rule works on day one.

## Steps

1. Field spec in scripts/task-fields.mjs and optional vocabulary in scripts/config.mjs, plus a config default (`conflict_group_from: epic`, off unless set) used when a task names no group.
2. Skip rule in selectCandidates (scripts/next-task.mjs ~648) using local in_progress and elsewhere claims.
3. Report in next --json and run.
4. Tests.

## Acceptance criteria

- [x] a task whose group is in progress elsewhere is skipped and reported [proof: groups]
- [x] with `conflict_group_from: epic`, a task without the field is grouped by its epic [proof: groups]
