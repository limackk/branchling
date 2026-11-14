---
id: TL-745
title: "A suite run leaves no fixture directory in the temporary directory"
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
created: 2026-11-14
updated: 2026-11-14
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: suite-leaves-nothing
    bash: "T=$(mktemp -d) && TMPDIR=$T node --test scripts/tests/*.test.mjs >/dev/null 2>&1; n=$(ls -A $T | grep -c '^branchling-'); rm -rf $T; test \"$n\" -eq 0"
  - id: guard-test
    bash: "node --test scripts/tests/fixture-dir.test.mjs"
---

## Goal

A suite run, a supervised loop's suite runs and a mutation run leave no `branchling-*` fixture directory behind in the temporary directory, including the ones made through `fixtureDir()` in `scripts/tests/_fixture-dir.mjs`.

## Context

Measured on 2026-11-14 after run wf_5282982e-9c1 (three supervised loops, 13 tasks, every task running the full suite and a changed-lines mutation run): /tmp held 393 `branchling-*` directories, all written between 09:43 and 12:25 CET that day. By prefix: 256 `branchling-run-plan-waiting-*` (scripts/tests/run-plan-waiting.test.mjs:118), 56 `branchling-test-cgroup-*`, 40 `branchling-test-mutation-*`, 28 `branchling-test-run-*`, 4 `branchling-test-fixture-state-*` and a few `branchling-unblock-*` (scripts/tests/unblocking.test.mjs:61). Every one of those call sites already goes through `fixtureDir()`, whose process `exit` hook is supposed to remove what the process made, so the hook is not running or not succeeding in at least one path. Candidates to rule in or out, by measurement and not by reading: a test process killed by a signal (SIGKILL from a Stryker timeout or from the 4 GiB RLIMIT_DATA cap; `exit` does not fire on SIGKILL, and SIGTERM/SIGINT are not handled); a removal that throws because a spawned CLI child still writes into the tree; a directory made by a CLI the test spawns (it inherits TMPDIR but not the hook). Separately, the loop coordinators improvised `TMPDIR=~/.cache/tl-coordinator-tmp` and `~/.cache/tl-coord-tmp` when /tmp was short, and those two directories had grown to 449 MB each with the same fixtures (deleted by hand on 2026-11-14); a leak there is the same leak in a different TMPDIR. The helper's header deliberately refuses to sweep by pattern, because a concurrent run in another worktree owns directories with the same prefixes; the fix must keep that property.

## Steps

1. Reproduce: with an empty TMPDIR of its own, run `node --test scripts/tests/run-plan-waiting.test.mjs` and count `branchling-*` entries left; repeat with the process killed mid-file (SIGTERM and SIGKILL) and under the 4 GiB RLIMIT_DATA cap.
2. Find which path leaves each prefix measured above and fix it at its cause: handle SIGTERM/SIGINT in `_fixture-dir.mjs`, make the removal tolerate a still-running child, or route the directories a spawned CLI makes through a TMPDIR the test owns and removes.
3. Where SIGKILL makes in-process cleanup impossible, have the test process create its fixtures under ONE per-process parent directory, so the leftover of a killed process is a single directory that names its PID, not hundreds of top-level entries.
4. Add a guard test that runs a fixture-making file in a child with its own TMPDIR, including a run killed by SIGTERM, and asserts that nothing is left; give it a positive control that proves the count would see a leftover.

## Acceptance criteria

- [x] a full suite run leaves no branchling-* directory in its TMPDIR [proof: suite-leaves-nothing]
- [x] a guard test, with a positive control, fails when a fixture-making process (also one stopped by SIGTERM) leaves a directory behind [proof: guard-test]
