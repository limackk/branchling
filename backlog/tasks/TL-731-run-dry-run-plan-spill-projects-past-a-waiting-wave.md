---
id: TL-731
title: "run --dry-run --plan --spill projects past a waiting wave"
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
estimate: 3h
confidence: medium                 # how much you trust the estimate
created: 2026-11-13
updated: 2026-11-13
blocked_by: [TL-707]  # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: run-dry-run-spill
    bash: "node --test scripts/tests/run-plan-waiting.test.mjs"
---

## Goal

`run --dry-run --plan --spill` projects the order a live `run --plan --spill` would follow past a waiting wave, instead of being refused.

## Context

TL-707 accepted `--spill` on `run` and passes it to `next --plan`, but refuses it with `--dry-run` (parseRunArgs in scripts/run-loop.mjs: "`--dry-run` claims nothing, so --spill has nothing to act on"), because the dry run calls no `next`: it projects the order wave by wave with `planState`, `selectCandidates` and `projectionWall`, and stops at the first wave where open tasks are not this run's to take. A wave waiting on claims or a merge is exactly such a wall, so the projection cannot show what a spill would draw. The refusal is honest, but an operator cannot preview a `--spill` run. `next --plan --spill --dry-run` already projects ONE spilled hand-out; the multi-wave projection in `run` would need to continue past a wall that `waveWaiting` (scripts/next-task.mjs) calls waiting, into the wave `spillWave` (scripts/plan.mjs) returns, and say so in both renderings.

## Steps

1. In the dry-run branch of scripts/run-loop.mjs, when --spill is given and the wall's wave is one `waveWaiting` calls waiting, continue into the wave `spillWave` returns, naming the spill in the human output and in --json
2. Remove `--spill` from the dry-run refusal list in parseRunArgs
3. Test with a fixture tree: the projection under --spill lists the next wave's tasks, and without --spill it still stops at the waiting wave

## Acceptance criteria

- [ ] a dry run under --spill projects past a waiting wave, and stops there without it [proof: run-dry-run-spill]
