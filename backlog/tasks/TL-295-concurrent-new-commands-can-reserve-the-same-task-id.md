---
id: TL-295
title: "Concurrent new commands can reserve the same task id"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-09-05
updated: 2026-09-05
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs:
  - docs/branchling-state-and-sync.md
verification:
  - id: concurrent-reservation
    bash: "node --test scripts/tests/new-task-concurrency.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

Concurrent `new` commands reserve different task identifiers. The reservation
is atomic across processes in one clone, so parallel automation cannot create
several task files and history records under the same id.

## Context

On 2026-09-05 seven task-creation calls were launched concurrently while
building the provider-neutral agent execution epic. Six observed the same next
number and created distinct filenames whose frontmatter all said TL-288. The
subsequent sequential pass produced TL-289 through TL-294, but the append-only
history correctly retains the attempted creation records under TL-288.

`new` already scans branches and worktrees, which prevents sequential sessions
from reusing visible numbers but does not make the scan-and-write pair atomic.
Use the existing external state and lock design rather than a repository lock:
worktrees need one shared exclusion key, and a lock committed with a branch
would exclude nobody in another worktree. Do not repair old history or infer a
number from `max + 1` outside the locked section.

## Pre-flight reading

1. `scripts/new-task.mjs` — locate the current scan, reservation and write
   boundary.
2. `scripts/lock.mjs` — reuse the cross-worktree atomic-link mechanism.
3. `scripts/tests/new-task.test.mjs` — preserve sequential numbering and
   cross-worktree coverage.
4. `docs/branchling-state-and-sync.md` — keep shared state outside the
   repository.

## Steps

1. Add a positive-control test that launches several real `new` processes at
   once and asserts unique ids, filenames and creation histories.
2. Place identifier selection and reservation under one cross-process critical
   section keyed by the repository's common git directory.
3. Release the reservation on every success and failure path without deleting
   another process's lock.
4. Preserve numbering across branches, worktrees and co-located backlog layouts.

## Acceptance criteria

- [ ] At least six concurrent `new` processes create six unique task ids and
      matching filenames and history logs. [proof: concurrent-reservation]
- [ ] A process that fails during creation does not leave numbering permanently
      locked. [proof: concurrent-reservation]
- [ ] Existing branch, worktree and layout numbering behavior remains green.
      [proof: suite-green]
