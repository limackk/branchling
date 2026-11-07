---
id: TL-574
title: "next, run and handoff refuse an undeclared value as unknown-value"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-2
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: [json-envelope]  # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-05
updated: 2026-11-07
blocked_by: [TL-559]  # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: unknown-value-dispatch
    bash: "node --test scripts/tests/unknown-value-dispatch.test.mjs"
---

## Goal

`next` and `run` answer a filter value outside the backlog vocabulary, and `handoff` answers a `--status` or `--to-owner` outside it, with the same `unknown-value` refusal (exit 1, an envelope under `--json`) that `query` and `handoff --to-role` give since TL-559.

## Context

TL-559 made `query` (every axis `unknownFilterValues()` in `scripts/task-select.mjs` checks) and `handoff --to-role` refuse an undeclared value with exit 1 and, under `--json`, `refusalKind: "unknown-value"` with `rejected` `{ field, value }` and `declared`. Three paths that check the same kind of value still answer exit 2 with only a sentence on stderr, the answer a wrongly built call gets:

- `scripts/next-task.mjs` (around `unknownFilterValues(filters, config)`): `next --priority P9 --json`.
- `scripts/run-loop.mjs` (the same call): `run --board nowhere --dry-run --json`.
- `scripts/handoff-task.mjs` `run()`: the `--to-owner` check against `owners:` and the `--status` check against `statuses:` both go through `fail2()`.

TL-559 deliberately left them alone: its thesis names `query` and `handoff --to-role` only. `scripts/tests/query-vocabulary.test.mjs` asserts exit 2 for `next` and `run` today, and `scripts/tests/next.test.mjs` asserts it for `next --role`. A consumer that can tell a typed value from its own malformed call on `query` cannot on `next`, the dispatcher, where a typo matters most.

## Steps

1. Answer each of those undeclared values with exit 1 and, under `--json`, the `unknown-value` envelope of that command kind (`task-take` for `next`, `run` for `run`, `task-handoff` for `handoff`), declaring `rejected` and `declared` on the kind in `scripts/json-envelope.mjs`
2. Keep exit 2 for an unknown flag or a missing value
3. Add the rows to the refusal table in `docs/external-consumers.md` and test each case

## Acceptance criteria

- [x] next, run and handoff --status/--to-owner answer an undeclared value with an unknown-value envelope naming the declared values, exit 1. [proof: unknown-value-dispatch]
