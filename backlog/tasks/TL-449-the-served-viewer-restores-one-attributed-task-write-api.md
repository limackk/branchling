---
id: TL-449
title: "The served viewer restores one attributed task-write API"
type: task
labels: []
board: main
epic: "Backlog viewer"
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-26
updated: 2026-09-26
blocked_by: [TL-448]               # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: write-boundary
    bash: "node --test scripts/tests/viewer-write-api.test.mjs scripts/tests/task-fields.test.mjs scripts/tests/history-attribution-concurrency.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

A page served from the local branchling process can change supported task fields through one narrow, authenticated-in-process API that validates the value, records the actor and reason, appends history atomically and rebuilds computed views.

## Context

TL-379 removed all browser mutation routes because the previous surface added actor, validation and lifecycle obligations without a defensible boundary. The owner now wants manual editing back. Restoration must answer that earlier objection rather than merely re-enable old POST handlers. The server remains loopback-only. A write capability is created per process and injected only into the page it serves; an arbitrary web page, stale tab or guessed task path must not be able to mutate a backlog. Task filenames are resolved from the directory listing, never concatenated from request input.

## Steps

1. Design one mutation endpoint and a short-lived per-process capability or equivalent same-process proof required by every write.
2. Reject foreign Origin or Host values, stale capabilities, unknown fields, oversized input, path traversal and tasks not found by directory enumeration.
3. Reuse task-fields.mjs for normalization and validation instead of implementing browser-specific field rules.
4. Require an explicit namespaced user actor and require a reason for every status configured by reason_required_statuses.
5. Write the task file and history as one atomic effect, then rebuild computed views and publish the existing SSE change signal.
6. Add positive and negative concurrency tests proving that a failed history write or competing edit cannot leave the task and ledger split.

## Acceptance criteria

- [ ] Only a valid local page can make a validated, attributed and atomic task edit. [proof: write-boundary]
- [ ] Restoring the write path preserves the complete product contract. [proof: suite-green]
