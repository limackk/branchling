---
id: TL-630
title: "new refuses an undeclared value as unknown-value with rejected and declared"
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
conflict_group: [json-envelope]  # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-07
updated: 2026-11-07
blocked_by: [TL-568]  # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: new-json-refusals
    bash: "node --test scripts/tests/new-json-refusals.test.mjs"
---

## Goal

`new --json` refuses a `--priority`, `--status`, `--type`, `--owner`, `--board`, `--release` or `--target` value outside its vocabulary with `refusalKind: "unknown-value"`, `rejected` `{ field, value }` and `declared` (the values the field accepts), the shape `set`, `query` and `handoff` already refuse with, instead of `refusalKind: "usage"` with the accepted values inside a sentence in `details`.

## Context

TL-568 moved every refusal of `new --json` (scripts/new-task.mjs main()) into the `task-new` envelope and, following its own list of kinds, labelled a value outside a vocabulary `usage` with exit 2. `set` (TL-543), `query` and `handoff` (TL-559) name the same situation `unknown-value`, declare `rejected` and `declared` on their kinds in scripts/json-envelope.mjs, and exit 1. A consumer branching on `refusalKind` across writers therefore sees two words for one refusal. Settling it means: declare `rejected` and `declared` on `task-new`; return `unknown-value` from the vocabulary checks in main(); decide whether the exit code moves from 2 to 1 to match `set` and `query` (docs/external-consumers.md 'When a reading command refuses' states exit 1 for unknown-value), and say so in docs/manual.md and docs/external-consumers.md. The `--target` refusal of a target of THIS repository is a different statement (the name is declared) and may stay `usage`. TL-574 does the same for next, run and handoff.

## Steps

1. Declare rejected and declared on task-new in scripts/json-envelope.mjs
2. Return unknown-value with rejected and declared from each vocabulary check in scripts/new-task.mjs main()
3. Settle and document the exit code
4. Extend scripts/tests/new-json-refusals.test.mjs

## Acceptance criteria

- [ ] A value outside a vocabulary is refused as unknown-value with rejected and declared. [proof: new-json-refusals]
