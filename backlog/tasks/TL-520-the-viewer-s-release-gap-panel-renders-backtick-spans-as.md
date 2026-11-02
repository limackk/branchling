---
id: TL-520
title: "The viewer's release gap panel renders backtick spans as code"
type: task
labels: []
board: main
epic: "Release tracking across environments"                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 30m                      # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-02
updated: 2026-11-02
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: [docs/release-tracking.md]                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: gap-code-spans
    bash: "node --test scripts/tests/viewer-release.test.mjs"
---

## Goal

The gap panel of the viewer's Release view draws a backtick span in a gap's
text as code, the way the trunk paragraph has done since TL-518, never as a
literal backtick.

## Context

`renderRelease()` in `scripts/viewer-release.mjs` passes each gap's `why`
through `relEsc()` only. The texts come from `scripts/release-gaps.mjs`, which
writes for the terminal and marks values with backticks ("the task is still
`pending`", "closed as `done`"), so the page shows the backticks themselves.
Observed while writing TL-518's viewer test on a fixture with an
`open-task-deployed` and a `done-not-on-trunk` gap.

TL-518 added `relCodeSpans()` in the same file for the trunk's source; the gap
list is the other place that needs it. Rewording the gap texts without
backticks is rejected: the terminal is their first reader, and it would make
`check --release` and the page word the same gap differently.

## Pre-flight reading

1. `scripts/viewer-release.mjs` — `relCodeSpans()`, and the gap list in
   `renderRelease()`
2. `scripts/release-gaps.mjs` — where the texts are written

## Steps

1. Render each gap's text with `relCodeSpans()` instead of `relEsc()`.
2. Assert in `scripts/tests/viewer-release.test.mjs` that a gap whose text
   carries a backtick span renders it as `<code>` and keeps no backtick.

## Acceptance criteria

- [ ] No gap in the Release view shows a literal backtick; its span renders as
  code. [proof: gap-code-spans]
