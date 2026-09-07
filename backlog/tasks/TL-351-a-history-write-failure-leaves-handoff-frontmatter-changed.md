---
id: TL-351
title: "A history write failure leaves handoff frontmatter changed"
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
created: 2026-09-07
updated: 2026-09-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: [scripts/handoff-task.mjs, scripts/history.mjs, scripts/lock.mjs]  # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: handoff-is-atomic
    bash: "node --test scripts/tests/handoff-atomicity.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
  - id: guards-green
    bash: "node scripts/cli.mjs check"
---

## Goal

A failed handoff leaves neither half of the transition behind. The task file and
its append-only history must continue to describe the same state even when
history persistence fails.

## Context

While handing TL-242 from `spec` to `dev` on 2026-09-07,
`handoffTask()` rewrote its frontmatter to `pending`, cleared its owner, and
changed its role before `recordEdit()` tried to acquire the history mutex.
Creating the mutex failed with `EPERM`; the command exited non-zero, but the task
file stayed changed and no matching history events existed. The caller had to
restore the last recorded frontmatter before retrying.

The observed `EPERM` came from a restricted state directory, but permissions are
not the defect: any history or lock I/O failure in that interval creates the
same split truth. Retrying without restoring first cannot reconstruct the lost
`in_progress` to `pending` transition because the file already says `pending`.

## Pre-flight reading

1. `scripts/handoff-task.mjs` — follow the mutation order in `handoffTask()` and
   its existing refusal paths.
2. `scripts/history.mjs` — understand what `recordEdit()` writes and how its
   failures surface.
3. `scripts/lock.mjs` — reproduce a mutex creation failure without depending on
   the developer machine's permissions.

## Steps

1. Add a fixture that makes history persistence fail after a handoff is
   otherwise valid.
2. Make the task-file and history writes one observable transaction: failure
   leaves the task and history at their pre-command values.
3. Keep the successful path as a positive control with matching task and history
   transitions.

## Acceptance criteria

- [ ] A failed history write makes `handoff` exit non-zero without changing task
  frontmatter or appending partial history. [proof: handoff-is-atomic]
- [ ] Retrying after the failure records the complete transition from the original
  state without a manual repair. [proof: handoff-is-atomic]
- [ ] A successful handoff still writes matching status, owner, role, and comment
  events beside the frontmatter change. [proof: handoff-is-atomic]
- [ ] The complete automated test suite remains green. [proof: suite-green]
- [ ] The repository consistency guards remain green. [proof: guards-green]
