---
id: TL-675
title: "release refuses an undeclared or archived --status as a refusal, not usage"
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
created: 2026-11-09
updated: 2026-11-09
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: release-status-refusal
    bash: "node --test scripts/tests/release-status-refusal.test.mjs"
---

## Goal

`release <ID> --status <s>` answers a status outside `statuses:` and an archived status as refusals (exit 1, and under `--json` a `task-release` envelope with `refusalKind` `unknown-value` or `archived-status`, `rejected` `{ field: "status", value }` and `declared`), the line TL-574 and TL-635 drew for `handoff`, instead of exit 2 with `refusalKind: "usage"`.

## Context

TL-559, TL-574 and TL-635 settled for `handoff` that a value a person typed into a correctly built call is a refusal (exit 1) and exit 2 is kept for a call built wrong (an unknown flag, a missing value, a missing `--reason`). `release` shares `handoffTask()` with `handoff` but validates `--status` itself: in `scripts/release-task.mjs` `run()`, `if (plan.status && (config.statuses.indexOf(plan.status) < 0 || config.archivedStatuses.indexOf(plan.status) >= 0))` answers `refuse("`--status` must name an open status in this backlog", [], 2, "usage")` for BOTH an undeclared status and an archived one, with no `rejected` or `declared`. A consumer therefore cannot tell a typed value from its own malformed call on `release`, while it can on `handoff`. Fix: split the two cases, reuse the `unknown-value` shape (`declared` = `statuses:`) and the `archived-status` shape from `scripts/handoff-task.mjs` (`declared` = `statuses:` minus `archived_statuses`), keep exit 2 for usage errors, and update the `release` exit line in `scripts/cli.mjs`, the `task-release` row in `docs/manual.md` and the refusal table in `docs/external-consumers.md`. Existing assertions on `release --status` exit codes live under `scripts/tests/` (grep `"release"` with `--status`).

## Steps

1. Split the `--status` check in `scripts/release-task.mjs` into an `unknown-value` and an `archived-status` refusal, exit 1, each with `rejected` and `declared` under `--json`
2. Keep exit 2 for an unknown flag, a missing value and a missing `--reason`
3. Update the `release` exit line in `scripts/cli.mjs`, `docs/manual.md` and `docs/external-consumers.md`, and the tests that assert exit 2 today

## Acceptance criteria

- [ ] release --status with an undeclared or an archived status answers exit 1 and a task-release refusal envelope with its refusalKind, rejected and declared, and writes nothing [proof: release-status-refusal]
