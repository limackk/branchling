---
id: TL-738
title: "The --plan help says it runs the selected tests once"
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
estimate: 1h
confidence: medium                 # how much you trust the estimate
created: 2026-11-13
updated: 2026-11-14
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: plan-wording
    bash: "! grep -nE 'run nothing|without running anything' scripts/mutation-run.mjs AGENTS.md && node --test scripts/tests/mutation-run.test.mjs"
---

## Goal

The help of `--plan` in scripts/mutation-run.mjs and the paragraph on `--plan` in AGENTS.md say what the plan actually does: it runs the selected tests once (TL-682), stopped at the timing limit (TL-716), and starts no Stryker run.

## Context

`--plan` is described as running nothing: the help line in `FLAG_HELP` of scripts/mutation-run.mjs reads 'print the modules, the selected tests, the mutant count and the estimate; run nothing', and AGENTS.md (section 'Mutation runs') says '`--plan` prints the mutant count and the estimate without running anything'. Since TL-682 the plan times one run of the selected tests, and since TL-716 that run may last up to `budget*60 / (1 + ceil(mutants/concurrency))` seconds. A reader who trusts 'run nothing' will not expect a plan to take a minute or to start test processes. Surfaced while supervising TL-716.

## Steps

1. Reword the --plan help line in scripts/mutation-run.mjs to say the selected tests run once, bounded, and Stryker does not start
2. Reword the --plan sentence in AGENTS.md the same way
3. Add or adjust a test asserting the help line no longer claims the plan runs nothing

## Acceptance criteria

- [x] neither the --plan help nor AGENTS.md claims the plan runs nothing, and the mutation-run tests pass [proof: plan-wording]
