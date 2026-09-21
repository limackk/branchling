---
id: TL-73
title: "Task state computed from active branches, not from the current checkout"
type: task
labels: [post-launch]
board: main
epic: "Data integrity"
priority: P1
status: done
owner: agent:claude
estimate: 1d
confidence: medium
created: 2026-08-31
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs:
  - docs/branchling-state-and-sync.md
verification:
  # One entry for the WHOLE file, not one per criterion: every test in it has
  # its own positive control, and a name pattern that matches no test ends up
  # green with zero tests run — proof with no evidentiary force.
  - id: suite
    bash: "node --test scripts/tests/cross-branch-state.test.mjs"
  - id: no-regression
    bash: "node --test scripts/tests/*.test.mjs"
  - id: manual-two-branches
    manual: "In a repo with two branches, where a task is `pending` on main and `in_progress` on feature: `worktrail query --status in_progress` from main shows it and says which branch the state comes from"
---

## Goal

`query`, `stats`, and the viewer show a task's state as seen across ALL active
branches, not only the current checkout — and say explicitly where the state
comes from. After this task, two sessions in two worktrees no longer see two
different backlogs.

## Context

Law I: data travels with the branch. This is an advantage (a task goes
through review) and at the same time the sole weakness of this model: a view
computed from a single checkout LIES about the rest. A task started on branch
`feature/x` is still `pending` on `main`, and `worktrail query --status
pending` will report it as free to take. Exactly the failure mode external
trackers were rejected for, only inverted.

Half the machinery already exists and is battle-tested: `next-backlog-id.mjs`
scans `git worktree list` and `git for-each-ref refs/heads`, and reads tasks
via `git ls-tree` — precisely so as not to assign a number already taken
elsewhere. This task generalizes that same scan from "which numbers are taken"
to "what is a task's state".

Decisions to be made along the way, not up front:

1. **What "active" branch means.** Backlog.md uses a day window since the last
   commit (`activeBranchDays: 30`), with a performance kill switch. Without a
   window the scan grows with the number of dead branches in the repo.
2. **Conflicting states.** When two branches have a different `status` for the
   same task, the tool does NOT silently pick a winner. It shows both and names
   the branches. A silent choice is the same class of bug as a view from a
   single checkout.
3. **Offline work.** The scan reads only local refs. No `git fetch` without
   explicit consent — the tool is meant to work without a network.

## Pre-flight reading

1. `scripts/next-backlog-id.mjs:89-160` — `worktreeRoots()`, `localRefs()`,
   `fromWorkingTree()`. This is code to extract, not to write anew.
2. `scripts/query.mjs` — where tasks enter today and where to plug in the
   second source.
3. `docs/branchling-state-and-sync.md` — what has already been decided about
   state synchronization; do not second-guess it without reason.

## Steps

1. Extract the branch/worktree scan from `next-backlog-id.mjs` into a shared
   module (`scripts/branch-scan.mjs`), without changing `next-id`'s behavior.
2. Add reading of task frontmatter from each active branch (`git ls-tree` +
   `git show`), with the time window from config.
3. Configuration keys in the project layer: the window in days and the scan
   kill switch. An unknown key fails (Law III) — do not add a priority layer.
4. `query` and `stats`: when the state on another branch differs from the
   local one, show both and name the branch. Without the scan (outside a git
   repo) behave as today, with a message.
5. Viewer: the same signal, the same definition of a difference.
6. `scripts/tests/cross-branch-state.test.mjs` — a fixture with two branches
   and a diverging status. The test MUST fail when the scan returns only the
   local state.

## Acceptance criteria

- [x] The branch and worktree scan is in one module, used by both `next-id` and by state reading. [proof: suite]
- [x] A diverging status is shown with the branch name, never resolved silently. [proof: suite, manual-two-branches]
- [x] The activity window and the scan kill switch are project configuration keys. [proof: suite]
- [x] No path does a `git fetch` without the user's explicit consent. [proof: suite]
- [x] Outside a git repository the command works and says the state is local only. [proof: suite]
- [x] The test has a fixture with a real divergence between branches. [proof: suite, no-regression]

## Log

2026-08-31 pending — agent:claude — created from analysis of Backlog.md (github.com/MrLesk/Backlog.md), point 2 (`checkActiveBranches`).
