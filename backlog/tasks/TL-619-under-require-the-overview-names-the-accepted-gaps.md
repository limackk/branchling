---
id: TL-619
title: "Under require the overview names the accepted gaps"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-4
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: [instructions]  # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-06
updated: 2026-11-08
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: gate-accepted-gaps-named
    bash: "node --test scripts/tests/instructions-promotion.test.mjs"
---

## Goal

Under `release_gate: require`, `instructions overview` names the gaps this backlog's `release_gate_accept` already accepts.

## Context

`promotionGate(config)` in scripts/instructions.mjs prints, under `release_gate: require`, that a gap `release_gate_accept` does not name exits 1. It does not say which gaps this backlog accepts, although the guides exist to give the backlog's own values rather than the key's name. An agent reading the paragraph cannot tell whether a gap it sees will fail the gate without opening config.yaml. Where `release_gate_accept` is empty, the paragraph should say so rather than print an empty list.

## Steps

1. Read the shape of `release_gate_accept` from scripts/config.mjs
2. Render the accepted gaps (or the statement that none are accepted) on the `release gate` line or the line after it, only under `require`
3. Add fixtures to scripts/tests/instructions-promotion.test.mjs with a non-empty and an empty `release_gate_accept` under `require`, plus a `report` fixture where nothing about acceptance is printed

## Acceptance criteria

- [x] Under `require` the overview names this backlog's accepted gaps or says none are accepted, and under `report` it names neither [proof: gate-accepted-gaps-named]
