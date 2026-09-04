---
id: TL-235
title: "An elsewhere badge fires for branches already merged into main"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P0
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-04
updated: 2026-09-04
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: merged-is-silent
    bash: "node --test scripts/tests/elsewhere-merged-branches.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
  - id: guards-green
    bash: "node scripts/cli.mjs check"
---

## Goal

The `elsewhere` badge names places where a task really is in another state. A
branch already merged into `main` is not such a place, and must not raise one.

## Context

Observed in the viewer on 2026-09-04. TL-122's card carried ELEVEN badges:

```
claude/autonomous-flow-tasks-35273f: pending    tl-194-undocumented-flags: pending
claude/next-10-backlog-tasks-91bb8e: pending    tl-200-report-tells-truth: pending
claude/next-10-backlog-tasks-ce5ce1: pending    tl-206-plan-queue-agrees: pending
claude/tl-169-ccb689: pending                   tl-212-vouch-park: pending
claude/tool-names-github-e23e35: pending        tl-214-role-pipeline: pending
```

Five of those are branches merged into `main` earlier the same day; their
worktrees were removed and the refs stayed. `branch-scan.mjs` reads every local
ref, finds the task at its older state there, and reports a disagreement. There
is none: those commits are ancestors of `main`.

WHY IT MATTERS AND WHY IT GETS WORSE. The badge exists to stop a second session
taking work somebody else is doing — CLAUDE.md's TL-74 story. A signal that
fires for every merged branch stops meaning anything exactly when the fleet
grows, and it grows monotonically: every run adds refs.

The worktree badge is unaffected and was proven correct in the same session
(TL-122's vouch): a live `take` in another worktree reached the open page.

## Steps

1. A ref whose commit is an ancestor of the current branch cannot disagree with
   it. `git merge-base --is-ancestor <ref> HEAD` answers per ref, once.
2. Silence it in `branch-scan.mjs`, so `query`, `plan`, `next` and the viewer
   all inherit the fix from one place rather than four.
3. `scripts/tests/elsewhere-merged-branches.test.mjs`: a fixture with one merged
   and one unmerged branch holding the same task at an older state. The positive
   control is the unmerged one, which must STILL be reported — a test that only
   proves silence would pass for a scanner that reports nothing.

## Decisions

**Not "delete the branches".** Tidying refs is the user's business and would
make the tool depend on a habit. The scan can answer this from git.

**Ancestry, not name.** A branch called `tl-…` is not evidence of anything; a
commit reachable from `HEAD` is.

## What raised this to P0

Filed as a viewer nuisance. It is not one: it stops the dispatcher.

On 2026-09-04, with wave 4 holding exactly one open task, a `--plan` run took
nothing and `next` explained why:

```
1 candidate(s) are in another state on another branch or worktree
  · TL-206 skipped — tl-206-plan-queue-agrees: blocked, tl-214-role-pipeline: in_progress
```

Both of those branches were merged into `main` earlier the same day and both
worktrees were removed. Their commits are ancestors of `HEAD`; they hold no
second opinion about anything. The fleet was blocked by its own dead branches,
and would have been blocked on every later run — the refs only accumulate.

`git for-each-ref --merged HEAD` answers this in one call, for every ref at
once, which is why the fix belongs in `branch-scan.mjs` and not in each caller.
A live worktree is a separate source and keeps reporting: what is dropped is a
merged REF, not a tree somebody is standing in.
