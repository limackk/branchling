---
id: TL-282
title: "A parked task is unparked by the next call, so the stuck status is a no-op"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-05
updated: 2026-09-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  # REWRITTEN BEFORE THE WORK STARTED. `park-holds` named a file that did not
  # exist, and `node --test` ignores a missing path silently, so the whole block
  # was green against an unchanged tree and proved nothing. The file now exists
  # and three of its five tests fail on the old code: the parked task comes back
  # as `in_progress`, the park carries no marker, and the spin guard leaves an
  # owner behind. `decision-recorded` proves the fourth acceptance criterion,
  # which a test suite cannot see.
  - id: park-holds
    bash: "node --test scripts/tests/park-survives-next.test.mjs"
  - id: decision-recorded
    bash: "node scripts/cli.mjs log TL-282 --decisions | grep -q 'MARKER on the transition'"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

A task the run parked stays parked. Today the loop's very next call to
`next` takes it straight back out, and the run ends leaving the task
claimed, a live lock behind it, and a history that reads as though the
parking had been reversed on purpose.

## Context

Measured on 2026-09-05, TL-150, one run, three seconds:

    08:36:50  status  in_progress -> blocked
              "no verification after 2 agent attempts: suite-green: …"
    08:36:50  status  blocked -> in_progress
              "left `blocked`: every task it named is closed (TL-90)"

    stopped: TL-150 was handed out twice to role `spec` — the loop stopped
             rather than spin

Afterwards: `status: in_progress`, `owner: agent:fleet`, and a lock file
naming a process that had already exited.

**Two meanings share one status.** `stuck_status` — where a run parks work
it could not verify — resolves to `blocked` here, and `blocked` is also
what a task waiting on `blocked_by` sits in. `next` reclaims the second
kind on sight (TL-127: a task whose blockers are all closed is dispatched
again, with the evidence in the reason). TL-150's only blocker, TL-90, has
been closed for days, so the moment the run parked it, it satisfied the
unblocking rule and was taken again.

**The park is therefore a no-op for any task with closed blockers**, and
silently: the run reports `1 blocked` and the tree says otherwise. A
project whose `reason_required_statuses` and `stuck_status` name the same
value as the blocker status — this one — cannot park at all.

**The spin guard fires too late.** `seen` is checked AFTER `next` has
already written the claim, so stopping the loop leaves exactly the state
above: an owner, a lock, and a status nobody chose. The guard prevents the
spin and not the damage of one turn of it.

**Not TL-231.** That is `handoff` parking an in-progress task outside the
queue. Here the run parks correctly and the DISPATCHER undoes it.

## Steps

1. Decide, with `branchling ask`, how the two meanings are separated. The
   candidates: a project declares a `stuck_status` distinct from the
   blocker status and `check` refuses the collision; the unblocking rule
   skips a task whose last history entry parked it; the park records a
   marker `next` reads. The third is the only one that works when a project
   has just one open non-queue status.
2. Ask `seen` before `next` claims, not after — or release the claim when
   the guard fires. A loop that stops must leave nothing held.
3. Whatever is decided, `run` must not report `1 blocked` for a task that
   is not.

## Acceptance criteria

- [x] A task parked by a run is still parked after the loop asks for more
      work, proven by a test that fails against today's code, with a
      fixture whose blockers are all closed. [proof: park-holds]
- [x] A loop that stops on the spin guard leaves no claim and no lock.
      [proof: park-holds]
- [x] Unblocking a genuinely blocked task still works, and a task blocked
      with nothing named is still left alone. [proof: park-holds]
- [x] Nothing else in the dispatcher or the loop changed its answer.
      [proof: suite-green]
- [x] The separation of the two meanings is a `__decision__` event in
      `backlog/history/TL-282.jsonl`. [proof: decision-recorded]

## Decided

Recorded with `branchling decide` on 2026-09-21.

**The separation is a MARKER ON THE TRANSITION, not a second status.** The run's
park writes `park: true` on the status entry it records, and TL-127's unblocking
rule skips a task whose LAST transition into its current status carries it. The
marker rides the transition rather than the task, so a person who later declares
the same status themselves writes an unmarked transition and is discharged by
the blocker rule exactly as before — nothing is frozen out of the queue.

**Rejected: a `stuck_status` distinct from the blocker status, with `check`
refusing the collision.** A project with ONE open non-queue status cannot
satisfy it, which is this project, and a guard that tells a backlog to invent a
second vocabulary entry to make the tool work is the tool's problem being
handed to its user.

**Rejected: inferring from the last entry's `source`.** `source: "run"` on a
transition into a protected status would in practice mean a park, and that is
inference standing where a declaration is available. A marker written by the act
that made the decision cannot drift from it.

**The spin guard gives the claim back.** Asking `seen` BEFORE `next` claims is
not available: selection and reservation are one act on purpose (TL-87), so the
loop cannot learn what would be handed out without it being handed out. What it
can do is put back what it was given — the status the task was taken from, the
owner cleared, the reservation released — which it now does before it stops.
