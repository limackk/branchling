---
id: TL-624
title: "The doctor and proofs tests pass on Windows"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P1
status: in_progress  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-07
updated: 2026-11-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: windows-tests-portable
    bash: "node --test scripts/tests/doctor-agent-setup.test.mjs scripts/tests/doctor.test.mjs scripts/tests/proofs-reentrance.test.mjs"
---

## Goal

The test workflow's windows-latest job is green on main, so the release procedure's requirement that every job of the test workflow passes holds again.

## Context

Observed on 2026-11-07 in run 42343069037 (main 048929c), job windows-latest / Node 22: 10 failures, all in tests, none in the refusal or doctor logic itself. (1) scripts/tests/doctor-agent-setup.test.mjs, tests 'an edited installed skill is reported, with the refresh that names it', 'an older packaged version is reported with a plain refresh, which names no file', 'several skills and files are each named, joined so they stay readable', 'a directory in place of the installed SKILL.md is a warning that names it, not a crash' and 'only the paths that are not files are named, and a regular file beside them is not': the regular expressions spell the skill path as `backlog-workflow\/SKILL\.md`, while doctor prints the platform separator (`backlog-workflow\SKILL.md`). Decide whether doctor should name a packaged skill file by its POSIX path (it is an identifier inside the package, as SHIPPED_VERSIONS keys are) or the test should accept the separator; the first is likely right for the short name and the second for the absolute path. (2) scripts/tests/doctor.test.mjs, the four TL-600 tests from 'an unclosed block names the `hooks print` paste and its file, and that repair is callable' onwards: the expected string is built from the long temporary path (C:\Users\runneradmin\...) while doctor prints the 8.3 short form git returns (C:\Users\RUNNER~1\...); compare after realpathSync.native on both sides, or build the expectation from the path doctor resolves. (3) scripts/tests/proofs-reentrance.test.mjs:115, 'a closed contract holding `check --proofs` does not make a proofs run recurse', which already failed on Windows in run 42109341551 (be31720) on 2026-11-05. Windows is not yet a supported platform (the v0.3.0 notes say Linux and macOS; TL-456 is awaiting its vouch), but docs/releasing.md asks for the test workflow green on every job before a tag.

## Steps

1. Fix the five doctor-agent-setup tests, deciding whether the packaged skill path is printed with forward slashes
2. Fix the four TL-600 doctor tests so the expected path survives the 8.3 short form
3. Diagnose the proofs-reentrance failure on Windows from the job log and fix it
4. Prove it with a green windows-latest job on a pushed branch or on main

## Acceptance criteria

- [ ] the three test files pass, and the windows-latest job of the test workflow is green [proof: windows-tests-portable]
