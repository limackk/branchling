---
id: TL-669
title: "A fenced heading cannot pose as the criteria section"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-2
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1h
confidence: medium                 # how much you trust the estimate
created: 2026-11-09
updated: 2026-11-11
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: fenced-criteria-ignored
    bash: "node --test scripts/tests/criteria-mapping.test.mjs scripts/tests/import-body.test.mjs"
---

## Goal

A line inside a fenced code block in a task body is never read as the task's `## Acceptance criteria` section. Today `parseCriteria()` in `scripts/criteria.mjs` scans the body line by line with no notion of fences: the first line matching `CRITERIA_HEADING` wins even when it sits between ``` lines, and the end-of-section rule (`/^#{2,}\s+\S/`) likewise stops at a heading-shaped line inside a fence. A task that quotes the template in a code block before its real criteria section — or an imported issue whose description carries a fenced `## Acceptance criteria` — gets the quoted list as its contract, and `done` ticks the wrong lines.

## Context

Found while implementing TL-640, which demotes every ATX heading of an imported description below `## Goal` (`demoteHeadings()` in `scripts/import-body.mjs`) and restricts `CRITERIA_HEADING` to second-level headings. `demoteHeadings()` deliberately leaves lines inside fences untouched, because they are code, so a fenced `## Acceptance criteria` in an imported description still matches the parser. That is a parser defect for every task body, not an import defect, which is why it was not folded into TL-640. `demoteHeadings()` already contains a fence tracker (CommonMark: up to three spaces, three or more backticks or tildes, closed by the same character at no shorter length) that could be shared rather than written twice. `applyProofs()` writes ticks by the `line` index `parseCriteria()` returns, so line numbering must not change.

## Steps

1. Make `parseCriteria()` skip lines inside fenced code blocks when looking for the criteria heading and for the heading that ends the section.
2. Share the fence rule with `scripts/import-body.mjs` instead of duplicating it.
3. Add a test in `scripts/tests/criteria-mapping.test.mjs` with a fenced `## Acceptance criteria` placed before the real section, and watch it fail on the current parser.

## Acceptance criteria

- [x] A fenced `## Acceptance criteria` before the real section is ignored, and the real section's items and line numbers are what `parseCriteria()` returns. [proof: fenced-criteria-ignored]
