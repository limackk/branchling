---
id: TL-405
title: "red names the task that broke a file, never the one repairing it"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-09-21
updated: 2026-09-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: [scripts/red-owners.mjs, scripts/branch-scan.mjs]
verification:                      # HOW to check the task is really done
  - id: repairing-task-named
    bash: "node --test scripts/tests/known-red.test.mjs"
---

## Goal

`branchling red` names the task that is REPAIRING a failing test file, not
only the one whose commit last broke it — or it says plainly that it cannot,
instead of leaving the reader to assume the one id it printed is the one to
go and talk to.

## Context

TL-276 built `branchling red`: each failing test file comes back with the
task whose commit last touched it, derived from the task id in commit titles
(`scripts/modified-files.mjs`, TL-75). That derivation is deliberate and is
not what this task revisits — a declared list was rejected there because it
goes stale in silence, and that reasoning still holds.

The gap measured on the day TL-276 landed. The tree's single failure was
`scripts/tests/product-boundary-plan.test.mjs`, and `red` reported:

    scripts/tests/product-boundary-plan.test.mjs  TL-378  elsewhere

TL-378 is the task whose commit last touched the file. The task actually
fixing it, in a sibling worktree at that moment, was TL-397 — and `red` had
no way to say so. A hand told "TL-378" will go and read a task that is
closed and has nothing to do with the repair in flight. The answer is not
wrong, but it is half an answer given with the confidence of a whole one,
which is the failure mode this repository keeps naming.

**What the tool already knows.** `scripts/branch-scan.mjs` reads every branch
and worktree of this clone — local refs only, never a fetch — and `next`
already uses it to pass over a task another tree has claimed. A file that is
red here and touched by a commit on a sibling branch is precisely what that
scan can see. The open tasks in THIS tree are also readable: an id `red`
prints is a task with a `status:`, and `TL-378` being archived while
something open blocks on it is information the row could carry.

**What is deliberately NOT the goal.** Do not turn `red` into a guess. If no
branch and no open task can be tied to the file, the row must keep saying
what it says today rather than inventing a repairer. And the cross-branch
scan costs real time, so it belongs behind a flag or behind the same
`cross_branch_state:` key `next` honours — a one-second answer must not
become a ten-second one for every caller.

## Pre-flight reading

1. `scripts/red-owners.mjs` — `attributeFile()` and `verdictFor()`; the
   module header states the decision this task must not undo.
2. `scripts/branch-scan.mjs` — what a scan of the clone's branches and
   worktrees can report, and what it costs.
3. `backlog/history/TL-276.jsonl` — the `__decision__` event: attribution is
   derived from commit titles, never declared.

## Steps

1. Decide what a second id in a row MEANS, and record it with
   `branchling decide`: the task currently open against the file, the branch
   that touches it, or both. A row with two unexplained ids is worse than a
   row with one.
2. Implement it so that the default `red` stays as cheap as it is now.
3. Extend `scripts/tests/known-red.test.mjs` with a fixture whose file is
   broken by one task and touched on a sibling branch by another, and a
   positive control where no such branch exists and the row is unchanged.

## Acceptance criteria

- [ ] A failing file broken by one task and under repair by another reports
      both, and which is which. [proof: repairing-task-named]
- [ ] With nothing repairing it, the row is byte-identical to today's.
      [proof: repairing-task-named]
