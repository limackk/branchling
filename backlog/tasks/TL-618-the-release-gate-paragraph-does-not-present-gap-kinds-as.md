---
id: TL-618
title: "The release-gate paragraph does not present gap kinds as complete"
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
created: 2026-11-06
updated: 2026-11-06
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: gate-gap-kinds-not-exhaustive
    bash: "node --test scripts/tests/instructions-promotion.test.mjs"
---

## Goal

The release-gate paragraph of `instructions overview` does not present a partial list of gap kinds as the complete one.

## Context

`promotionGate(config)` in scripts/instructions.mjs says `check --release` names each gap by its commit or task, and then lists three kinds: a deployed commit naming no task, a task only partly in a stage, a commit a stage holds that the trunk or an earlier stage lacks. GAP_NAMES in scripts/release-gaps.mjs declares more kinds (among them open-task-deployed, done-not-on-trunk, unknown-task-id). Read as written, the sentence tells an agent those three are all the gate reports. Either mark the list as examples (`for example`, `among them`) or derive it from GAP_NAMES so it cannot fall behind.

## Steps

1. Decide between marking the list as examples and deriving it from GAP_NAMES; record the choice and the rejected option in the commit body
2. Change the sentence in promotionGate
3. Add an assertion to scripts/tests/instructions-promotion.test.mjs that fails if the sentence again reads as an exhaustive list, or if a kind in GAP_NAMES is missing when the list is derived

## Acceptance criteria

- [ ] The overview paragraph either marks its gap kinds as examples or lists every kind GAP_NAMES declares, and a test fails otherwise [proof: gate-gap-kinds-not-exhaustive]
