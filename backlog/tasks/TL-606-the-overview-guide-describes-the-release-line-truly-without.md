---
id: TL-606
title: "The overview guide describes the release line truly without a local target"
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
created: 2026-11-06
updated: 2026-11-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: release-line-without-local-target
    bash: "node --test scripts/tests/instructions-promotion.test.mjs"
---

## Goal

The `overview` guide describes `deploy status --release <name>` truly where no deploy target lives in this repository: it does not promise 'a release's plan against what shipped' when shipping cannot be read.

## Context

Found while implementing TL-597. `promotionState` in scripts/instructions.mjs prints `deploy status --release <name>   a release's plan against what shipped` whenever config.yaml declares `releases:`. When no deploy target is local (none declared, or every one carries `repository:`), `deploy status --release` exits 0 but prints 'which release is current was not judged — deployment was not read', lists every planned task as 'planned, not shipped' with 'deployment not read' (no targets) or as 'planned, unobservable here' (foreign targets), and counts shipped as 0. So the line's description promises a comparison the command cannot make in that backlog. TL-597 made the paragraph's 'computed from git' claim follow whether any target is local; the release line's own description was left as it was, because it is a separate sentence about a separate command line.

## Steps

1. Decide what the `--release` line says when no target is local: name what it does report (the plan, which tasks are still open, which are unobservable), or say that shipping is not read here
2. Branch the release line in `promotionState` on the same predicate TL-597 introduced (`observedTargets(config.deployTargets).length > 0`)
3. Extend scripts/tests/instructions-promotion.test.mjs: assert the description for releases alone and for releases with only foreign targets, keeping the fixture with a local target as the positive control

## Acceptance criteria

- [ ] With no local deploy target, overview does not describe `deploy status --release` as comparing the plan against what shipped; with a local target it still does. [proof: release-line-without-local-target]
