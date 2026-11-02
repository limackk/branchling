---
id: TL-530
title: "The viewer carries no residue of the removed history panel"
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
created: 2026-11-02
updated: 2026-11-02
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: viewer-history-residue
    bash: "node --test scripts/tests/viewer-history-residue.test.mjs"
---

## Goal

The viewer page carries no code for the per-task history panel that TL-379 removed: no label table, state, helpers or listeners that serve a history list the page no longer renders.

## Context

TL-379 removed the per-task history panel and /api/history from the viewer, but scripts/build-viewer.mjs still carries its residue: HISTORY_FIELD_LABELS (section 'Task detail'), the historyOpen and historyField keys of the page state, historyLoaded and histTime (section 'History'), and two document listeners (click and keydown on [data-graph-node]) that call openHistory, which is no longer defined anywhere, so they would throw a ReferenceError the moment a graph node existed. scripts/task-graph.mjs (renderTaskGraph) is still pasted into the page by source but never called; whether to delete that module or render the graph again is part of this task's decision and must be recorded. The residue misled TL-526, which was filed on the belief that the viewer still renders history entries. The embedded HISTORY data itself stays: the decision panel reads it.

## Steps

1. Confirm with grep that nothing in the page calls each residual identifier.
2. Remove the residue from scripts/build-viewer.mjs; decide whether task-graph.mjs stays pasted, and record why.
3. Add a test that builds the viewer and asserts the page source names no undefined openHistory and no HISTORY_FIELD_LABELS, with a positive control that the decision panel still receives HISTORY.

## Acceptance criteria

- [ ] The viewer page carries no residue of the removed history panel. [proof: viewer-history-residue]
