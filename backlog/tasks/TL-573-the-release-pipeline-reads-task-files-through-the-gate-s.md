---
id: TL-573
title: "The release pipeline reads task files through the gate's record reader"
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
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-05
updated: 2026-11-05
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: one-pipeline-reader
    bash: "node --test scripts/tests/release-status.test.mjs scripts/tests/release-view-one-reader.test.mjs"
---

## Goal

The release pipeline (`deploy status`, the viewer's Release lanes) reads task files through the same record reader as `check --release`, so the lanes and the gap panel of one Release view cannot disagree about a task.

## Context

TL-552 made the viewer's gap panel and `check --release` share one reader: `releaseTaskRecords()` in scripts/release-gaps.mjs, which is `readTaskRecords()` from scripts/task-select.mjs. The lanes of the same view come from `computeStatus()` in scripts/release-status.mjs, which still reads the tree with `readTaskMetas()` from scripts/task-io.mjs — raw `extractMeta()` output, where a missing field is `undefined` rather than the `""` the record reader gives. That is the same class of drift TL-519 and TL-552 dealt with: two parses of one file format inside one page. It was left out of TL-552 because `computeStatus()` also serves `deploy status`, so moving it is a change to a second command's input, not to the viewer.

## Steps

1. Make `computeStatus()` read task records through `releaseTaskRecords()` (or `readTaskRecords()`), adjusting any code that relied on `undefined` for a missing field
2. Assert on one fixture with a task lacking `priority:`, `release:` and `target:` that `deploy status --json` and the Release lanes place it as before, and that the lanes and the gap panel see the same records

## Acceptance criteria

- [ ] `computeStatus()` and the release gate read task files through one record reader, and `deploy status` still places every fixture task [proof: one-pipeline-reader]
