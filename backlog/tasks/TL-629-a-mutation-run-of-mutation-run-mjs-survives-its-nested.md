---
id: TL-629
title: The nested Stryker test works inside a mutation run
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
conflict_group: [mutation]  # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-07
updated: 2026-11-10
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: nested-stryker-runs
    bash: "node scripts/mutation-run.mjs --files scripts/mutation-run.mjs --concurrency 2"
---

## Goal

A mutation run of scripts/mutation-run.mjs completes with scripts/tests/mutation/subprocess-kill.test.mjs among the consulted tests, and its cost is measured and recorded.

## Context

Since TL-591, selectTests() in scripts/mutation-run.mjs also reads the subdirectories of scripts/tests/, so scripts/tests/mutation/subprocess-kill.test.mjs is selected whenever scripts/mutation-run.mjs or a module it imports (scripts/ui.mjs) changes. That test starts Stryker itself. Every mutant of those modules therefore runs a nested Stryker inside the outer Stryker sandbox. Nobody has measured that: the TL-591 mutation run was narrowed with --tests scripts/tests/mutation-run.test.mjs, so it is unknown whether the nested Stryker is found inside the sandbox (node_modules resolution from the sandbox copy), whether the nested run's own temporary directories collide with the outer one, and how long a full run takes. If the nested run fails, every mutant there is reported Killed for the wrong reason, a false score in the opposite direction to the one TL-576 and TL-591 fixed.

Done means: a full `node scripts/mutation-run.mjs --files scripts/mutation-run.mjs` (no --tests) was run after `npm install`. Its wall time and per-mutant time are recorded in this task. It was confirmed that subprocess-kill.test.mjs kills mutants because of an assertion, not because the nested Stryker failed to start. If it cannot work inside the sandbox, the selection or the test is changed so that it does, or the run refuses to report such mutants as Killed.

## Steps

1. Run `npm install`, then `node scripts/mutation-run.mjs --files scripts/mutation-run.mjs --plan` and confirm subprocess-kill.test.mjs is selected
2. Run the same command without --plan and record wall time, mutant count and per-mutant cost
3. For a sample of Killed mutants, confirm that an assertion in subprocess-kill.test.mjs failed rather than the nested Stryker failing to start
4. If the nested run is broken or prohibitively slow, fix the selection or the test and say why in the commit

## Notes

Measured on 2026-11-09 in loop worktree `loop-1`, three mutation-capable
loops on one machine, one mutation run at a time.

- **Selection.** `--plan` selects five files for `mutation-run.mjs`, among
  them `mutation/subprocess-kill.test.mjs`, `mutation/no-orphan-processes.test.mjs`
  and `mutation/changed-lines.test.mjs`; all three start a nested Stryker.
- **The nested Stryker is found in the sandbox.** Stryker links
  `node_modules` into its sandbox, so `strykerBin()` resolves from the sandbox
  copy; the nested run writes under its own `mkdtemp` directory, so it does not
  collide with the outer one. The initial test run of all five files took 5 s.
- **It was broken for the lowest outer ids.** The nested run inherited the
  outer run's `__STRYKER_ACTIVE_MUTANT__`, and Stryker's command runner starts
  its initial test run with the environment as it finds it, so outer id N
  switched on the fixture's mutant N during the nested initial run. Under ids 0
  and 1, `subprocess-kill.test.mjs` failed 2 of 3 tests and
  `no-orphan-processes.test.mjs` 1 of 4, every one with "There were failed
  tests in the initial test run". A sample run over `summarise()` (lines
  362-385, 28 mutants, judged by `subprocess-kill.test.mjs` alone, report kept)
  showed outer mutants 0, 1 and 2 Killed for exactly that reason. The score did
  not show it: those three were killable anyway, so the counts were identical
  (17 Killed, 11 Survived) with and without the defect.
- **Fixed** by `strykerEnv()` in `scripts/mutation-run.mjs`, which removes the
  inherited id along with `NODE_TEST_CONTEXT`. After it, the same sample shows
  all 17 kills as assertion failures in `subprocess-kill.test.mjs` ("no result
  for lib.mjs", "a survivor outside shout()", "nothing survived, ..."), none as
  a failed nested initial run, and both nested files pass under ids 0 and 1.
  The regression is a unit test in `scripts/tests/mutation-run.test.mjs`. An
  end-to-end one in `subprocess-kill.test.mjs` was tried and dropped: an id
  that file sets for its child switches on the OUTER run's mutant of that
  number, so inside a mutation run it judged mutant 0 instead of the one under
  test.
- **Cost of the whole-file run** (`--files scripts/mutation-run.mjs
  --concurrency 2`, no `--tests`, final code): 811 mutants in 31 min 27 s,
  about 2.3 s of wall time per mutant, or 4.7 s per mutant per test runner.
  557 Killed, 2 Timeout, 252 Survived, 0 NoCoverage; score 68.93%. No process
  naming the worktree was left behind. The run before the refactor into
  `strykerEnv()` gave 810 mutants in 32 min 47 s, 556 / 2 / 252. Not
  prohibitive, so the selection was left as it is. The survivors are TL-676.
- **Not settled here:** `mutation-contain.mjs` is judged only through a nested
  run, where the inner run's ids, not the outer mutant's, reach its
  outer-instrumented copy. That is TL-673.

## Acceptance criteria

- [x] A mutation run of mutation-run.mjs that consults subprocess-kill.test.mjs completes inside the Stryker sandbox [proof: nested-stryker-runs]
