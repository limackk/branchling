---
id: TL-708
title: "The foreign-context guard reads fences by the shared CommonMark rule"
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
created: 2026-11-11
updated: 2026-11-11
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: foreign-context-fence-rule
    bash: "node --test scripts/tests/foreign-context.test.mjs"
---

## Goal

The foreign-context guard decides which lines are code by the same CommonMark fence rule as the criteria parser and the importer. Today `fenceState()` in `scripts/check-no-foreign-context.mjs` toggles on any line matching /^\s*```/: it ignores tilde fences, lets any backtick line close a block regardless of length or trailing text, and accepts more than three spaces of indentation. So a body fenced with `~~~` is judged as prose, and a block opened with four backticks closes on an inner three-backtick line, after which code is flagged as prose (or prose after a mis-closed block escapes the guard). TL-669 introduced `fencedLines()` in `scripts/markdown-fence.mjs` as the one implementation for `parseCriteria()` and `demoteHeadings()`; this guard is the remaining copy with a different rule.

## Context

Found while implementing TL-669. Not folded into it because that task's thesis is the criteria parser, and changing what the foreign-context guard treats as prose changes what it reports across the backlog, which needs its own review of the findings before and after.

## Steps

1. Replace `fenceState()` in `scripts/check-no-foreign-context.mjs` with `fencedLines()` from `scripts/markdown-fence.mjs`.
2. Add tests for a tilde fence and for a four-backtick fence containing a three-backtick line, each with a measurement inside the block, plus a positive control that the same line outside a fence is still reported.
3. Run `node scripts/cli.mjs check` before and after and explain any change in what it reports.

## Acceptance criteria

- [ ] A tilde-fenced block and a four-backtick block with an inner three-backtick line are both treated as code by the foreign-context guard, and the same text outside a fence is still reported. [proof: foreign-context-fence-rule]
