---
id: TL-402
title: "new reserves no number, so two sessions are handed one id"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
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
related_docs: []                   # paths relative to the repository root
verification:
  - id: two-news-differ
    bash: "node --test scripts/tests/new-id-reservation.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

Two `new` calls running at the same moment in different worktrees are handed
two different numbers. Today they are handed the same one, and the collision
only becomes visible at merge time, in a tree neither session ever saw.

## Context

Measured on 2026-09-21, running wave 1 of the plan with one agent per task in
its own worktree. THREE sessions independently filed the same defect and were
each handed a number by the tool:

    TL-397  (worktree tl-plan-guard)   landed on main
    TL-397  (worktree tl-265)          same number, different task
    TL-398  (worktree tl-275)          a third copy, one number later

Two files named `TL-397-*.md` with different slugs, two `backlog/history/
TL-397.jsonl` files with different events. `check` did not fire, because in
each tree the number really was free.

**The scan is not the defect.** `scripts/next-backlog-id.mjs` already reads the
union of every worktree, every local branch and the current tree, exactly as
its header promises, and it is why the third session got 398 rather than a
third 397. The gap is between the answer and its use: `new` computes the
maximum, then writes a file. Any session that computes in that window computes
the same maximum. `scripts/next-backlog-id.mjs` documents the union as the
defence against parallel sessions; a union computed without a reservation
defends against sessions that are STAGGERED, not against sessions that are
CONCURRENT.

**The tool already owns the mechanism.** `scripts/lock.mjs` reserves a task for
one session with `link()` from a temporary file, keyed by `git rev-parse
--git-common-dir`, deliberately outside the repository so every worktree of one
clone shares it (TL-87). Its own comment records why `open(wx)` plus a write was
rejected: the file exists empty between the two steps. A number is the same
kind of claim as a task, on the same clone, and it is the only writing command
that hands out a new identity.

**A guard after the fact is not enough.** `scripts/check-backlog-id-collisions
.mjs` exists and reports duplicates once both files are in one tree. By then
two sessions have written two histories under one id, and `backlog/history/` is
append-only.

## Steps

1. Reserve the number before the file is written, through `scripts/lock.mjs` or
   the same `link()` discipline, keyed the same way so every worktree of the
   clone shares the reservation.
2. Decide what a reservation outlives. A number reserved by a session that dies
   before writing its file must not be lost forever; a number reserved and
   written must never be handed out again. Record the answer with
   `branchling decide`.
3. `scripts/tests/new-id-reservation.test.mjs`: two `new` invocations racing in
   two worktrees of one fixture clone produce two different ids. The test must
   fail against today's code — a serial pair passes today and proves nothing.

## Acceptance criteria

- [ ] Two concurrent `new` calls in different worktrees of one clone are handed
      different numbers, proven by a test that fails against today's code.
      [proof: two-news-differ]
- [ ] A reservation that is never written does not permanently burn a number,
      and the rule that decides this is a `__decision__` event in
      `backlog/history/TL-402.jsonl`. [proof: suite-green]
