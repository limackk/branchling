---
id: TL-191
title: "The stuck-status write may not overwrite an archived status"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P0
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-09-03
updated: 2026-09-03
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
  - id: guards-green
    bash: "node scripts/cli.mjs check"
  - id: no-overwrite
    bash: "node --test scripts/tests/run-stuck-status.test.mjs"
---

## Goal

When a run gives up on a task, it may park a task it is still holding — it may
never write over a status the project counts as archived. Today
`branchling run` wrote `status: blocked` over a task that was `done`,
committed, and already merged into `main`.

## Context

Measured on 2026-09-03, in this repository, on TL-183:

1. The run handed TL-183 to an agent. The agent did the work, closed it with
   `branchling done` (the contract ran and passed), committed it, and
   fast-forwarded `main`.
2. The loop's own `done` call was refused with `TL-183 is already closed`.
   Because of the field-name defect in TL-190 that refusal was retryable, so a
   second agent was launched against a finished task.
3. After the last attempt the loop wrote the stuck status into the task file.
   The tree then said `status: blocked` for work that was proven, closed and
   published. Restoring it took a hand edit and a `history` entry.

**This is NOT TL-190, and fixing TL-190 does not fix it.** TL-190 stops
`already-closed` from being retried, which removes the path that was taken this
time. It leaves every other path to the same write: any refusal, on any task
that reached an archived status between the take and the last attempt — a
person closing it in another worktree, a merge arriving, a second run. The
guard belongs at the WRITE, not at each of the ways of reaching it.

**Why this is the most serious defect the first runs produced.** Every other
one costs time or tells a lie in a report. This one destroys a fact the tool
had already proven: `done` runs the contract and is the only thing entitled to
say a task is finished, and here the loop overruled that with an opinion formed
from a refusal it had misread. The history keeps both writes, so the log now
carries a `done → blocked` transition that never should have been possible.

**What the rule is.** Before the stuck-status write, re-read the task from
disk. If its status is in `archived_statuses`, do not write: report it, count
it as closed-elsewhere in the run report, and move on. The status the run took
the task in is not evidence of anything by the time the attempts are over —
the file is the truth, and it has to be read again.

## Pre-flight reading

1. `scripts/run-loop.mjs` — the stuck-status write and where the status the
   task was taken in is remembered.
2. `scripts/done-task.mjs` — the refusal envelope, and what `already-closed`
   means.
3. `backlog/tasks/TL-190-*.md` — the retry defect that made this reachable;
   the two are separate and this one must hold even after that is fixed.
4. `backlog/config.yaml` — `archived_statuses`, the vocabulary this guard reads;
   the code must not name `done` itself.

## Steps

1. Re-read the task file immediately before the stuck-status write.
2. Refuse the write when the status is archived; report the task as closed
   elsewhere.
3. `scripts/tests/run-stuck-status.test.mjs`: a fixture where the agent command
   closes the task itself, `--max-attempts 1`, and an assertion that the file
   still reads the archived status afterwards and the report does not call it
   blocked.

## Decisions

Nothing decided. Note that the same re-read answers a second question the loop
does not ask today: whether the task is still owned by this run at all.
