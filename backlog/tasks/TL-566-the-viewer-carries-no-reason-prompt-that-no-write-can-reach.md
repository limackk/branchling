---
id: TL-566
title: "The viewer carries no reason prompt that no write can reach"
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
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-05
updated: 2026-11-05
blocked_by: [TL-563]  # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: no-dead-reason-prompt
    bash: "node --test scripts/tests/viewer-editing.test.mjs scripts/tests/viewer-write-api.test.mjs scripts/tests/viewer-dedicated-fields.test.mjs"
---

## Goal

The served viewer carries no reason prompt that no write can reach: either the prompt and the route's `needsReason` answer are removed, or a field that genuinely requires a reason through the route exists and is proved to reach them.

## Context

TL-563 made POST /api/task refuse `status` and `owner`, the fields dedicated commands own (`DEDICATED_FIELDS`). `requiresReason()` in `scripts/history.mjs` answers true only for `field === "status"` with a value in `reason_required_statuses`, so after TL-563 no write the route accepts can require a reason. Three pieces are now unreachable: the reason prompt in the page (`reasonRequiredFor`, `state.reasonAsk`, `reasonAskHtml`, `submitReason`, `cancelReason`, `focusReasonAsk` in `scripts/build-viewer.mjs`), the `needsReason` field of the route's error answer in `scripts/serve-backlog.mjs`, and the `reason-required` branch reached through `writeTaskField` from the route. Two tests now guard dead code: `editingContractProblems` ('protected transitions ask first') and `visibilityProblems` in `scripts/tests/viewer-editing.test.mjs`, and the 422 `needsReason` case in `scripts/tests/viewer-write-api.test.mjs`, which after TL-563 answers 400 for the dedicated field instead. A guard that keeps code alive which no input can reach is green with no evidentiary force. The optional `reason` on an ordinary field write is NOT dead: the route records it, and it stays.

## Steps

1. Confirm with a request that no field the route accepts can return `needsReason` (every value in `reason_required_statuses` is a status).
2. Remove the page's reason prompt and the route's `needsReason` answer, or, if a reason-required non-dedicated field is introduced instead, prove the prompt fires for it.
3. Update `viewer-editing.test.mjs` and `viewer-write-api.test.mjs` so they assert reachable behaviour only, keeping the optional reason on a plain field write recorded in history.

## Acceptance criteria

- [ ] The viewer's reason handling covers only writes the route can accept, and a stated reason on a plain field is still recorded. [proof: no-dead-reason-prompt]
