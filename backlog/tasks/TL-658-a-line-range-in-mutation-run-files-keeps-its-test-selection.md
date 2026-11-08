---
id: TL-658
title: "A line range in mutation-run --files keeps its test selection"
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
created: 2026-11-08
updated: 2026-11-08
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: range-selection
    bash: "node --test scripts/tests/mutation-run.test.mjs"
---

## Goal

`node scripts/mutation-run.mjs --files <module>:<start>-<end>` selects the same tests as `--files <module>`, so a line range given by hand narrows what is mutated without emptying the test selection.

## Context

Observed on 2026-11-08, on TL-617. `npm run mutation -- --named-only --files scripts/instructions.mjs:202-247 --plan` fails with `no test file reaches scripts/instructions.mjs:202-247`, while the same command with `--files scripts/instructions.mjs` selects 11 named test files. `plan()` in scripts/mutation-run.mjs passes each `--files` entry both to Stryker's `mutate` (which accepts the `path:start-end` form) and to `selectTests()`, which compares it as a path, so the range suffix makes no test name or import the module. The only workaround is to list the tests by hand with `--tests`, which bypasses the named-only and import-closure selection the run exists to make honest. TL-617 step 3 and TL-648 (automatic changed-line ranges) both depend on the range form; TL-648 builds the ranges itself, this task is about the selection seeing through one.

## Steps

1. In scripts/mutation-run.mjs, strip a trailing `:<start>-<end>` from each `--files` entry before test selection, and keep the entry unchanged for Stryker's `mutate`.
2. Report the range in the `--plan` output, so a reader sees that lines outside it are not mutated.
3. Add a test in scripts/tests/mutation-run.test.mjs: `plan()` with `files: ["scripts/<module>.mjs:1-10"]` selects the same test files as with the bare path, and keeps the range in `modules`.

## Acceptance criteria

- [ ] a `--files` entry with a line range selects the tests its module would, and the range reaches Stryker unchanged [proof: range-selection]
