---
id: TL-735
title: "The suite writes no lock state into the developer's real state directory"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-3
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 3h
confidence: medium                 # how much you trust the estimate
created: 2026-11-13
updated: 2026-11-14
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: no-state-leak
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

A run of the default suite writes nothing into the developer's real state directory: every CLI a test starts resolves its lock state (scripts/lock.mjs, BACKLOG_STATE_DIR or the XDG state directory) to a temporary directory that the test owns.

## Context

Measured 2026-11-13 11:50 CET: the real state directory's locks/ subdirectory holds 37,571 directories and 57,294 files, 372 MB in total. Of the 1,203 files written that day, 1,202 belong to fixture repositories under the OS temp directory (for example a `/tmp/branchling-ledger-*/.git` common dir); the one exception is a real claim in this repository. Each run of the suite therefore adds several hundred reservations that nothing ever removes, and the directory a real session reads its locks from grows without bound. TL-432 closed the same defect only for tests that start a server, so the remaining writers are the other tests that spawn the CLI against a fixture repository without setting BACKLOG_STATE_DIR. The tests that assert lock behaviour on purpose already point the state directory at a fixture; the leak comes from tests for which the lock is a side effect.

## Steps

1. Find the spawning tests that do not set BACKLOG_STATE_DIR (or XDG_STATE_HOME) for the child, and give each a temporary state directory, preferably through one shared helper beside scripts/tests/_repo.mjs rather than per-file environment code.
2. Add a guard that fails when a test run leaves a lock naming a tree under the OS temp directory in the state directory the guard points HOME/XDG_STATE_HOME at, with a positive control that a deliberate write IS detected.
3. Do not delete the developer's existing state from code or tests; say in the commit body how a person can clear what earlier runs left behind.

## Acceptance criteria

- [x] the guard passes on the full suite: no lock under the guarded state directory names a fixture tree, and its positive control detects a deliberate write [proof: no-state-leak]
