---
id: TL-709
title: "A fenced checkbox line cannot pose as a criterion"
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
estimate: 1h
confidence: medium                 # how much you trust the estimate
created: 2026-11-11
updated: 2026-11-11
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: fenced-item-ignored
    bash: "node --test scripts/tests/criteria-mapping.test.mjs"
---

## Goal

A `- [ ]` line inside a fenced code block within the `## Acceptance criteria` section is never read as a criterion. TL-669 taught `parseCriteria()` in `scripts/criteria.mjs` to skip fenced lines when looking for the section heading and for the heading that ends it, but the item loop still matches `/^\s*-\s*\[([ xX])\]/` on every line of the section, fenced or not. A criterion that illustrates its own shape in a code sample therefore adds a phantom criterion, and `applyProofs()` may tick a line inside the code block.

## Context

Found while reviewing TL-669, whose thesis was fenced HEADINGS only. `fencedLines()` in `scripts/markdown-fence.mjs` already computes which lines are code; the item loop has the `code` array in scope. Open question for the implementer: a fenced line inside a multi-line criterion should probably stay part of that criterion's text range (its `endLine`) rather than close it, so that the criterion's own continuation lines are unaffected.

## Steps

1. In `parseCriteria()`, do not start a new item on a line that `fencedLines()` flags as code.
2. Add a test in `scripts/tests/criteria-mapping.test.mjs` with a fenced `- [ ]` line inside the real section, watch it fail on the current parser, and add a positive control that the same line outside the fence is still an item.

## Acceptance criteria

- [ ] A fenced `- [ ]` line inside the criteria section is not returned as an item, and `applyProofs()` never ticks it. [proof: fenced-item-ignored]
