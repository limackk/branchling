---
id: TL-365
title: "Every test isolates its home directory"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-07
updated: 2026-09-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: [scripts/tests/_repo.mjs, scripts/tests/test-hygiene.test.mjs]
verification:                      # HOW to check the task is really done
  - id: hygiene-suite
    bash: "node --test scripts/tests/test-hygiene.test.mjs"
---

## Goal

Every test that can resolve user configuration isolates its home directory, so
the suite is reproducible and cannot read or write a developer's real profiles.

## Context

`test-hygiene.test.mjs` currently names four profile-related test files that do
not call `isolateHome()`: agent launches, model catalog, guided profile setup
and project scope. The full suite therefore depends on the invoking account's
configuration even though the profile feature is explicitly local-user state.

## Pre-flight reading

The shared fixture helper and the hygiene guard define the one supported
isolation mechanism.

1. `scripts/tests/_repo.mjs` — use `isolateHome()` exactly as other tests do.
2. `scripts/tests/test-hygiene.test.mjs` — retain the static positive control.
3. The four named profile test files — add isolation before imports observe home.

## Steps

1. Add an early `isolateHome()` call with a distinct fixture name to every test
   file named by the hygiene guard.
2. Confirm profile tests still establish their own configuration explicitly.
3. Run the hygiene guard.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [ ] No test file reads the invoking developer's home directory. [proof: hygiene-suite]
