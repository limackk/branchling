---
id: TL-231
title: "handoff parks an in-progress task outside the queue it returns it to"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: pending  # pending | in_progress | blocked | done | cancelled
owner: ""
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-04
updated: 2026-09-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: back-in-the-queue
    bash: "node --test scripts/tests/handoff-status.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
  - id: guards-green
    bash: "node scripts/cli.mjs check"
---

## Goal

A task handed to another role lands in a status `next` will hand out. Today an
in-progress task is parked in `blocked`, which is not a queue status, so the
handoff removes the task from the queue it says it returns it to.

## Context

`handoff --help` states the contract:

> A task in progress stops being in progress and returns to the queue

Measured on this repository:

```
$ branchling handoff TL-206 --to-role spec --actor user:limack --reason "..."
  role: (anybody) -> spec
  status: in_progress -> blocked
```

and `queueStatuses(config)` in `scripts/next-task.mjs` answers `['pending']`.
The task was invisible to `next` from that moment, with a `role:` naming a hand
that could never be given it. Nothing failed and nothing warned; the handoff
reported success.

The cause is the status the command derives for "waiting for somebody". This
backlog protects `blocked` and `cancelled` with `reason_required_statuses`, and
`blocked` is the only non-archived candidate — so it is chosen. But `blocked`
means CANNOT MOVE, and a task waiting for a different hand can move the moment
that hand runs. The two senses were conflated because one status happened to be
the only candidate.

Worse, the reason travels with it: the sentence explaining WHO the task now
waits for is written as the reason it is blocked.

## Steps

1. The status a handoff returns a task to must be one `next` will hand out.
   `queueStatuses(config)` already answers which those are.
2. A backlog where no queue status can be reached from the current one must be
   told so, and the handoff must fail rather than park the task out of reach.
3. `scripts/tests/handoff-status.test.mjs`: an in-progress task handed to a role
   is selectable by `next --role <r>` afterwards. The positive control is a
   handoff from a status the command already leaves alone, which must still be
   left alone.

## Decisions

**Not `--status` on every call.** The flag exists for a backlog with more than
one waiting status, and requiring it here would make the common case carry the
uncommon one's ceremony. The default has to be right.

**`blocked` is not a synonym for `waiting`.** A blocked task is one whose
`blocked_by` has not cleared; a handed-off task is waiting for a hand. Writing
one as the other also puts a WHO sentence in the field that answers WHY.
