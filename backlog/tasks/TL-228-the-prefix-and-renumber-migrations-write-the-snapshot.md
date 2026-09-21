---
id: TL-228
title: "The prefix and renumber migrations write the snapshot outside the mutex"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-03
updated: 2026-09-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: migration-snapshot-race
    bash: "node --test scripts/tests/migration-snapshot-race.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

Every route that loads `history/.snapshot.json`, changes it and writes it back
runs inside the same mutual exclusion, so that a migration cannot be erased by
a writer that overlaps with it — nor erase one.

## Context

TL-214 put `reconcile()` and `recordEdit()` in `scripts/history.mjs` inside
`withMutex()` (`scripts/lock.mjs`), keyed by the realpath of the backlog
directory, because two overlapping writers each saved a snapshot computed
before the other's advance and the log then described transitions nobody made.
Its test is `scripts/tests/concurrent-attribution.test.mjs`.

Two routes were deliberately left outside that section, because TL-214's test
does not exercise them and widening a fix past its proof is a guess:

- `scripts/migrate-prefix.mjs` (around line 212) — `loadSnapshot`,
  `applyIdMigrations`, `saveSnapshot`.
- `scripts/renumber.mjs` (around line 363) — the same three calls.

Both rewrite the ids of the whole tree and then repoint the snapshot's keys. A
`history` run, a `take` or the viewer's reconcile timer overlapping with either
of them saves a snapshot keyed by the OLD ids over the repointed one; the next
reconcile then reads the whole backlog as deleted and recreated, which is
exactly the failure TL-111 introduced `applyIdMigrations` to prevent.

Whether the answer is `withMutex()` around those three calls or a wider section
covering the file renames as well is the open question: a migration that holds
the mutex for the length of a whole-tree rewrite makes every other writer wait,
and `MUTEX_WAIT_MS` is 10 seconds. A migration is also the one act during which
a concurrent writer is arguably wrong to be running at all, so refusing may be
better than waiting.

## Pre-flight reading

1. `scripts/lock.mjs` — `withMutex`, `MUTEX_STALE_MS`, `MUTEX_WAIT_MS`, and why
   the mutex is keyed by the backlog and not by the repository.
2. `scripts/history.mjs` — `snapshotSection()` and the two call sites already
   guarded.
3. `scripts/tests/concurrent-attribution.test.mjs` — the shape of a race test
   that fails for the reason it names, including why the writers are child
   processes and why there is a barrier.

## Steps

1. Write the failing test first: a migration and a plain writer started
   together against one fixture backlog, asserting the snapshot afterwards is
   keyed by the NEW ids and the writer's change is recorded.
2. Decide between waiting and refusing, and name the rejected option.
3. Apply it to both call sites — they are the same defect twice.

## Acceptance criteria

- [x] A migration racing a writer leaves a snapshot keyed by the new ids, and
      the writer's change in the log. [proof: suite-green]
