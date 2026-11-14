---
id: TL-733
title: "A checkbox line at a criterion's continuation column is not a new criterion"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-3
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-13
updated: 2026-11-14
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: continuation-column-checkbox
    bash: "node --test scripts/tests/criteria-mapping.test.mjs"
---

## Goal

A `- [ ]` line written at a criterion's continuation indentation is never read as a new criterion by `parseCriteria()` in scripts/criteria.mjs. This backlog wraps a criterion at six columns (`- [ ] ` is six characters), so an author who puts a code sample inside a criterion at that column writes `      ```md` / `      - [ ] example` / `      ```` and gets a phantom criterion: measured on 2026-11-13 against the TL-709 parser, `- [ ] Shows its shape:` followed by such a sample and `      and ends. [proof: a]` parsed as two items, `Shows its shape: ```md` with no proof and `phantom ``` and ends.` with proof `a`.

## Context

Found while implementing TL-709, which stops a FENCED `- [ ]` line from opening a criterion. The six-column sample is not fenced by the shared rule: `fencedLines()` in scripts/markdown-fence.mjs accepts an opening fence at zero to three spaces only, and TL-728 (pending) extends that to a list item's content column, which for `- [ ] text` is column 2, so a fence at column 6 is four columns past it and stays outside even TL-728's rule. CommonMark agrees that the sample is not a fence there, and also that its `- [ ]` line is not a list item: a line indented four or more columns past the item's content column can neither open a fence nor a list item, and indented code cannot interrupt a paragraph, so the whole sample is paragraph continuation text of the criterion above it. `parseCriteria()` instead matches `/^\s*-\s*\[([ xX])\]/` at ANY indentation, which is why the line becomes an item. The decision this task owns: from which indentation a checkbox line stops being an item. A nested sub-criterion written at two columns (`  - [ ] sub`) is a real list item in markdown and must stay one; the rule has to be stated relative to the open criterion's content column, not as a fixed number. No task in this backlog had a fenced or deeply indented checkbox line inside its criteria section on 2026-11-13, so the gap is latent.

## Steps

1. Decide the rule: a checkbox line indented four or more columns past the open criterion's content column continues that criterion instead of opening a new one; check the decision against CommonMark's list-item rules and record it in the comment above the item loop in `parseCriteria()`.
2. Add tests to scripts/tests/criteria-mapping.test.mjs: the six-column sample above parses as ONE criterion with its proof; a two-column nested `- [ ]` item is still its own criterion (positive control); `applyProofs()` never ticks the six-column line. Watch the first test fail on the parser without the change.
3. Parse every task in backlog/tasks before and after the change and explain any difference.

## Acceptance criteria

- [x] A `- [ ]` line at a criterion's six-column continuation indentation is not returned as an item and is never ticked, while a nested `- [ ]` item at two columns is still read as a criterion. [proof: continuation-column-checkbox]
