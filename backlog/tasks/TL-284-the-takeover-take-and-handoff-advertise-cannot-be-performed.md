---
id: TL-284
title: "The takeover take and handoff advertise cannot be performed"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2
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
verification:                      # HOW to check the task is really done
  # TL-260 measured this contract against an unchanged tree: its only entry was
  # `suite-green`, which passed before any work had been done, so nothing here
  # could fail for this task. The first entry now names the file written FOR
  # this task, and it fails against the tree it was written on — `take` had no
  # `--take-over` flag, so every takeover case exited 2 on an unknown flag. The
  # suite stays as the second entry: a route through both gates can break
  # neighbours (`next`, `run`, `handoff`) this one file does not exercise.
  - id: takeover-route
    bash: "node --test scripts/tests/takeover.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

When `take` or `handoff` refuses a task because its owner or its live
reservation names another actor, it tells the reader to "take it over
deliberately — not silently", and `take` even names the way: by editing the
file. Following that instruction to the letter does not work. The owner is
only the FIRST gate; `handoff-task.mjs` then reads the lock and refuses
again on `held.actor !== actor`, so editing the owner moves the refusal from
one line of the message to the next. The advice has to become either a
route that exists or a message that does not promise one.

## Context

Measured on 2026-09-05 while TL-150 was being handed from the spec hand to
the dev hand. The loop had claimed the task as `agent:fleet` (via `next`,
which took a 120-minute reservation); the charter told the hand to hand it
on as `agent:spec`. In order:

    $ branchling handoff TL-150 --to-role dev --actor agent:spec --reason "…"
    ✗ branchling handoff: TL-150 is in_progress, owner: agent:fleet
      It is theirs to hand on. Ask them, or take it over deliberately — not silently.

    $ branchling take TL-150 --actor agent:spec --role spec --reason "…"
    ✗ branchling take: TL-150 is already in_progress, owner: agent:fleet
      Ask them, or take it over deliberately by editing the file — not silently.

    # owner: edited by hand, then recorded with `branchling history --actor agent:spec`
    $ branchling handoff TL-150 --to-role dev --actor agent:spec --reason "…"
    ✗ branchling handoff: TL-150 is held by agent:fleet
      since 2026-09-05T11:44:03.111Z, pid 29710 on <this machine>

The hand gave the takeover back and handed off as `agent:fleet`, which
attributes one hand's work to another — the exact thing the namespace rule
and the attribution work (TL-214) exist to prevent. The only routes left
were both bad: delete another actor's reservation by hand, which
`releaseLock` refuses to do for a documented reason, or run the command
against a different `BACKLOG_STATE_DIR` so no lock is found, which is the
same way round the guard under a longer name.

**This is not "the lock is wrong".** TL-87's reservation is what stops two
sessions being handed one task, and an actor mismatch is a real signal. What
is wrong is that two gates guard the same door and only one of them has a
documented way through, while the message promises a way through both.

**Three shapes an answer could take**, and the decision is which:

1. A flag on `take` — `--take-over`, refused without `--reason` — that
   crosses BOTH gates and writes the takeover as an event. The reservation
   is handed over rather than deleted, so the session that
   held it finds out.
2. `handoff` accepts an actor the lock does not name when the OWNER field
   matches it, on the ground that a hand edit plus `branchling history` is
   already the deliberate act the message asked for.
3. Neither, and the messages stop advertising a route: `take` drops "by
   editing the file", and both messages say that a live reservation can only
   be waited out or released by the session that holds it.

The pipeline case is the one that matters: a charter that names a role's
actor cannot hand a task on while the dispatcher holds it under its own.
TL-271 exports the actor to the run; this is the other half of the same
seam, and TL-231 is the failure mode when a handoff cannot complete.

## Pre-flight reading

1. `scripts/handoff-task.mjs` — the two gates, `other-owner` then `locked`
2. `scripts/take-task.mjs` — the same refusal, and the message that names
   the file edit as the way out
3. `scripts/lock.mjs` — why `releaseLock` will not drop another actor's
   lock, and what a transfer would have to preserve
4. `backlog/history/TL-150.jsonl` — the two `owner` changes the hand made
   and gave back, with their reasons

## Steps

1. Decide between the three shapes above and record it with `branchling
   decide` before writing anything.
2. Implement it, including the event the takeover writes if it is 1 or 2.
3. Make the refusal messages say only what the code will actually allow.
4. Cover it in `scripts/tests/`: a task owned and locked by one actor,
   handed on by another, and the positive control that an actor with no
   claim at all is still refused.

## Acceptance criteria

- [x] A refusal from `take` or `handoff` names only routes that exist: the
      command each message prints is run verbatim and reaches a handed-off task,
      and neither message still says "by editing the file".
      [proof: takeover-route]
- [x] The takeover crosses BOTH gates: a task whose `owner:` names the taker
      while the reservation names somebody else is taken over, and the lockfile
      afterwards names the taker rather than having been deleted.
      [proof: takeover-route]
- [x] A takeover is refused without a reason (exit 2, nothing written) and
      leaves a `__takeover__` event naming the actor taken from and the actor
      taking. [proof: takeover-route]
- [x] Positive control: an actor that holds neither the owner field nor the
      reservation is still refused without the flag, by both `take` and
      `handoff`, so the new route narrows something real. [proof: takeover-route]
- [x] The rest of the suite still passes, including the neighbours that share
      `takeTask()`. [proof: suite-green]
