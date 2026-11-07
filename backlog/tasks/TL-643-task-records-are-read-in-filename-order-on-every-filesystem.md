---
id: TL-643
title: "Task records are read in filename order on every filesystem"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-07
updated: 2026-11-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: records-filename-order
    bash: "node --test scripts/tests/task-records-order.test.mjs scripts/tests/release-view-one-reader.test.mjs"
---

## Goal

`readTaskRecords()` in scripts/task-select.mjs returns tasks in filename order on every filesystem, as its doc comment already claims.

## Context

`readTaskRecords()` is documented as "Every task in the tree, in filename order" but does not sort: it keeps the order `readdirSync` returns. On Linux and macOS that order is sorted only because libuv's scandir sorts names with strcmp; on Windows it is the filesystem's own order, which NTFS collates case-insensitively. TL-624 fixed exactly this class of bug for skill files, and TL-573 added an explicit sort in `releaseTaskRecords()` (scripts/release-gaps.mjs) for the release pipeline only, because `readTaskMetas()` in scripts/task-io.mjs, which `computeStatus()` used before, sorted explicitly. About twenty other callers (query, next, take, show, audit, decide, handoff, run-loop, check-backlog-proofs, docs-drift and more) still inherit the platform's order. Once this is done, the sort in `releaseTaskRecords()` is redundant and can be dropped together with its comment, keeping its test in scripts/tests/release-view-one-reader.test.mjs (which reverses `readdirSync` through `syncBuiltinESMExports()`) as the guard.

## Steps

1. Sort the file names inside `readTaskRecords()` by code unit, the order `listTaskFileNames()` in scripts/task-io.mjs already uses
2. Add scripts/tests/task-records-order.test.mjs, which lists a tasks directory backwards (replace `fs.readdirSync`, then `syncBuiltinESMExports()`) and asserts that `readTaskRecords()` still returns filename order; check that it fails without the sort
3. Drop the now-redundant sort in `releaseTaskRecords()` and confirm its ordering test stays green

## Acceptance criteria

- [ ] `readTaskRecords()` returns filename order even when the directory is listed in another order [proof: records-filename-order]
