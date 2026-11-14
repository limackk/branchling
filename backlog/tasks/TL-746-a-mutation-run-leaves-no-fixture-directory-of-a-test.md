---
id: TL-746
title: "A mutation run leaves no fixture directory of a test process it kills"
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
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-14
updated: 2026-11-14
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: [scripts/mutation-contain.mjs, scripts/tests/_fixture-dir.mjs, scripts/mutation-run.mjs]                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: kill-leaves-nothing
    bash: "node --test scripts/tests/mutation/subprocess-kill.test.mjs"
---

## Goal

A mutation run that stops a test command — a Stryker timeout, a `timeTests` cut, or
`scripts/mutation-contain.mjs` reaping its process group — leaves no
`branchling-test-pid<PID>-*` directory in the temporary directory.

## Context

TL-745 made `scripts/tests/_fixture-dir.mjs` remove its fixtures on SIGTERM,
SIGINT, SIGHUP and on the EPIPE that ends a test file whose runner was killed,
and put every fixture a process asks for at the top of the temporary directory
inside ONE directory per process, `branchling-test-pid<PID>-*`. SIGKILL still runs
no code, so a test file killed that way leaves that one directory.

Inside a mutation run every stop IS a SIGKILL: `mutation-contain.mjs` answers
SIGTERM, SIGINT and SIGHUP with `stopProcessTree(child, "SIGKILL")` on the whole
group, and reaps the group with SIGKILL again when its child exits. So the
cleanup TL-745 added never gets a chance under a mutation run, and each test file
stopped there still leaves one directory (measured before TL-745 on 2026-11-14:
40 `branchling-test-mutation-*` and 56 `branchling-test-cgroup-*` among 393
leftovers after one supervised run).

Two directions, not yet chosen: (a) `mutation-contain.mjs` sends SIGTERM to the
group first and SIGKILL only after a short grace period; the cost is that a
mutant which hangs in its SIGTERM handling delays the reap. (b) `sweepLeftovers()`
in `scripts/mutation-run.mjs` removes the `branchling-test-pid<PID>-*` directories
of the PIDs it knows it killed. A sweep by name pattern alone is ruled out by the
header of `_fixture-dir.mjs`: a concurrent run in another worktree owns
directories with the same prefix.

## Pre-flight reading

1. `scripts/tests/_fixture-dir.mjs` — the per-process directory and what each signal does
2. `scripts/mutation-contain.mjs` — the group reap with SIGKILL
3. `scripts/mutation-run.mjs` — `sweepLeftovers()` and `timeTests()`
4. `scripts/tests/mutation/subprocess-kill.test.mjs` — the real-run proof of the kill path

## Steps

1. Measure: run a test file that makes fixtures under `mutation-contain.mjs`, send the wrapper SIGTERM, count what is left in its private TMPDIR.
2. Pick (a) or (b), with the reason in the commit.
3. Extend `scripts/tests/mutation/subprocess-kill.test.mjs` (or a sibling outside the default glob) with a private TMPDIR and an assertion that nothing is left, and a positive control.

## Acceptance criteria

- [x] a test command stopped inside a mutation run leaves no fixture directory in its TMPDIR [proof: kill-leaves-nothing]
