---
id: TL-704
title: "Page functions of the viewer are a module a mutation run can mutate"
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
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-11
updated: 2026-11-12
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: viewer-suites-green
    bash: "node --test scripts/tests/actor-shape-diagnosis-readers.test.mjs scripts/tests/viewer-storage-keys.test.mjs scripts/tests/mutation-template-text.test.mjs"
---

## Goal

Functions of the viewer's page script (startEdit() and its neighbours) live in a module Stryker parses and build-viewer.mjs inlines by source, so a mutation run over a change to one produces and judges mutants there.

## Context

Since TL-657, scripts/mutation-run.mjs reports template-literal text instead of letting it read as covered: a `--changed-lines` or `--files` range inside the page script of scripts/build-viewer.mjs is refused with `nothing to mutate: every line asked for is template-literal text`, and a whole-module run prints `not mutated (template-literal text): scripts/build-viewer.mjs (3685 lines)` — about 3685 of its 4193 lines on 2026-11-11. That makes the gap visible; it does not close it. The page script is the text of the template `buildHtml()` returns (it opens at `<script>` near line 1968), and its only guard is tests that execute the built page, such as scripts/tests/actor-shape-diagnosis-readers.test.mjs running startEdit() in node:vm. The pattern for closing it already exists: `readModuleSource()` inlines scripts/viewer-url.mjs and scripts/task-fields.mjs into the page with `export` stripped, so the browser and node --test run the same code and Stryker mutates it as a module. Moving the page functions out has to deal with what the template interpolates into them at build time (`${…}` values such as the storage prefix and config-derived data), which is why this was not done inside TL-657. A first slice may move only the editing functions (startEdit and what it calls) rather than the whole script.

## Steps

1. Inventory the `${…}` interpolations inside the page script and decide how each reaches the extracted code (a page constant declared before the inlined module, or a parameter)
2. Move a first group of page functions into a module under scripts/ that the page inlines via readModuleSource(), keeping the built page byte-equivalent in behaviour
3. Confirm with `node scripts/mutation-run.mjs --plan --changed-lines` over a change to a moved function that the range is no longer reported as template-literal text

## Acceptance criteria

- [x] The moved page functions behave as before and the classification test still holds [proof: viewer-suites-green]
