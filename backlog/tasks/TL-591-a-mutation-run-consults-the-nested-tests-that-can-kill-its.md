---
id: TL-591
title: "A mutation run consults the nested tests that can kill its mutants"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-2
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-06
updated: 2026-11-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: nested-selected
    bash: "node --test scripts/tests/mutation-run.test.mjs"
---

## Goal

The mutation run's test selection consults every test file that can kill a mutant in a changed module, including those in subdirectories of scripts/tests/, and stops selecting files that merely mention cli.mjs.

## Context

`selectTests()` in `scripts/mutation-run.mjs` (TL-576) has two imprecisions, both seen on 2026-11-06:

- UNDER-selection, the dangerous one. It reads only `scripts/tests/*.test.mjs`. `npm run mutation -- --plan --base HEAD~2` on `mutation-run.mjs` selected only `scripts/tests/mutation-run.test.mjs`, which never starts Stryker, and left out `scripts/tests/mutation/subprocess-kill.test.mjs`, the test that exercises `runStryker()`, `summarise()` and the NoCoverage and Timeout handling. Mutants there would be reported Survived although a test kills them: the same class of false score TL-576 was about.
- OVER-selection, a cost only. Rule 3 treats any file whose text contains `cli.mjs` as spawning the CLI. `scripts/tests/mutation-run.test.mjs` was selected for `task-id.mjs` because its fixture writes a file called `cli.mjs`.

The subdirectory is outside the default glob on purpose (CI runs without `npm install`), so selecting from it must not change what `node --test scripts/tests/*.test.mjs` runs. Rule 3 can recognise a spawn of the repository's own CLI by the path the test builds (`join(SCRIPTS_DIR, "cli.mjs")` and similar) rather than by the bare name.

## Steps

1. Select test files from every directory under scripts/tests/
2. Recognise a spawn of the repository's cli.mjs by the path, not the bare filename
3. Extend the scope fixture in mutation-run.test.mjs with a nested test and a fixture that only names cli.mjs

## Acceptance criteria

- [x] A test file in a subdirectory of scripts/tests/ that reaches a changed module is selected, and one that only names cli.mjs without spawning the repository's CLI is not [proof: nested-selected]
