---
id: TL-504
title: "The viewer shows tasks by deployment stage"
type: task
labels: []
board: main
epic: "Release tracking across environments"
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-11-01
updated: 2026-11-01
blocked_by: [TL-501, TL-502, TL-503]                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: [docs/release-tracking.md] # paths relative to the repository root
verification:
  - id: viewer-tests
    bash: "node --test scripts/tests/viewer-release.test.mjs"
---

## Goal

The viewer has a Release view: one lane per deploy target and one column per stage of that target (closed but not merged, trunk, then each stage from `deploy_targets` in config.yaml), task cards in the stage they have fully reached, a PARTIAL marker on cards split across stages or across the parallel refs of one stage (naming which regions, tenants or release lines hold it), and a gap panel listing what `check --release` would fail on.

## Context

Depends on scripts/environments.mjs and the gap detectors from the same epic. The owner asked for boards in the viewer to control what goes to the test environment and what to production before a launch. A `board:` in this tool is a PARTITION of the backlog (boards.yaml: who or which working context), so environments must NOT become boards: a task moves through environments, it does not belong to one. The Release view is a third axis beside the Tasks and Execution views in scripts/build-viewer.mjs.

The environment state is computed at build time, so the view carries the time of the build and the resolved SHA of each ref in its header; a stale view must say how stale it is. The view respects the existing board, epic and release filters and URL view state. Follow the branchling-viewer skill for palette, dark mode and URL state.

**Decided 2026-11-01 by the owner:** implement against main now. The unmerged branches tl-450-inline-editing and tl-451-dashboard also change scripts/build-viewer.mjs; do NOT touch them — they absorb the conflict when they rebase. Keep the Release view's code in its own functions and, where practical, its own module so that rebase stays small.

## Steps

1. Compute the per-task environment state in scripts/build-viewer.mjs from scripts/environments.mjs and embed it with the resolved SHAs and build time.
2. Add the Release tab, columns, PARTIAL marker and gap panel; keep it usable without JavaScript-heavy layout on narrow screens like the existing views.
3. Add tests for the model behind the view, as the Execution view has.

## Acceptance criteria

- [x] The Release view model places each fixture task in the right stage, marks partial tasks including a task held by only one of two parallel refs, lists the gaps and records the resolved SHA of every ref. [proof: viewer-tests]
