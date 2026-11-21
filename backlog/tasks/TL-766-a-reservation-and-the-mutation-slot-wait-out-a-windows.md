---
id: TL-766
title: "A reservation and the mutation slot wait out a Windows pending release"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-21
updated: 2026-11-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: reservation-pending
    bash: "node --test scripts/tests/lock-takeover.test.mjs scripts/tests/mutation-run.test.mjs"
---

## Goal

A task reservation and the mutation slot wait out a Windows delete-pending EPERM the way withMutex does since TL-765, instead of failing the command.

## Context

TL-765 taught withMutex in scripts/lock.mjs that on win32 an EPERM from createExclusively or readHolder is a release still in progress (releasePending). acquireLock's reservation loop in scripts/lock.mjs and tryAcquireSlot in scripts/mutation-slot.mjs create and read their files with the same primitives and have the same exposure: a holder unlinking its file while another process has it open. Nothing has failed there yet on CI, so this is the same defect seen by reading, not by a run.

## Steps

1. Apply releasePending at the create and the read of the reservation loop and of tryAcquireSlot.
2. Prove each with the interleave seam the way mutex-takeover.test.mjs does, with a POSIX positive control.

## Acceptance criteria

- [ ] a reservation and the slot wait out a pending release on Windows and still throw EPERM elsewhere [proof: reservation-pending]
