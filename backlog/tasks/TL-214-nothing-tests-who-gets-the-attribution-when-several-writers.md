---
id: TL-214
title: "Nothing tests who gets the attribution when several writers race"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: pending  # pending | in_progress | blocked | done | cancelled
owner: ""
role: dev  # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1d
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
  - id: concurrent-writers
    bash: "node --test scripts/tests/concurrent-attribution.test.mjs"
---

## Goal

A change made while other writers are working on the same backlog is recorded
exactly once, and under the actor who made it. A test proves it with several
writers running at the same time, because that is the only condition under
which it has ever failed.

## Context

Measured on 2026-09-03, three times in one afternoon, on this repository.

**Three writers, one log.** An unattended run writes through `next` and `done`.
A session writes through `history --file`. And `branchling serve` reconciles on
a timer. Nothing coordinates them. The server announced its own share out loud:

    branchling serve: history: 1 change(s) from outside the viewer (author: unknown)   x3

Those three were `TL-208 __created__`, `TL-209 priority` and `TL-210
__created__` — two of them an agent's work, one this session's. Each is now a
line in an append-only log saying nobody made it.

**Worse than a wrong author: no entry at all.** Earlier the same day an
`executor:` change on TL-203 was absorbed into `history/.snapshot.json` with no
log line anywhere. The value is in the snapshot, the log has never heard of it,
and the reason for the change — the thing this project insists travels with the
write — was lost. It did not reproduce on a second attempt, which is exactly
what a race looks like.

**The repair does not scale either.** `--attribute` claims every unattributed
change it can see. In this tree that is 778 of them, almost all somebody else's,
so claiming had to be done one `--file` at a time. A false claim is worse than
an honest `unknown`, so the bulk route is unusable here by design.

**Why it is untested rather than broken.** The mechanism is a single
`.snapshot.json` per backlog and a `reconcile()` that diffs the tree against
it. Whoever runs first records the diff and advances the snapshot; whoever runs
second finds no difference left and correctly reports nothing. Each writer is
right on its own. There is no test anywhere that runs two of them at once —
`grep -rn "concurrent" scripts/tests/` finds nothing about this — so the
behaviour under a race is not a decision anybody made.

**This is not TL-185 and not TL-195.** TL-185 fixed the reference point being
seeded from one task instead of the tree. TL-195 fixes the post-edit hook
reconciling whatever tree the cwd points at. Both are single-writer defects and
both are fixed or scheduled. This is the case where every writer behaves
correctly and the outcome is still wrong.

**Why it stops being an afternoon's curiosity soon.** `run --workers N`
(TL-149) puts several sessions on one machine deliberately, and every open
viewer adds another reconciler. Today the collision needed a person to notice.
With a fleet it is the normal case.

**The test must not need a vendor.** The writers are child processes running
this tool's own commands against a fixture backlog — never `claude -p`, never a
network. A test that depends on an agent CLI cannot run in CI and cannot be
trusted to fail for the reason it claims.

## Pre-flight reading

1. `scripts/history.mjs` — `reconcile()`, `unattributedChanges()`, and where
   the snapshot is written relative to where entries are appended.
2. `scripts/lock.mjs` — the precedent for coordinating sessions on one machine
   (TL-87), including why the reservation is made with `link()` from a
   temporary file and not with `open(wx)` plus a write.
3. `scripts/serve-backlog.mjs` — the reconcile timer, and what it prints when
   it finds a change nobody claimed.
4. `backlog/tasks/TL-185-*.md` and `TL-195-*.md` — the two single-writer
   defects this is NOT.

## Steps

1. Write the test first: N child processes, each changing a different field of
   a different task under its own actor, started together against one fixture
   backlog. Assert that every change has exactly one entry, with the right
   actor, and that none is missing.
2. Run it against today's code and record what it does — a red test here is
   the finding, and its output belongs in Decisions.
3. Only then decide the mechanism. Candidates, none chosen: a lock around
   reconcile on the model of `lock.mjs`; a writer claiming its own diff before
   any timer can see it; a snapshot per writer. Each has a cost and the choice
   belongs in Decisions with the rejected options named.
4. Whatever is chosen, a change made during a race must never end with the
   snapshot advanced and no entry written — losing the author is recoverable
   with `--attribute`, losing the change is not.

## Decisions

Nothing decided. Note the ordering above is deliberate: the test comes before
the fix because the failure did not reproduce by hand, and a mechanism chosen
against a defect nobody can trigger is a guess.
