---
id: TL-481
title: "Concurrent new keeps ids unique under a loaded suite"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 4h
confidence: medium                 # how much you trust the estimate
created: 2026-10-21
updated: 2026-10-26
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: concurrency
    bash: "node --test scripts/tests/new-task-concurrency.test.mjs scripts/tests/mutex-takeover.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

Concurrent `new` processes never hand two task files the same id, including when the machine is loaded: `scripts/tests/new-task-concurrency.test.mjs` ("concurrent new processes create unique task files and creation histories") passes on every run of the full suite, not only in isolation.

## Context

On 2026-10-21, during the closing run of TL-480, that test failed once inside `node --test scripts/tests/*.test.mjs` with `more than one task file claims the same id` (7 distinct ids for 8 workers). The same file passed six consecutive isolated runs and the previous full-suite run in the same worktree. TL-480 changed `new` only on the `--estimate` path, which this test does not take, so the race is pre-existing and appears under load. TL-295 closed the original duplicate-id race by serialising number allocation through `withBacklogMutex` (`scripts/lock.mjs`, used by `scripts/new-task.mjs`); a remaining window — the mutex's stale-lock takeover, its timeout under a slow disk, or a read of the tree outside the mutex — is the likely cause, but none of these has been confirmed. A test that fails one run in many is worse than one that always fails: it teaches everybody to re-run the suite until it is green.

## Steps

1. Reproduce under load: run the concurrency test many times while the rest of the suite runs in parallel (or with an artificial delay injected inside the mutex) and record the failure rate.
2. Find the window: trace which two workers received the same number and what each did between reading the tree and writing the file — including whether a stale-lock takeover fired.
3. Close the window in `scripts/lock.mjs` or `scripts/new-task.mjs`, and add a deterministic test that forces the interleaving rather than relying on timing.
4. Run the reproduction again and record that it no longer fails.

## Acceptance criteria

- [x] Concurrent creation still produces unique ids and one creation event each. [proof: concurrency]
- [x] The full suite, under its own load, stays green. [proof: suite-green]
