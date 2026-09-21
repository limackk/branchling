---
id: TL-409
title: "The snapshot section name is computed in one place"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-21
updated: 2026-09-21
blocked_by: [TL-387]               # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs:                      # paths relative to the repository root
  - scripts/snapshot-mutex.mjs
  - scripts/history.mjs
  - scripts/tests/migration-snapshot-race.test.mjs
verification:                      # HOW to check the task is really done
  - id: one-definition
    bash: "test \"$(grep -c 'snapshot:' scripts/*.mjs | grep -v ':0$' | wc -l)\" -eq 1"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

The name of the mutual-exclusion section that guards `history/.snapshot.json`
is computed in exactly one place, and every route that performs the
read-modify-write imports it from there.

## Context

TL-228 put `migrate-prefix` and `renumber` inside that section. They could not
import the name from `scripts/history.mjs`, which computes it privately in
`snapshotSection()` and was being edited on a sibling branch (TL-387) at the
time, so `scripts/snapshot-mutex.mjs` was added with a SECOND copy of the same
computation: `"snapshot:" + realpath(backlogDir)`.

Two modules computing one section name is the shape that switches mutual
exclusion off silently if they ever drift — the name is the whole of the
agreement between the processes. The drift is currently caught only
indirectly, by the timing control in
`scripts/tests/migration-snapshot-race.test.mjs` ("the section the migrations
hold is the one an ordinary writer holds"), which is real evidence but costs a
second and a half of wall clock to obtain.

## Steps

1. Export `snapshotSection` from `scripts/history.mjs` and have
   `scripts/snapshot-mutex.mjs` re-export it rather than recompute it — or move
   the computation into `snapshot-mutex.mjs` and have `history.mjs` import it,
   whichever leaves fewer cycles between the modules.
2. Delete the duplicated body, and the paragraph in `snapshot-mutex.mjs` that
   explains why it was there.
3. Keep the timing control. It stops being a drift guard and becomes what it
   also is: proof that the section really excludes a separate process.

## Acceptance criteria

- [ ] `grep -n 'snapshot:' scripts/*.mjs` returns exactly one line that builds
      the name. [proof: one-definition]
- [ ] The whole suite is green. [proof: suite-green]
