---
id: TL-741
title: "a blocked wave task the caller cannot take does not make the wave wait"
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
created: 2026-11-14
updated: 2026-11-14
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: behind-respects-filters
    bash: "node --test scripts/tests/plan-waiting-behind-role.test.mjs"
---

## Goal

`next --plan` does not call a wave waiting on account of a task the caller's filters would never hand it, even when that task is blocked only by waiting work.

## Context

`waveWaiting` in scripts/next-task.mjs (TL-683) counts an open task of the active wave as `behind` when every unresolved `blocked_by` is itself waiting work, without asking whether the caller's role, executor or size filters admit it. A wave [A claimed elsewhere, B blocked by A, role: review] asked by `next --plan --role dev` is therefore `wave-claimed-elsewhere`, and `run --plan --wait --role dev` polls a wave that can never hand that caller anything. The conflict pass added by TL-734 does not share the gap, because it reads `skippedConflict`, which only holds tasks that passed every other gate. Surfaced while supervising TL-734.

## Steps

1. Decide how `waveWaiting` learns which of the active wave's blocked tasks the caller's filters admit (for example, by evaluating the same role/executor/size gates `selectCandidates` applies, without the blocker gate), without copying that judgement a second time
2. Treat a blocked task the filters reject as part of the rest, so the answer is `nothing-to-take`
3. Test with a fixture tree in scripts/tests/plan-waiting-behind-role.test.mjs: the wave above asked with `--role dev` is `nothing-to-take`, and the same tree asked with `--role review` is `wave-claimed-elsewhere` naming B under `waitingBehind`

## Acceptance criteria

- [ ] a blocked wave task the caller's filters reject does not make the wave waiting [proof: behind-respects-filters]
