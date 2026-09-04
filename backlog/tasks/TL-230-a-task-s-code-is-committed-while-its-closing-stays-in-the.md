---
id: TL-230
title: "A task's code is committed while its closing stays in the working tree, so next hands it out again"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:dev
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-03
updated: 2026-09-04
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: the-divergence-is-named
    bash: "node --test scripts/tests/check-task-state-committed.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

`branchling check` reports a task whose file in the working tree disagrees with
the same file at `HEAD`, so a session can see — before it asks for work — that a
closing has not travelled with its branch yet. Today nothing does, and `next`
hands out a task whose work is already committed.

## Context

Measured on 2026-09-03 in the `tl-214-role-pipeline` worktree. Three tasks were
closed or advanced and their CODE was committed, while the state change to the
task file itself was left in the working tree:

| task   | code commit | `status:` at `HEAD` | `status:` in the tree |
|--------|-------------|---------------------|-----------------------|
| TL-214 | `b784f2c`   | `in_progress`       | `done`                |
| TL-180 | `97ca7c7`   | `pending`           | `done`                |
| TL-187 | `c905879`   | `pending`           | `in_progress`         |

The consequence is not hypothetical: TL-187's production change landed in
`c905879` at 22:21, and at 20:29 UTC (`backlog/history/TL-187.jsonl`) `next`
handed TL-187 to a second session, which took it, found the suite already green
and had nothing to do. The task file said `pending`, and the task file is the
only thing `next` reads.

CLAUDE.md already records this failure mode across BRANCHES — "on 2026-09-01
TL-74 was closed at 13:41, and at 13:43 a second session was handed the same
task" — and answers it with "merge into `main` and close the worktree". That
answer does not reach this case: here the divergence is between the working tree
and `HEAD` of the SAME branch, so there is nothing to merge yet and no worktree
to remove. The work was committed; only the record of the work was not.

**Why the tool can see this and a rule cannot.** "Commit a task closed by
`branchling done` together with its entry in `backlog/history/`" is a
convention, and a convention is checked by the person who already forgot it. But
a task file whose committed `status:` differs from the one on disk is a fact
`git show HEAD:<path>` answers in one call, per task, and `check` already does
exactly this class of comparison: it reads git to report history logs that are
untracked, and counts logs with no task in this tree apart from them, "because
this is somebody's other branch, that is somebody's missing commit, and one
number would hide both".

**This is a report, not a failure.** An uncommitted state change is the normal
condition of a session that is still working — `take` writes it at the start.
`check` exits 0 for it and says which tasks are in that state, the way it already
does for stale `## Log` sections. A guard that failed here would fail every
session mid-task.

## Pre-flight reading

1. `scripts/check-backlog.mjs` — the `history:` section that compares logs
   against git is the shape to follow: same question, one file over.
2. `scripts/tests/history-tracked.test.mjs` — how a check that consults git
   builds its fixture, including a tree that is not a repository at all.
3. CLAUDE.md, "After the commit: merge into `main` and close the worktree" —
   the cross-branch half of this defect, already written down; this task is the
   same-branch half it does not cover.

## Steps

1. Read each task file at `HEAD` and compare its `status:` and `owner:` with the
   working tree; report the ones that differ.
2. Decide what a tree outside git, or a task file git has never seen, means —
   neither is a divergence, and both have to be silent rather than counted.
3. Write the test first: a fixture repository with one committed task, changed
   on disk, and the assertion that `check` names it. A test that cannot fail
   today is the mistake TL-182 made.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence.

- [x] `check` names a task whose `status:` on disk differs from its `status:` at
      `HEAD`, and exits 0 while doing so. [proof: the-divergence-is-named]
- [x] A task file that git has never seen, and a backlog outside a git
      repository, produce no report — the absence of a commit is not a
      divergence. [proof: the-divergence-is-named]
- [x] The test fails against the current code, established before the fix.
      [proof: the-divergence-is-named]
- [x] Nothing else in the suite changed. [proof: suite-green]
