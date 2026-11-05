---
id: TL-519
title: "Viewer gap panel sees planned blockers"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
priority: P1                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:lane-b
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-02
updated: 2026-11-04
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: viewer-blocker
    bash: "node --test scripts/tests/viewer-release.test.mjs"
---

## Goal

The viewer's Release view gap panel reports `planned-blocker-open` exactly as `check --release` does, because it passes the same task fields to `releaseGaps()`.

## Context

`buildReleaseData()` in scripts/release-view.mjs calls `releaseGaps()` with tasks mapped to `{id, status, labels}` only. `planned-blocker-open` reads `priority` and `release`, and since TL-515 `currentRelease()` reads `release` too, so in the viewer no task is ever planned, the current release is always null and the gap can never appear — while `check --release` on the same tree reports it. The gate and the viewer therefore disagree on the same commit, and the viewer's silence reads like a clean answer. Found while implementing TL-515; deliberately not fixed there because it is a viewer change outside that task's thesis.

## Steps

1. Pass `priority` and `release` (and anything else `releaseGaps()` documents in its `tasks` parameter) from the task records in `buildReleaseData()`.
2. Show the current release (`gaps.currentRelease`) in the gap panel, the way `check --release` prints it.
3. Add a test in scripts/tests/viewer-release.test.mjs with a fixture holding an open top-priority task planned for the current release, asserting the gap appears in the built data, and a positive control that `check --release --json` reports the same subject.

## Acceptance criteria

- [x] The viewer's gap panel reports the same planned-blocker-open gap and current release as check --release on one fixture. [proof: viewer-blocker]
