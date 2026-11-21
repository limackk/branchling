---
id: TL-761
title: "A mutation run on macOS sets no data cap it cannot set"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1h
confidence: medium                 # how much you trust the estimate
created: 2026-11-21
updated: 2026-11-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: sandbox-runs
    bash: "node --test --test-name-pattern='bounded command|sandbox copied without .git|already is a repository|data cap right before|unit a reader would write|states its memory cap' scripts/tests/mutation-run.test.mjs"
---

## Goal

A mutation run on macOS runs its tests instead of failing every test command at `ulimit -d`. Today `npm run mutation` on macOS cannot judge a single mutant, and three tests of mutation-run.test.mjs are red on every macOS job of the test workflow.

## Context

TL-726 put `ulimit -d <KiB>` in front of every test command (sandboxCommand in scripts/mutation-run.mjs) and documented the cap as advisory on macOS, on the belief that macOS accepts RLIMIT_DATA and ignores it. Measured on 2026-11-21 on Darwin 27 and on the GitHub macOS runners: `sh -c 'ulimit -d 4194304'` fails with 'cannot modify limit: Invalid argument' while `ulimit -H -d` reports unlimited, so the hard-limit check passes and the command then dies before node starts. Fix: on darwin the command sets no data cap, and the line the run prints says that the cap asked for is not set there and why. The value stays in the run's options, so `--memory-cap` keeps one meaning and the in-process tests still see what was asked for. Rejected: `ulimit -d N 2>/dev/null || :` on every platform, which would let a Linux shell that refuses the cap run uncapped with nobody told — the failure TL-726 exists to prevent. Git Bash on the Windows runner refuses `ulimit -d` the same way, so win32 sets no cap either; whether a mutation run can work on Windows at all is a separate task.

## Steps

1. Give sandboxCommand and strykerConfig a platform parameter defaulting to process.platform; on darwin push no `ulimit -d` step.
2. Make memoryCapReport on darwin say the cap is not set and why, and the --help line say 'not set on macOS'.
3. Update the module header comment that called the cap advisory on macOS.
4. Pin the platform in the tests that assert the command text, and add a darwin case that asserts no ulimit step.

## Acceptance criteria

- [x] the sandbox command runs its tests on this platform, and the cap's text and command hold for linux and darwin alike [proof: sandbox-runs]
