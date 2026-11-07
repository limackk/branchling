---
id: TL-620
title: "The overview names which recorded stages take --ref"
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
conflict_group: [instructions]  # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-06
updated: 2026-11-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: gate-parallel-stages-named
    bash: "node --test scripts/tests/instructions-promotion.test.mjs"
---

## Goal

`instructions overview` says which recorded stages take `--ref <name>`, not only that some do.

## Context

`promotionGate(config)` in scripts/instructions.mjs sets one boolean, `parallel`, when any recorded stage has parallel refs, and then says `a stage of parallel refs also takes --ref <name>`. With several recorded stages listed on the `recorded stages` line, the reader cannot tell which of them refuses `deploy record` without `--ref` (the refusal is selectRecordedRef in scripts/release-record.mjs). The paragraph should name those stages as `target/stage`, the same way it lists the recorded ones.

## Steps

1. Collect the parallel recorded stages separately from the recorded ones in promotionGate
2. Name them in the `--ref` sentence or mark them on the `recorded stages` line
3. Add a fixture to scripts/tests/instructions-promotion.test.mjs with two recorded stages of which only one is parallel, asserting that exactly that one is named as taking `--ref`, and confirm with a live `deploy record` that it is the one refused without it

## Acceptance criteria

- [ ] With several recorded stages, the overview names exactly the parallel ones as taking `--ref <name>` [proof: gate-parallel-stages-named]
