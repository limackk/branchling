---
id: TL-127
title: "A task with closed blockers stays blocked and never leaves next"
type: task
labels: []
board: main
epic: ""
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:session
estimate: 4h
created: 2026-09-01
updated: 2026-09-02
blocked_by: []
blocks: []
related_docs: []
verification:                      # HOW to check the task is actually done
  - id: unblocked-is-issuable
    bash: "node --test scripts/tests/unblocking.test.mjs"
---

## Goal

A task whose every `blocked_by` entry is closed stops being invisible to
`worktrail next`. After the change the queue hands out work that is genuinely
ready, without a human manually editing the status.

## Context

Measured on 2026-09-01, after TL-94 was closed: THREE tasks (TL-95, TL-96,
TL-101) have status `blocked`, and EVERY one of their blockers is already
`done`. None of them will come out of `worktrail next`, because the
dispatcher skips statuses protected by `reason_required_statuses` (here:
`blocked`, `cancelled`) — rightly so, since entering `blocked` is a decision
that an agent has no right to silently reverse. The net effect, though, is
that ready work sits in a queue nobody will service, while looking blocked.

This is the same class of defect as an unmerged branch: a state that looks
current but isn't. The distinction matters: `blocked_by` is a FACT computable
from the tree (a blocker is closed or it isn't), while `status: blocked` is a
human's DECLARATION. Today nothing guards the drift between them.

One thing has to be decided and it is a design decision, not an
implementation detail:

- **Who clears `blocked`.** Candidates: `done`, when closing a blocker (it
  knows `blocks:`, but would then write to SOMEONE ELSE'S task file), a
  separate command (`worktrail unblock`, explicit and auditable), or NOBODY —
  `next` stops skipping `blocked` once `blocked_by` is fully closed, and
  clears the status itself at issuance time, the same way it sets
  `in_progress` today.
- **Whether `blocked` with an empty `blocked_by` is a different case.** A
  task blocked "externally" (waiting on someone else's decision) has nothing
  to clear and MUST still be skipped — otherwise this change would start
  handing out work that cannot actually be done.
- **A trace in history.** Clearing `blocked` is a status change and must land
  in `history/` with an actor and a reason; the reason is the blocker's
  closure, not "unknown".

The third option looks best, because it does not write to someone else's file
in someone else's commit and does not require anyone to remember an extra
command — but that is a hypothesis to test in this task, not a foregone
conclusion.

## Pre-flight reading

1. `scripts/next-task.mjs` — `queueStatuses()` and `selectCandidates()`:
   exactly where protected statuses are excluded and where `blocked_by` is
   checked.
2. `scripts/done-task.mjs` — what `done` already knows about `blocks:` when
   closing.
3. `scripts/history.mjs` — `requiresReason()`: the rule talks about ENTERING
   a status that requires a reason; leaving one is undocumented today.
4. `backlog/config.yaml` — `reason_required_statuses`; these are project
   VALUES, so the solution must not hardcode `blocked` into the code.

## Steps

1. Decide who clears the status, and record the rejected options in this
   file.
2. Implement it; the status name should come from configuration, not a
   literal.
3. Test `scripts/tests/unblocking.test.mjs`: a `blocked` task with closed
   blockers IS issued by `next`, a `blocked` task with an open blocker is
   NOT, a `blocked` task with an empty `blocked_by` is NOT (positive control
   for external blocking), and the status change has an entry in `history/`
   with an actor.
4. Review the three tasks named in the context — after the change they
   should be issuable.

## Acceptance criteria

- [x] `next` issues a `blocked` task whose blockers are all closed. [proof: unblocked-is-issuable]
- [x] `next` STILL skips `blocked` with an open blocker, and `blocked` with an
      empty `blocked_by`. [proof: unblocked-is-issuable]
- [x] Clearing the status leaves an entry in `history/` with an actor and a
      reason other than `unknown`. [proof: unblocked-is-issuable]
