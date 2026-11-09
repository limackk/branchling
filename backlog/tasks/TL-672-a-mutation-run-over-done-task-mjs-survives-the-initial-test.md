---
id: TL-672
title: "A mutation run over done-task.mjs survives the initial test run"
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
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-09
updated: 2026-11-09
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: terminal-refusal-test-still-green
    bash: "node --test scripts/tests/run-terminal-refusal.test.mjs"
---

## Goal

A mutation run whose change set includes scripts/done-task.mjs gets past Stryker's initial test run instead of failing it.

## Context

The test "every kind the loop calls terminal is a kind `done` publishes" in scripts/tests/run-terminal-refusal.test.mjs reads the SOURCE of scripts/done-task.mjs with readFileSync and extracts refusal kinds with regular expressions (`"kind"\n);` and `kind: "…"`). Under `npm run mutation` the sandbox copy of done-task.mjs is Stryker-instrumented, so those literals no longer appear in that shape, the extraction finds fewer than four kinds, and the positive-control assertion `the refusal kinds could not be read out of done-task.mjs` fails. Stryker then aborts with `There were failed tests in the initial test run` and mutation-run.mjs reports `Stryker produced no report`. Measured on 2026-11-09 during TL-628, whose change touched one identifier in done-task.mjs: `npm run mutation -- --named-only --concurrency 2` failed this way, and the run had to be narrowed with `--files` to the modules whose logic changed. Any task that edits done-task.mjs hits the same wall. Candidate repairs: read the kinds from an exported constant rather than from source text, or have mutation-run.mjs exclude or read the unmodified source for tests that parse source files.

## Steps

1. Reproduce: `npm run mutation -- --named-only --files scripts/done-task.mjs --concurrency 2` fails in the initial test run
2. Make the test independent of the instrumented source (or make mutation-run hand it the original), keeping its positive control
3. Rerun the reproduction and see Stryker reach the mutant phase

## Acceptance criteria

- [ ] the test still holds the loop and done to one set of refusal kinds after the change [proof: terminal-refusal-test-still-green]
