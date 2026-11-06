---
id: TL-597
title: "The overview guide describes deploy status truly for foreign-only targets"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:impl-tl-597
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1h
confidence: medium                 # how much you trust the estimate
created: 2026-11-06
updated: 2026-11-06
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: foreign-only-targets-described
    bash: "node --test scripts/tests/instructions-promotion.test.mjs"
---

## Goal

The `overview` guide does not describe `deploy status` as reporting stages computed from git when every declared deploy target lives in another repository (`repository:`), because such a target has no stages this repository can observe.

## Context

Found in the TL-584 review. `promotionState` in scripts/instructions.mjs renders `deploy status   what each stage does not hold yet` and the phrase 'computed from git on every call' whenever config.yaml declares any `deploy_targets`. When every target carries `repository:`, `deploy status` still exits 0 but reports each target as unobservable, so the guide's description of what the command answers is wrong for that backlog. The command line itself stays callable; only its description is off. scripts/tests/instructions-promotion.test.mjs has no fixture where all targets are foreign.

## Steps

1. Decide what the paragraph says when every target is foreign: either name what `deploy status` does report for such targets, or name the `target:` field a task uses instead
2. Branch the rendering in `promotionState` on whether any target is local
3. Add a fixture to scripts/tests/instructions-promotion.test.mjs in which every target declares `repository:` and assert the description, with the existing fixtures as the positive control

## Acceptance criteria

- [x] With only foreign deploy targets, overview does not claim stages computed from git; with a local target it still does. [proof: foreign-only-targets-described]
