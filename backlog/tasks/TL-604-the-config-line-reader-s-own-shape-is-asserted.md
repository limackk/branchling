---
id: TL-604
title: "The config line reader's own shape is asserted"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-4
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: [config]  # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1h
confidence: medium                 # how much you trust the estimate
created: 2026-11-06
updated: 2026-11-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: unreadable-line-asserted
    bash: "grep -q 'expecting `key: value`' scripts/tests/config.test.mjs"
  - id: config-suite
    bash: "node --test scripts/tests/config.test.mjs"
---

## Goal

The top-level line reader of parseConfigYaml has assertions that fail when its line shape, its unreadable-line message or its value trimming change.

## Context

Found by the TL-592 mutation run (scripts/config.mjs lines 458-507 against config-requires-version, config, config-strictness and declare-requires-version tests). Eleven mutants survived, all in the pre-existing loop of parseConfigYaml in scripts/config.mjs, none in the TL-592 change: the `cannot read ... (expecting key: value)` problem for a line that is not `key: value` (its condition, its block, its message text and its `i + 1` line number), the `^` and `$` anchors and the `\s*` of the key regex, the `/^\s/` skip of an indented line, `raw.trim()` in the blank-line skip, and `m[2].trim()`. No test file in scripts/tests/ asserts the `cannot read` message at all. Some may be equivalent mutants: `!raw.trim()` -> `!raw` (a whitespace-only line is skipped by the indented-line rule anyway) and `m[2].trim()` -> `m[2]` (if every consumer of `inline` trims again); name those rather than chase them.

## Steps

1. Add tests in scripts/tests/config.test.mjs for a top-level line that is not `key: value` (exact problem text and line number), for a line with leading text before a key, and for trailing whitespace after a value.
2. Rerun `npm run mutation -- --files scripts/config.mjs:470-485 --tests scripts/tests/config.test.mjs` and name each remaining survivor as equivalent with its reason.

## Acceptance criteria

- [x] the unreadable-line problem of parseConfigYaml is asserted by its exact text [proof: unreadable-line-asserted]
- [x] the config tests pass [proof: config-suite]
