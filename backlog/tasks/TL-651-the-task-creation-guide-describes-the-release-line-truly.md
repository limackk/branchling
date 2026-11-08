---
id: TL-651
title: "The task-creation guide describes the release line truly without a local target"
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
estimate: 1h
confidence: medium                 # how much you trust the estimate
created: 2026-11-08
updated: 2026-11-08
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: task-creation-release-line-without-local-target
    bash: "node --test scripts/tests/instructions-promotion.test.mjs"
---

## Goal

The `task-creation` guide describes `deploy status --release <name>` truly where no deploy target lives in this repository: it does not call its answer 'what that release still lacks' when shipping cannot be read.

## Context

Found while implementing TL-606. `releasePlanning` in scripts/instructions.mjs prints `deploy status --release <name>         what that release still lacks` whenever config.yaml declares `releases:`. When no deploy target is local (none declared, or every one carries `repository:`), `deploy status --release` judges no release current ('which release is current was not judged — deployment was not read'), counts shipped as 0, and lists every planned task as 'planned, not shipped' with 'deployment not read' (no targets) or as 'planned, unobservable here' (foreign targets). 'Still lacks' then asserts that those tasks are missing from a release when the command cannot know whether they shipped. TL-606 made the same line in `overview` (`promotionState`) follow `observedTargets(config.deployTargets).length > 0`; this is the matching sentence in a different guide, left out of TL-606 so that task kept to one guide.

## Steps

1. Decide what the task-creation `--release` line says when no target is local (for example: the release's plan and which planned tasks are open; what shipped is not read here)
2. Branch the line in `releasePlanning` on `observedTargets(config.deployTargets).length > 0`, keeping the column alignment of the `declare releases` line above it
3. Extend scripts/tests/instructions-promotion.test.mjs: assert both descriptions, with a local-target fixture as the positive control and `deploy status --release` run in each fixture

## Acceptance criteria

- [ ] With no local deploy target, task-creation does not describe `deploy status --release` as what the release still lacks; with a local target it still does. [proof: task-creation-release-line-without-local-target]
