---
id: TL-133
title: "next selects from the local tree and does not read the branch scan"
type: task
labels: []
board: main
epic: "Agent-facing differentiators"
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
estimate: 2h                       # 30m | 2h | 1d | 1w | 1mo
created: 2026-09-01
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs: []
verification:
  - id: two-trees
    bash: "node --test scripts/tests/next-cross-branch.test.mjs"
  - id: docs-say-clone
    manual: "In two worktrees of one repository: a task taken on a side branch does not come out of `worktrail next` in the main checkout, and the message names the branch; after `cross_branch_state: false` the same setup hands it out; README.md and `worktrail instructions autonomous-loop` say \"clone\", not \"machine\""
---

## Goal

`worktrail next` stops handing out a task that ANOTHER branch or another
worktree already says is in progress. Today the selection reads only files
from the current tree, while `query`, `stats` and the viewer also read the
branch scan (TL-73) — so the command that is the ONLY one that writes
anything knows less than the ones that only read.

## Context

This is not theoretical. CLAUDE.md describes a run from 2026-09-01: TL-74
closed at 13:41 on one branch, at 13:43 a second session got the same task
from `next`, because in its tree the task still had status `pending`. The
reservation does not catch this — the lockfile is keyed by `git rev-parse
--git-common-dir`, so it excludes sessions running SIMULTANEOUSLY in
worktrees of one clone, not state recorded on someone else's branch. The
branch scan is exactly the missing piece of information and it already
exists: `scripts/branch-scan.mjs`, controlled by the `cross_branch_state`
and `active_branch_days` keys.

Mind the boundary, because the shape of the solution depends on it: the scan
reads LOCAL refs, never `git fetch`. So it solves the case of multiple
worktrees and multiple branches of one clone, not two machines.
Documentation (`README.md`, the `autonomous-loop` topic in `instructions`)
today says the boundary is the machine — and that is to remain true, only
moved to the right place.

Decisions to be made in the task, not upfront:

- Whether a mismatch (`pending` here, `in_progress` elsewhere) should
  EXCLUDE the task from the pool, or only push it to the end, like the
  group recovered from TL-104.
- What about cost: the scan is paid for on every `next`, and the autonomous
  loop calls `next` repeatedly. `cross_branch_state: false` must leave
  today's behavior unchanged, explicitly.

## Pre-flight reading

1. `scripts/next-task.mjs` — `selectCandidates()`; this is where the
   selection happens and today it has not a single reference to the scan.
2. `scripts/branch-scan.mjs` — what the scan returns and what it costs.
3. `scripts/task-select.mjs` — `parseTaskRecord()` sets `elsewhere: []`, and
   `allStatuses()` shows how `query` merges local state with state from
   elsewhere.
4. `backlog/tasks/TL-73-*.md` — why the scan was built and what it
   deliberately does not do.
5. `scripts/tests/cross-branch-state.test.mjs` — the scan's existing test
   coverage.

## Steps

1. Wire the scan into `selectCandidates()` behind `cross_branch_state`, with
   the "exclude" vs. "push to the end" decision made and JUSTIFIED in the
   code.
2. A refusal/skip has to NAME the branch and status that decided it —
   silent skipping looks like an empty queue.
3. Update the guarantee boundary in `README.md` and in the
   `autonomous-loop` topic (`scripts/instructions.mjs`): today both say
   "machine", after the change the truth will be "clone".
4. Test on two worktrees of one repository: a task in progress on a side
   branch does not come out of `next` in the main checkout. Positive
   control: with `cross_branch_state: false` the same setup hands the task
   out.

## Acceptance criteria

- [x] `next` does not hand out a task that is in progress on another
      ACTIVE branch or in another worktree. [proof: two-trees]
- [x] The reason for skipping names the branch and status, it is not
      silent. [proof: two-trees]
- [x] `cross_branch_state: false` leaves today's single-tree behavior
      unchanged. [proof: two-trees]
- [x] The guarantee boundary in `README.md` and in `instructions
      autonomous-loop` says "clone", not "machine". [proof: docs-say-clone]
- [x] A test on two worktrees with a positive control when the scan is
      disabled. [proof: two-trees]
</content>
