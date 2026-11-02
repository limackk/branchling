---
id: TL-526
title: "The viewer shows a body rewrite by its size, not by two hashes"
type: task
labels: []
board: main
epic: "External UI contract"
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
created: 2026-11-02
updated: 2026-11-02
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: viewer-body-entry
    bash: "node --test scripts/tests/viewer-body-history.test.mjs"
---

## Goal

A `__body__` history entry in the browser viewer reads as a body rewrite with the lines added and removed, the way `branchling log` prints it, instead of a from/to transition between two 71-character `sha256:` hashes.

## Context

TL-523 added `branchling body` (scripts/body-task.mjs), which records a `__body__` entry whose `from` and `to` are base-version hashes and whose `lines` field holds {added, removed}. `describeBodyChange(entry, arrow)` in scripts/task-fields.mjs is the one wording, and `log` and `resume` already use it. The viewer (scripts/build-viewer.mjs, history rendering; label `__body__: "task body"` in HISTORY_FIELD_LABELS) still treats the entry as an ordinary transition because `historyEntryKind` returns `transition` when both ends are non-empty, so it prints the two hashes. task-fields.mjs is pasted into the viewer by source, so the function is already available there.

## Steps

1. Find where the viewer renders a history entry by `historyEntryKind`.
2. Render `__body__` entries with `describeBodyChange`, keeping the hashes out of the visible text (a title attribute may carry them).
3. Add a test that builds the viewer over a fixture with a `__body__` entry and asserts the rendered history names the line counts and does not show the full hash.

## Acceptance criteria

- [ ] The viewer renders a body rewrite by its line counts and not by its hashes. [proof: viewer-body-entry]
