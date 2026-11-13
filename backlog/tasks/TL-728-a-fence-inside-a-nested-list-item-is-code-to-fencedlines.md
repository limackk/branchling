---
id: TL-728
title: "A fence inside a nested list item is code to fencedLines()"
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
created: 2026-11-13
updated: 2026-11-13
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: fence-in-list-item
    bash: "node --test scripts/tests/criteria-mapping.test.mjs"
---

## Goal

`fencedLines()` in scripts/markdown-fence.mjs recognises a fenced code block opened inside a list item, measured from the item's content column rather than from column 0, so a fence in a nested list item indented four or more spaces is code to all three of its readers: `parseCriteria()` in scripts/criteria.mjs, `demoteHeadings()` in scripts/import-body.mjs and `auditText()` in scripts/check-no-foreign-context.mjs.

## Context

Found while supervising TL-708, which moved the foreign-context guard from a private toggle (any line matching /^\s*```/, at any indentation) onto `fencedLines()`. `fencedLines()` accepts an opening fence only at zero to three spaces of indentation, which is CommonMark's rule for top-level text. Inside a list item CommonMark measures that indentation from the item's content column, so in a nested item such as `  - step` a fence written as four spaces plus three backticks is a valid fence, and `fencedLines()` reads it, and every line up to its close, as prose. The consequences: the foreign-context guard reports a measurement inside such a block as prose (the old toggle did not, so this is the one way TL-708 can report more than before); `parseCriteria()` can take a checkbox or heading-shaped line inside it for part of the contract; `demoteHeadings()` can shift a heading-shaped line that is code. On 2026-11-13 no public document of this repository had such a fence (old and new fence decisions differed on 0 of 755 documents), so the gap is latent, not observed. Not done in TL-708 because its thesis was to make the guard use the shared rule, not to change the rule.

## Steps

1. Decide how far list-item tracking goes: the content column of the innermost open list item is enough for a fence; lazy continuation lines and block quotes are out of scope unless a test shows they matter.
2. Teach `fencedLines()` the list-item content column, keeping its signature (`string[]` in, one boolean per line out) so the three readers do not change.
3. Add cases to the `fencedLines()` tests in scripts/tests/criteria-mapping.test.mjs: a fence inside a nested list item indented four or more spaces is code, and the same fence at four spaces with no list item around it is still not a fence; each with the line after the block shown to be prose again.
4. Run `node scripts/cli.mjs check` before and after and explain any change in what the foreign-context guard reports.

## Acceptance criteria

- [ ] A fence inside a nested list item indented four or more spaces is read as code by `fencedLines()`, and a four-space fence outside any list item is still not a fence. [proof: fence-in-list-item]
