---
id: TL-706
title: "A mutation worker runs a bounded number of test files at once"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-11
updated: 2026-11-11
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: worker-file-concurrency
    bash: "node --test scripts/tests/mutation-run.test.mjs"
---

## Goal

Each Stryker worker of a mutation run runs a bounded number of test files at once, so the memory one worker uses no longer grows with the machine's core count.

## Context

scripts/mutation-run.mjs sandboxCommand() starts each Stryker worker's tests as plain `node --test <files>`, and node runs cores - 1 files at once by default. Measured on 2026-11-11 on a 32-core machine (TL-681): 40 test files at node's default (31 at once) peaked at 4852 MB for ONE worker; the same files at --test-concurrency=4 peaked at 1392 MB. TL-681 sized the default worker count from free memory assuming node's default (chooseConcurrency() in scripts/mutation-slot.mjs, PER_TEST_FILE_BYTES), which is safe but over-budgets every worker and so runs fewer workers than the machine could carry; the parallel loops only stayed inside memory because a `node` wrapper on PATH added --test-concurrency=4. Constraint: `--test-concurrency` exists from Node 20.10 / 21, while package.json declares engines node >=18 and the default suite runs on 18.0, so the flag must be passed only where the running node accepts it, or the run must say what it does otherwise.

## Steps

1. Decide the per-worker file concurrency (a fixed small number or derived from cores / workers) and pass it as --test-concurrency in sandboxCommand() when the node in use supports it
2. Make chooseConcurrency() in scripts/mutation-slot.mjs budget each worker with that number instead of cores - 1, and say so in its reason
3. Update the sandboxCommand test in scripts/tests/mutation-run.test.mjs and add a case for a node without the flag

## Acceptance criteria

- [ ] a worker's test command carries a bounded file concurrency where node supports it, and the default worker count is budgeted with that bound [proof: worker-file-concurrency]
