---
id: TL-149
title: "run --workers N owns the branch lifecycle of a fleet of worktrees"
type: task
labels: []
board: main
epic: ""
priority: P2                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending  # pending | in_progress | blocked | done | cancelled
owner: unassigned
estimate: 1w                       # 30m | 2h | 1d | 1w | 1mo
created: 2026-09-02
updated: 2026-09-02
blocked_by: []
blocks: []
related_docs: ["docs/branchling-state-and-sync.md"]
verification:                      # HOW to check that the task is really done
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
  - id: guards-green
    bash: "node scripts/cli.mjs check"
---

## Goal

`worktrail run --workers N` executes N tasks at once, each in its own
worktree on its own branch, and owns the whole lifecycle the project's
`CLAUDE.md` today describes as a manual procedure: claim, branch
`tl-<n>-<slug>`, worktree, agent session, `done`, fast-forward merge into
`main`, worktree removal, `build`.

Today `run` drives one session at a time in the current tree. The
autonomous-loop guide already names the fleet of worktrees as the audience
and says the loop is three lines of shell that the user owns; this task keeps
that promise for the SINGLE-worker case and adds the bookkeeping the user
cannot write in three lines for the parallel one: which branch each task is
on, which merged, which conflicted, and where the run stopped.

The reason this is possible here and nowhere else is that every element
already exists separately. Selection and reservation are one atomic act, so
two workers never receive the same task. `next` reads every local branch and
worktree, so a task claimed in one worktree is not re-offered from another.
`plan.yaml` gives waves, so a task is not started before its blockers are
merged. And `reason_required_statuses` gives a place to park a merge conflict
WITH its reason instead of losing it. Backlog.md's branch awareness is
read-only and fetch-based, it has no atomic claim, no waves and no status
that demands a reason.

## Context

**The three-line loop stays the contract.** `run --workers 1` must behave
exactly like the loop in `instructions autonomous-loop`: `next` at one end,
`done` at the other, the agent template in between. Parallelism changes
where a session runs, not what a session is. If `--workers` needs `next` or
`done` to behave differently, the design is wrong.

**Ordering comes from `plan.yaml`, not from the dispatcher.** The guide
forbids the loop to filter, sort or re-rank candidates. A worker asks `next`;
`next` already refuses a task whose blockers are not closed. What the fleet
adds is only WHEN a worker asks again: after its previous task merged. A task
whose blocker closed on a branch that has not merged yet is still blocked in
`main`'s copy, and that is correct — merging is the act that closes it for
the rest of the repository.

**Merge is fast-forward or it is a parked task.** `main` moves while a
worker works. If the branch cannot fast-forward, do NOT auto-resolve: park the
task in the protected status with a reason naming the conflicting task ids
(settle by task id, not by file, as `CLAUDE.md` says) and stop offering it
for this run. A merge commit written by a dispatcher is a decision nobody
recorded a reason for.

**The worktree a session stands in is never removed by that session.**
That rule already exists for humans; the dispatcher removes the worktree
only after the session has exited and the branch has merged.

**Locks and session state stay outside the repository** (TL-87). Per-task
agent logs go where `run` already puts them; nothing of the fleet's
bookkeeping lands in `backlog/`.

**Views are rebuilt in `main` after every merge.** They are computed and
unversioned, so after a merge they still show the state from before it.

**What is deliberately NOT here:** starting agents on other machines. The
boundary is the clone, as the guide states, and the fleet lives inside it.
Two clones still hand out the same task and find out when they merge; that
is the hosted mode's problem (§6 of `docs/branchling-state-and-sync.md`).

## Steps

1. Extract the per-task step of today's `run` (claim, agent, `done`,
   attempts) into a unit that takes a working directory.
2. Worktree lifecycle around it: create on claim, remove after merge, never
   from inside.
3. Merge step: `--ff-only`; on failure park with a reason naming the ids.
4. A run report that names, per task: branch, attempts, merged / parked /
   stopped, and where the run ended.
5. Tests against a temporary repository: two workers, three tasks, one
   blocking another; positive control: an induced conflict MUST park, not
   merge.

## Acceptance criteria

- [ ] `run --workers 1` behaves exactly as the documented three-line loop. [proof: suite-green]
- [ ] Two workers never receive the same task. [proof: suite-green]
- [ ] A task is not started until its blockers are merged into `main`. [proof: suite-green]
- [ ] An induced merge conflict parks the task with a reason naming the ids, never merges. [proof: suite-green]
- [ ] A worktree is removed only after its session exited and its branch merged. [proof: suite-green]
- [ ] Views in `main` are rebuilt after each merge. [proof: suite-green]
- [ ] No fleet state is written into `backlog/`. [proof: guards-green]
