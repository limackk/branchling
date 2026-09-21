---
id: TL-401
title: "check --proofs leaves the contract in flight running after an interrupt"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-09-21
updated: 2026-09-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: interrupt-stops-the-entry
    bash: "node --test scripts/tests/proofs-progress.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

One interrupt ends `check --proofs` and everything it started. Today the
signal handler added by TL-265 stops the WALK but lets the contract already
running finish, and that contract may be `node --test scripts/tests/*.test.mjs`,
which spawns its own subprocesses into temporary trees.

## Context

TL-265 gave the audit a SIGINT/SIGTERM handler, a cost line and per-task
progress, and closed on those. Its third step — "stop the contract in flight
and its children before exiting, so one interrupt ends the audit" — is only
half done, and the commit body says so: the entry in flight is allowed to run
to completion deliberately, because `runContract` in
`scripts/check-backlog-proofs.mjs` is SYNCHRONOUS and is shared with `done`.
A synchronous child cannot be abandoned from the signal handler without
leaving exactly the orphan tree TL-265 was trying to prevent.

The measured cost of the gap is in TL-265's own context: killing the audit
mid-run left roughly 200 `cli.mjs` processes and a `node --test` runner alive
in temporary directories, and three separate signals were needed to stop them.
An operator who interrupts at minute 68 still waits for the current contract,
and a whole-suite contract is 170 seconds of that wait.

## Steps

1. Make the contract runner asynchronous, or run it in a process group that
   can be signalled as one. Both `check --proofs` and `done` call
   `runContract`, so whichever is chosen changes the closing path as well and
   must keep `done`'s refusal transcript intact.
2. On a signal, terminate the child and its descendants, then exit 130 as
   TL-265 already does.
3. Prove it with a fixture contract that spawns a grandchild: after the
   interrupt, neither the child nor the grandchild is still running.

## Acceptance criteria

- [ ] A single SIGINT ends the audit and every process it started, proven by
      a test that fails against today's code.
      [proof: interrupt-stops-the-entry]
- [ ] `done` still runs contracts and still refuses on a failing one.
      [proof: suite-green]
