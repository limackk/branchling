---
id: TL-552
title: "The viewer and the release gate read task records through one reader"
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
estimate: 3h
confidence: medium                 # how much you trust the estimate
created: 2026-11-04
updated: 2026-11-04
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: one-reader
    bash: "node --test scripts/tests/release-view-one-reader.test.mjs"
---

## Goal

The release view's data is built from the same task-record reader that check --release uses, so the viewer and the gate cannot disagree about a task.

## Context

readTasks() in scripts/build-viewer.mjs reads frontmatter with extractMeta(); check --release reads it with parseTaskRecord()/readTaskRecords() in scripts/task-select.mjs. gapTaskOf() in scripts/release-view.mjs works around the difference between the two (found during TL-519). Two readers of one file format drift apart silently.

## Steps

1. Build the release view's task records with readTaskRecords()
2. Remove the workaround in gapTaskOf()
3. Assert that the viewer and the gate produce identical records for one fixture

## Acceptance criteria

- [ ] The viewer's release data and check --release read identical task records from one fixture. [proof: one-reader]
