---
id: TL-732
title: "A mutant leaving node without a script fails instead of timing out"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-1
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-13
updated: 2026-11-13
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: no-stdin-hang
    bash: "node --test scripts/tests/mutation-run.test.mjs"
---

## Goal

A mutant that leaves a worker's node without a script is Killed, not a Timeout: the test command cannot wait on an open stdin.

## Context

Observed on 2026-11-13 while proving TL-706. `npm run mutation -- --named-only --changed-lines --files scripts/mutation-run.mjs` reported two mutants on the return line of `workerTestArgs()` in scripts/mutation-run.mjs as Timeout: ArrayDeclaration (the whole `["--test", ...]` array becomes `[]`) and StringLiteral (`"--test"` becomes `""`). Both persisted at --concurrency 2 and at --concurrency 1, so they are not the overloaded-machine Timeout the run's warning assumes. Both leave node with no script to run, and node then reads its program from stdin: measured with `sleep 30 | timeout 5 node` and `sleep 30 | timeout 5 node '' --test-concurrency=4 x.test.mjs`, both exit 124, while `node --test '' x.test.mjs` exits 1 at once. The same class predates TL-706 (the `"--test"` literal used to sit inline in sandboxCommand()). Not yet established: WHICH process holds the open stdin. The outer Stryker worker's command is computed by the unmutated run; the mutated code runs inside the tests, most likely in the real nested runs of scripts/tests/mutation/*.test.mjs, whose Stryker command runner executes the mutated sandboxCommand(). scripts/mutation-contain.mjs spawns the test command with `stdio: "inherit"`, so whatever stdin Stryker's command runner hands it reaches node. A Timeout is counted as detected, so the score is unaffected; what is lost is the run's ability to tell a hung mutant from an overloaded machine, and each such mutant costs a full Stryker timeout of wall time.

## Steps

1. Find which process hands the hung node an open stdin (a nested run's command runner, a test's spawnSync, or mutation-contain.mjs itself)
2. Give the test command a closed stdin at that point (for example `stdio: ["ignore", "inherit", "inherit"]` in mutation-contain.mjs), if nothing the tests do reads stdin
3. Add a test in scripts/tests/mutation-run.test.mjs that runs a script-less node command through the containing entry with an open stdin and asserts it ends within seconds
4. Rerun the changed-lines mutation run over workerTestArgs() and confirm both mutants come out Killed

## Acceptance criteria

- [x] a test command whose node is left without a script ends at once instead of waiting on stdin [proof: no-stdin-hang]
