---
id: TL-716
title: "A mutation plan for mutation-run.mjs returns without timing nested Stryker runs"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-2
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 3h
confidence: medium                 # how much you trust the estimate
created: 2026-11-12
updated: 2026-11-13
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: plan-bounded
    bash: "node --test scripts/tests/mutation-run.test.mjs"
---

## Goal

`npm run mutation -- --named-only --changed-lines --plan` on a change to scripts/mutation-run.mjs prints its plan in minutes, not after more than 30.

## Context

On 2026-11-12 (TL-686, loop 3) `timeout 1800 npm run mutation -- --named-only --changed-lines --concurrency 2 --plan` for a change to scripts/mutation-run.mjs was killed by the timeout (exit 124) without printing anything. `--named-only` selects every test file naming mutation-run.mjs, which includes scripts/tests/mutation/subprocess-kill.test.mjs, changed-lines.test.mjs and no-orphan-processes.test.mjs: they start REAL Stryker runs, deliberately outside the default glob. `--plan` times one run of the selection (`timeTests` in scripts/mutation-run.mjs), and those nested runs also compete for the machine-wide mutation slot (scripts/mutation-slot.mjs, TL-681), because `timeTests` hands them `strykerEnv` without the slot token. So the module that implements the mutation run cannot be measured by it at all, and even `--plan`, whose job is to say a run will not fit, never returns. Options to weigh: exclude test files outside the default glob (scripts/tests/*.test.mjs) from `--named-only` selection unless named with `--tests`; or bound the timed run and report the estimate as at least that bound.

## Steps

1. Reproduce: a fixture where the only tests naming the module include one under scripts/tests/mutation/ that is slow, and show --plan waiting on it
2. Decide and implement the selection or timing rule
3. Test it

## Acceptance criteria

- [x] --plan for a module named by the real-run tests returns without running them in full [proof: plan-bounded]
