---
id: TL-458
title: "Viewer edits preserve concurrent writers and ledger truth"
type: task
labels: []
board: main
epic: "Backlog viewer"
priority: P0
status: in_progress  # pending | in_progress | blocked | done | cancelled
owner: agent:codex
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2d
confidence: medium                 # how much you trust the estimate
created: 2026-09-26
updated: 2026-09-26
blocked_by: [TL-449]               # ids of tasks that MUST be closed before this one starts
blocks: [TL-450]                   # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: cross-process-atomicity
    bash: "node --test scripts/tests/viewer-write-api.test.mjs scripts/tests/viewer-write-atomicity.test.mjs scripts/tests/history-attribution-concurrency.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

A served viewer edit cannot overwrite a task changed by another process, and no
failure point can leave the append-only ledger claiming a transition whose task
file was restored.

## Context

The TL-449 review found that `editQueue` serializes requests only inside one
server process. A CLI command, editor, hook or second server can change the file
after the route reads it and before `atomicReplace()`, so the route can replace
newer bytes with a stale derivation. It also found that `recordEdit()` appends
history before saving the snapshot. If snapshot persistence fails, the route
restores the task but cannot retract the durable history row. The existing test
fails before the append and therefore does not exercise this split state.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/serve-backlog.mjs` — the process-local queue and file/history order.
2. `scripts/history.mjs` — append-only history and snapshot persistence order.
3. `scripts/snapshot-mutex.mjs` — the cross-process section already shared by history writers.
4. `scripts/tests/viewer-write-api.test.mjs` — the existing same-process coverage and its missing failure points.

## Steps

1. Define a cross-process write protocol or optimistic revision precondition that prevents a stale viewer read from replacing newer task bytes.
2. Make task, history and snapshot failure semantics explicit so a late failure cannot leave a false ledger row or a falsely restored task.
3. Cover an external competing writer or second server, not only two requests handled by one process.
4. Inject a failure after the history append and prove recovery leaves task, ledger and snapshot in one truthful state.
5. Preserve the capability, validation, attribution, rebuild and SSE contracts from TL-449.

## Acceptance criteria

- [ ] External writers cannot be silently overwritten and a post-append failure cannot split the task from its ledger. [proof: cross-process-atomicity]
- [ ] The repair preserves the complete product contract. [proof: suite-green]
