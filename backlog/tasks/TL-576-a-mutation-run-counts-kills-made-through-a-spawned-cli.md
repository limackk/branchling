---
id: TL-576
title: "A mutation run counts kills made through a spawned CLI"
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
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-05
updated: 2026-11-05
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: subprocess-kill-counted
    bash: "node --test scripts/tests/mutation-run.test.mjs"
  - id: changed-files-scope
    bash: "node --test scripts/tests/mutation-run.test.mjs"
---

## Goal

A mutation run measures whether the suite's assertions would notice a change in the code an agent just wrote, and its score is not distorted by the suite's habit of exercising the code through a spawned CLI.

## Context

Line coverage says a line executed; it does not say any assertion would fail if the line were wrong. Most of this repository's code is written and tested by agents in one pass, so a green suite is the evidence a reviewer relies on, and a weak assertion reads exactly like a strong one. Mutation testing is the positive control for the suite as a whole: inject a known defect, see whether anything goes red.

A spike on 2026-11-05 (StrykerJS 10.1.1, Node 24.18, macOS) measured the following on a clone, mutating `scripts/task-id.mjs` against `id-prefix`, `task-filename-shape` and `new-task` tests (116 mutants, concurrency 6):

- There is no dedicated `node:test` runner. `@stryker-mutator/tap-runner` runs `node --test` files, one test file is one test.
- 220 of 266 test files reach the code through `spawnSync(process.execPath, [cli.mjs, ...])`. The ACTIVE mutant does reach those grandchild processes (the instrumented code reads `__STRYKER_ACTIVE_MUTANT__` from the inherited environment), but COVERAGE recorded in them is lost.
- Consequence with the tap runner (`perTest`, and identically with `off`): 43.10%, 22 mutants `NoCoverage`. Those mutants were never run. `prefixMismatchMessage` (lines 136-147) was among them although `id-prefix.test.mjs` executes it through `build`; activating mutant 59 (its body emptied) by hand in the sandbox made that test fail. 2 min.
- The command runner (`testRunner: command`, `coverageAnalysis: off`) runs the listed files per mutant and has no coverage to lose: 53.45%, 0 `NoCoverage`; 10 of the former 22 were Killed, 12 Survived, and 2 mutants on line 117 flipped Survived -> Killed. 3.5 min.
- Real survivors are informative: `prefixMismatchMessage` asserts only `/TASK/` and `/BL/`, so emptying the remediation lines survives; `ANY_HISTORY_FILE` anchors (`^`, `$`, `\d+`) all survive.
- The Stryker sandbox copy fails with `ENOTSUP copyfile` on the directory symlinks under `.claude/skills/`; `ignorePatterns: [".claude"]` avoids it.

The tap-runner number is the trap here: a lower score that LOOKS like missing tests, where the tests exist and were never consulted. The command runner is honest but runs every listed file per mutant, so scope must come from the changed files, not the whole tree.

Deliberately open: whether Stryker becomes a devDependency (the package has none today) or is invoked through `npx` with a pinned version; whether a mutation step belongs in the `prove` gate or stays a manual command.

## Steps

1. Decide how Stryker is obtained (pinned devDependency vs pinned npx) and record why
2. Add a config using the command runner with coverageAnalysis off and .claude ignored
3. Add an entry point that mutates the files changed against main and runs only the test files that import or spawn them
4. Write the positive control: a mutant known to be killed only through a spawned CLI is reported Killed, never NoCoverage
5. Document in AGENTS.md when to run it and how a surviving mutant becomes a test, not a weakened assertion

## Acceptance criteria

- [ ] A mutant reachable only through a spawned CLI is reported Killed by the mutation run, so the score does not undercount the suite [proof: subprocess-kill-counted]
- [ ] The run mutates only files changed against the base branch and fails, rather than reporting a score, when that set is empty [proof: changed-files-scope]
