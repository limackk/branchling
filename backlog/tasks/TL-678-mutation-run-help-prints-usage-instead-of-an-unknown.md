---
id: TL-678
title: "mutation-run --help prints usage instead of an unknown argument"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-10
updated: 2026-11-10
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: mutation-run-help
    bash: "node --test scripts/tests/mutation-run.test.mjs"
---

## Goal

`node scripts/mutation-run.mjs --help` prints its usage and exits 0 instead of failing as an unknown argument.

## Context

Observed on 2026-11-10: `node scripts/mutation-run.mjs --help` prints `✗ node scripts/mutation-run.mjs: unknown argument "--help"` and lists only the flag names (--base --files --tests --concurrency --plan --json --named-only --changed-lines), with no word on what any of them does. The parser is in scripts/mutation-run.mjs (the `unknown argument` branch around line 142). A session ran `--named-only` over scripts/doctor.mjs, which selected the whole file (1079 mutants, about four hours), because nothing it could read said that `--changed-lines` exists to narrow the run to the lines the branch changed. Every branchling command answers `--help`; this script, which AGENTS.md tells agents to run, does not.

## Steps

1. Handle `--help` and `-h` in the argument parser: print usage with one line per flag and exit 0
2. Keep an unknown argument a failure with exit 2
3. Add a test asserting --help exits 0 and names every flag the parser accepts, so a new flag without help text fails

## Acceptance criteria

- [ ] mutation-run --help prints usage naming every accepted flag and exits 0 [proof: mutation-run-help]
