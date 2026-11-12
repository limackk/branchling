---
id: TL-686
title: "A mutation run's report can be kept and its timeouts are listed by line"
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
created: 2026-11-10
updated: 2026-11-12
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: mutation-report
    bash: "node --test scripts/tests/mutation-run.test.mjs"
---

## Goal

A mutation run lists Timeout mutants with file and line as it lists survivors, and `--keep-report <path>` preserves Stryker's mutation.json.

## Context

scripts/mutation-run.mjs removes its work directory (rmSync(work) around line 581), including Stryker's mutation.json, and prints only survivors. Agents needing the Timeout mutants or the mutants on specific lines tried to read /tmp/mutation-run-XXXX/mutation.json afterwards and got ENOENT four times (2026-11-07 14:07, 15:10, 16:14; 2026-11-08 08:44).

## Steps

1. Print Timeout mutants with file:line and mutator, like survivors
2. Add `--keep-report <path>` copying mutation.json there before the work directory is removed
3. Test both

## Acceptance criteria

- [x] timeouts are listed by line and --keep-report preserves the report [proof: mutation-report]
