---
id: TL-432
title: "Tests that start a server write into the developer's real state directory"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P3
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-21
updated: 2026-09-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  # The proof is a property of the test FILES, not of a run: every file that
  # starts a server has to move the state directory before it does. Asserted by
  # a guard that reads them, so a seventh file cannot appear without failing —
  # a grep in this block would pass the day somebody renames the variable.
  - id: state-is-isolated
    bash: "node --test scripts/tests/shared-state-boundary.test.mjs"
  - id: the-server-tests-still-pass
    bash: "node --test scripts/tests/serve-lifetime.test.mjs scripts/tests/serve-identity.test.mjs scripts/tests/serve-no-repository.test.mjs scripts/tests/serve-cross-branch-push.test.mjs scripts/tests/viewer-read-only.test.mjs"
---

## Goal

A suite run leaves the developer's own state directory exactly as it found it.
Today it does not: four test files start real `serve` processes without moving
`BACKLOG_STATE_DIR`, so since TL-266 every one of them writes an entry into the
register the user's own `serve --list` reads.

## Context

Measured on 2026-09-21, immediately after TL-266 was committed. `branchling
serve --list` in this checkout answered:

    ! port 62725  stale  pid 35028  /private/tmp/.../branchling-xpush-nogit-qroQIJ/backlog

That entry was written by `scripts/tests/serve-cross-branch-push.test.mjs`
against a fixture that no longer exists. Nothing is broken by it — the register
reports it as `stale`, `--stop` removes it and the next `serve` reclaims it,
which is the behaviour TL-266 built — but a suite that writes into the user's
machine state is the same class of defect `isolateHome()` was written for
(TL-166) and `isolateGit()` after it (TL-174): the suite must answer the same
on every machine AND leave no trace on any of them.

`scripts/tests/serve-lifetime.test.mjs` already does the right thing:

    process.env.BACKLOG_STATE_DIR = realpathSync(mkdtempSync(...));

The four that do not are `serve-cross-branch-push`, `serve-identity`,
`serve-no-repository` and `viewer-read-only`. The variable reaches spawned
processes through `process.env`, so one assignment per file covers both halves,
exactly as `isolateHome` does.

WHY THIS IS NOT A LINE IN THE FILES TODAY. The right shape is probably a helper
beside `isolateHome()` in `scripts/tests/_repo.mjs` — `isolateState(label)` —
plus a guard that fails when a file spawning `serve-backlog.mjs` does not call
it. A guard is what keeps the fifth file from reintroducing this, and writing
one is a decision about where it lives, not a one-line edit inside another
task's commit.

## Pre-flight reading

1. `scripts/tests/_repo.mjs` — `isolateHome()` and `isolateGit()`: the shape
   this follows, and the reasoning already written down there.
2. `scripts/serve-registry.mjs` — `serversDir()` / `stateRoot()`: what is
   written, and why it is outside the repository.
3. `scripts/tests/shared-state-boundary.test.mjs` — whether the guard belongs
   in that file or in a new one.

## Steps

1. Add `isolateState()` beside `isolateHome()` in `_repo.mjs`, returning the
   directory so a test can assert against it.
2. Call it in the four files that spawn `serve-backlog.mjs`.
3. Add the guard: a test file that starts a server and does not move the state
   directory FAILS. Give it a positive control, so it cannot pass by finding no
   files at all.

## Acceptance criteria

- [ ] Every test file that starts a server moves the state directory first, and
      a file that does not is reported by a guard with a positive control.
      [proof: state-is-isolated]
- [ ] The five server test files still pass.
      [proof: the-server-tests-still-pass]
