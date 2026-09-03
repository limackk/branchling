---
id: TL-191
title: "The stuck-status write may not overwrite an archived status"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P0
status: in_progress  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
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

**The guard sits inside `blockTask`, not at its caller.** `blockTask` already
reads the task record from disk to find the file it is about to write, so the
re-read the rule asks for is the one that was there — no second read, and no
window between "check" and "write" for the two to disagree. Putting it in the
loop instead would have left the exported function willing to do the thing the
task says must be impossible, and it is exported precisely so that other callers
may appear.

**The refusal is a distinct outcome, not a warning.** `blockTask` answers
`{ ok: false, reason: "closed-elsewhere", status }` and the loop counts it in
its own column: `closed-elsewhere` in the task rows, `closedElsewhere` in the
`--json` tally, and `N closed elsewhere` on the terminal only when it happened.
Reusing the existing `!blocked.ok` branch would have printed a warning and left
the task uncounted — the same lie in prose that the refused write would have
been in the tree. The row is marked with the ok symbol, because the task IS
closed and the run's whole part in it was declining to write over that.

**The vocabulary is read, never named.** The guard tests `config.archivedStatuses`
and there is no literal `done` in it; a test in
`scripts/tests/run-stuck-status.test.mjs` moves `done` OUT of a fixture's
`archived_statuses` and asserts the write then lands, which is what makes that
claim falsifiable rather than a comment.

**Nothing was done about the retry path.** TL-190 stops `already-closed` from
being retried and is still open; this guard holds with or without it, and the
test reaches the write through exactly that path, so fixing TL-190 will change
which refusal the fixture produces but not what the tree says afterwards. If
TL-190 ever makes `already-closed` return `closed` instead of falling through to
the write, this test has to keep asserting on the FILE — that assertion is
independent of which branch the loop took.

**The ownership question is not answered here.** The same re-read could ask
whether the task is still owned by this run at all, and deliberately does not:
that refusal has a different reason, a different report line and an undecided
definition of "still ours". It is TL-192.
