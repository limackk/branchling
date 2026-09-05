---
id: TL-282
title: "A parked task is unparked by the next call, so the stuck status is a no-op"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-05
updated: 2026-09-05
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: park-holds
    bash: "node --test scripts/tests/park-survives-next.test.mjs"
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

- [ ] A task parked by a run is still parked after the loop asks for more
      work, proven by a test that fails against today's code, with a
      fixture whose blockers are all closed. [proof: park-holds]
- [ ] A loop that stops on the spin guard leaves no claim and no lock.
      [proof: park-holds]
- [ ] Unblocking a genuinely blocked task still works. [proof: suite-green]
- [ ] The separation of the two meanings is a `__decision__` event in
      `backlog/history/TL-282.jsonl`.
