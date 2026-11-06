---
id: TL-596
title: "The guides name check --release and deploy record where they apply"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-06
updated: 2026-11-06
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: guides-name-gate-and-record
    bash: "node --test scripts/tests/instructions-promotion.test.mjs"
---

## Goal

The workflow guides printed by `instructions` name `check --release` (the gate before a deploy) where config.yaml declares `deploy_targets`, and `deploy record` where a stage is declared `recorded: true`, each with the backlog's own target and stage names, so an agent learns the rest of the promotion surface from the only channel the packaged skill sends it to.

## Context

TL-584 added a conditional paragraph to `overview` (`promotionState` in scripts/instructions.mjs) naming `deploy status` and `deploy status --release`, and one to `task-creation` (`releasePlanning`) naming `release:` and `declare releases`. It deliberately stopped there: its acceptance criterion covers only those two questions. Two promotion commands still have no pointer in any guide. `check --release` judges whether a promotion has a traceability gap and is what CI runs before a deploy (see the `check` usage in scripts/cli.mjs); `deploy record` moves the ref of a stage git cannot observe (store review, an update channel, a sign-off) and is refused on any other stage. An agent asked whether a promotion is safe, or told that a store review passed, has no route but `--help` or the task files. Both must stay conditional like TL-584's lines: `deploy record` offered where no stage is `recorded: true` teaches a refusal.

## Steps

1. Decide the owning guide for each command: the release gate most likely in task-finalization or overview, the recorded stage in overview
2. Render each line only when its configuration is present, naming the declared targets and recorded stages
3. Extend scripts/tests/instructions-promotion.test.mjs with a fixture holding a recorded stage and one without, and prove each offered command is callable in its fixture

## Acceptance criteria

- [ ] With deploy_targets declared a guide names `check --release`; with a recorded stage it names `deploy record` and that stage; without them, no guide does. [proof: guides-name-gate-and-record]
