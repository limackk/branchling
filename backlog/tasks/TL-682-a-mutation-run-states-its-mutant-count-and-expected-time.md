---
id: TL-682
title: "A mutation run states its mutant count and expected time before it starts"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-1
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-10
updated: 2026-11-11
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: mutation-budget
    bash: "node --test scripts/tests/mutation-run.test.mjs"
---

## Goal

`mutation-run.mjs --plan` reports how many mutants the selection produces and an estimated wall time, and a run whose estimate exceeds a budget is refused unless explicitly allowed.

## Context

A mutation run's cost is visible only once Stryker is running. On 2026-11-09 (loop-3) a whole-file run over scripts/doctor.mjs reported about 7 hours remaining after 6 of 1052 mutants and was killed by PID, sandbox children with `pkill -f /tmp/mutation-run-…/`. On 2026-11-10 `npm run mutation -- --named-only` on the TL-632 branch selected the whole of doctor.mjs (1079 mutants, estimate ~4 h) and was cut by a 30-minute timeout at 125 mutants, settling nothing; `--changed-lines` reduced it to 64 mutants in minutes. --plan today lists the mutated files, line ranges and tests, but no count and no cost. Measured cost on this machine (TL-629): about 2.3 s of wall time per mutant at --concurrency 2 for a five-file selection.

## Steps

1. Have --plan count mutants (Stryker's instrumenter in dry mode, or a run with dryRunOnly) and estimate wall time from the initial test run's duration, mutant count and concurrency
2. Refuse a run whose estimate exceeds a default budget (e.g. 45 minutes) with the remedy `--changed-lines` or `--budget <minutes>`
3. Print the estimate at the start of every run

## Acceptance criteria

- [x] --plan states a mutant count and estimate, and a run over budget is refused naming --changed-lines [proof: mutation-budget]
