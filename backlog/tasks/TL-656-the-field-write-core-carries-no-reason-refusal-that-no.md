---
id: TL-656
title: "The field-write core carries no reason refusal that no caller reaches"
type: task
labels: []
board: main
epic: "Backlog viewer"
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
created: 2026-11-08
updated: 2026-11-08
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: core-reason-branch
    bash: "node --test scripts/tests/set-field.test.mjs scripts/tests/field-write-reserved-actor.test.mjs scripts/tests/viewer-write-api.test.mjs"
---

## Goal

The shared field-write core carries no reason-required refusal that no caller can reach, or a caller that reaches it is proved to.

## Context

`writeTaskField()` in `scripts/field-write.mjs` refuses with kind `reason-required` (HTTP 422, `needsReason: true`) when `requiresReason(config, {field, to})` in `scripts/history.mjs` answers true. That function answers true only for `field === "status"` with a value in `reason_required_statuses`. Both callers of the core — `scripts/set-field.mjs` and POST /api/task in `scripts/serve-backlog.mjs` — pass `refusedFields: Object.keys(DEDICATED_FIELDS)`, which contains `status`, and the dedicated-field refusal runs before the reason rule. So no input from either caller reaches the branch, and no test calls it (a search of `scripts/tests/` for `reason-required` finds no test of this branch). TL-566 removed the viewer's reason prompt and the route's `needsReason` answer for the same reason and deliberately left the core alone, because the core is exported and a future caller passing no `refusedFields` would reach it. This task decides between: (a) removing the branch and the `needsReason` property from the refusal, documenting that a status write belongs to the dedicated commands; or (b) keeping it as the core's own guard for a caller that does not refuse `status`, with a direct unit test of `writeTaskField()` with `refusedFields: []` proving it fires and writes nothing.

## Steps

1. Confirm that every caller of `writeTaskField()` refuses `status` (grep the callers).
2. Choose (a) or (b) above and implement it; the commit body names the option rejected.
3. If (b), add a test calling `writeTaskField()` directly on a fixture tree with `refusedFields: []` and a protected status without a reason, asserting kind `reason-required` and an unchanged task file and history log.

## Acceptance criteria

- [ ] The core's reason-required branch is either gone or exercised by a test that fails without it. [proof: core-reason-branch]
