---
id: TL-598
title: "The task-creation guide names the target field for foreign deploy targets"
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
estimate: 1h
confidence: medium                 # how much you trust the estimate
created: 2026-11-06
updated: 2026-11-06
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: guide-names-target-field
    bash: "node --test scripts/tests/instructions-promotion.test.mjs"
---

## Goal

The `task-creation` guide names the `target:` field, and `new --target`, where config.yaml declares a deploy target in another repository, so an agent creating a task that ships from that repository learns how to say so.

## Context

Found in the TL-584 review. `releasePlanning` in scripts/instructions.mjs names `release:` and `declare releases` when releases are declared, but nothing in any guide names `target:`, the field a task uses to name a deploy target with `repository:` (a task of THIS repository's targets is derived from commit paths and `new --target` refuses it). TL-584's acceptance criterion did not ask for it. The line must stay conditional: offered where no foreign target exists it teaches a refusal.

## Steps

1. Render a line in task-creation only when at least one deploy target declares `repository:`, naming those targets
2. Extend scripts/tests/instructions-promotion.test.mjs with a fixture holding a foreign target and one holding only local targets, and prove the offered `new --target` call succeeds in its fixture

## Acceptance criteria

- [ ] With a foreign deploy target task-creation names `target:` and that target; with only local targets, or none, it does not. [proof: guide-names-target-field]
