---
id: TL-488
title: "A live id mutex holder is never judged stale by its own scanner timeout"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P3
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 3h
confidence: medium                 # how much you trust the estimate
created: 2026-10-26
updated: 2026-10-30
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: long-section
    bash: "node --test scripts/tests/mutex-takeover.test.mjs scripts/tests/new-task-concurrency.test.mjs"
---

## Goal

No critical section guarded by `withMutex` can legitimately outlive `MUTEX_STALE_MS`: either the id mutex's longest step is bounded below the stale limit, or the holder refreshes its stamp while it works, so a live writer is never judged dead and taken over.

## Context

`MUTEX_STALE_MS` in `scripts/lock.mjs` is 30 s. Inside the id mutex, `nextId()` in `scripts/new-task.mjs` spawns `next-backlog-id.mjs` with a 60 s timeout, so a scanner that is slow but alive (a large repository with many branches, a loaded machine) can hold the section past the stale limit, and a contender will then take it over while the holder is still about to write — two files with one id, the failure TL-481 closed for a different window. Nothing has measured this happening; TL-481 noted it in its commit body. The stale limit is shared by every `withMutex` section, so raising it has a cost: a writer killed inside a section blocks the others for that long.

## Steps

1. Measure how long `next-backlog-id.mjs` takes on a large repository (hundreds of branches) and under load.
2. Choose: bound the scanner below the stale limit, refresh the holder's stamp during the section, or give the id mutex its own stale limit — and state why the others were rejected.
3. Add a test in which a holder that stays alive beyond the old stale limit is not taken over, with a positive control that a dead holder still is.

## Acceptance criteria

- [x] A live holder working past the stale limit keeps the section, and a dead one is still taken over. [proof: long-section]
