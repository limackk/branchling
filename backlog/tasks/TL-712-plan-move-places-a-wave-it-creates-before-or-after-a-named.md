---
id: TL-712
title: "plan move places a wave it creates before or after a named wave"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P1                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1h
confidence: medium                 # how much you trust the estimate
created: 2026-11-11
updated: 2026-11-11
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: plan-move-position
    bash: "node --test scripts/tests/plan-write.test.mjs"
---

## Goal

`plan move <ID> --wave "<new name>" --why "..."` can place the wave it creates before or after a named wave, as `plan add` can since TL-677.

## Context

TL-677 added `--before` / `--after` to `plan add` in scripts/plan-write.mjs (editPlanText, createWaveText). `plan move` with `--why` also CREATES a wave, but `editPlanText` refuses either flag for `move` as a usage error, so a wave created by `move` still lands at the end of `waves:` in backlog/plan.yaml, behind the human publication gates, where `plan` holds it shut until somebody edits the file by hand. TL-677 kept the flags to `add` because its thesis named only `add`. Done when `plan move --wave <new> --why ... --before|--after <wave>` places the created wave there, the existing refusals (unknown wave, both flags, a wave that already exists) apply to `move` as well, `remove` still refuses both flags, and `plan --help` says so.

## Steps

1. Let `editPlanText` accept `before` / `after` for `move` when the move creates its target wave, reusing the slot computation `add` uses
2. Keep the refusal for `remove` and for a move into an existing wave
3. Update `plan --help` and the usage line, and test a move that creates a wave before, after and at the end

## Acceptance criteria

- [ ] plan move creates its new wave before or after a named wave, and refuses an unknown one [proof: plan-move-position]
