---
id: TL-743
title: "the run projection's spill judges blocked wave tasks by the caller's filters"
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
estimate: 1h
confidence: medium                 # how much you trust the estimate
created: 2026-11-14
updated: 2026-11-14
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: projection-respects-filters
    bash: "node --test scripts/tests/run-plan-waiting.test.mjs"
---

## Goal

The `run --plan --spill` projection decides a wave is waiting with the same filter-aware judgement `next --plan` uses since TL-741, so a blocked wave task the caller's role, executor or size filters reject does not let the projection draw past that wave.

## Context

TL-741 made `waveWaiting` in scripts/next-task.mjs take an `admitted` set (returned by `selectCandidates`) and count a blocked task as `behind` only when the set holds it; `next --plan` passes it. The projection in scripts/run-loop.mjs (around the TL-731 comment "A WALL `next --plan --spill` WOULD DRAW PAST") still calls `waveWaiting(w.tasks.map((e) => e.id), closedByRun(planIds), config, [])` without it, so with `admitted` null it judges blockers alone: a wave [A claimed elsewhere, B blocked by A, role: review] projected for `run --plan --spill --role dev` may be treated as waiting and spilled past, while the live `next` answers `nothing-to-take` and the run stops. Surfaced while implementing TL-741; deliberately left out of it.

## Pre-flight reading

1. `scripts/next-task.mjs` — `selectCandidates` (`admitted`) and `waveWaiting`, and the TL-741 header paragraph
2. `scripts/run-loop.mjs` — the projection loop that calls `selectCandidates` per wave and then `waveWaiting`
3. `scripts/tests/plan-waiting-behind-role.test.mjs` — the fixture shape TL-741 used

## Steps

1. Confirm the projection's verdict differs from the live `next --plan --spill --role dev` on the fixture above
2. Pass the `admitted` set of the same `selectCandidates` call into the projection's `waveWaiting`, checking that the records it judges (`closedByRun`) do not make the set stale
3. Add a case to scripts/tests/run-plan-waiting.test.mjs: the dry-run projection with `--spill --role dev` does not spill past the wave, and with `--role review` it does

## Acceptance criteria

- [x] the run projection's spill does not treat a wave as waiting on a blocked task the caller's filters reject [proof: projection-respects-filters]
