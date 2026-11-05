---
id: TL-554
title: "The read-only viewer carries no editing or actor state"
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
conflict_group: [viewer]  # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1h
confidence: medium                 # how much you trust the estimate
created: 2026-11-04
updated: 2026-11-05
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: no-edit-state
    bash: "node --test scripts/tests/viewer-no-edit-state.test.mjs"
---

## Goal

The viewer's page state in scripts/build-viewer.mjs has no editing or actor fields unless each has a live reader.

## Context

TL-379 made the viewer read-only, and TL-530 removed the history panel's residue. The page state still declares `editing: null` and `actor: "founder"`, with comments about field editing that name tasks of another project's numbering (BL-1396, BL-1397). They probably have no reader.

## Steps

1. Search the built page for every use of state.editing and state.actor
2. Remove the fields and their comments, or document the live reader of each

## Acceptance criteria

- [ ] The built viewer page declares and reads no editing or actor state. [proof: no-edit-state]
