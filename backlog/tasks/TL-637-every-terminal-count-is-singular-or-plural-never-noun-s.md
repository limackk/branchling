---
id: TL-637
title: "Every terminal count is singular or plural, never noun(s)"
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
conflict_group: [cli-surface]  # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 4h
confidence: medium                 # how much you trust the estimate
created: 2026-11-07
updated: 2026-11-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: no-paren-plural
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

No terminal message counts with a `noun(s)` form; every count is spelled singular or plural through `plural()` in scripts/ui.mjs.

## Context

TL-616 moved doctor's private plural() helper into scripts/ui.mjs (exported) and made `template refresh` use it, so it now says '1 field' / '2 fields'. The same `(s)` style survives in roughly 49 modules under scripts/, for example scripts/check-backlog-vocabulary.mjs line 106 ('N field(s) carry a value outside their vocabulary'), scripts/audit.mjs ('task(s)', 'closing(s)', 'finding(s)'), scripts/build-backlog.mjs ('task(s) with a board outside the registry'), scripts/check-backlog-boards.mjs ('task(s) checked') and the viewer note in scripts/build-viewer.mjs ('unblocks N task(s)'). The helper's own doc comment states why this matters: '1 error(s)' is a programmer's note seen by a user. Find the sites with `grep -rnE '[a-z]+\(s\)[ "`:.,—]' scripts/*.mjs bin/` (code such as `filter((s) =>` is a false match). Tests that assert the current `(s)` wording have to move with the message. The viewer page runs in the browser and cannot import ui.mjs at runtime; it either inlines the choice or gets the helper embedded by build-viewer.mjs. A guard that fails on a new `noun(s)` literal in scripts/ would keep it from coming back; such a guard needs a positive control.

## Steps

1. List every user-visible `noun(s)` site in scripts/ and bin/
2. Route each count through plural() from scripts/ui.mjs (or an inlined choice in the browser-side viewer code)
3. Update the tests that assert the old wording, and add a guard test that fails on a new `noun(s)` message literal

## Acceptance criteria

- [ ] every command counts with a singular or plural word, never `noun(s)`, and a guard keeps it that way [proof: no-paren-plural]
