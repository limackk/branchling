---
id: TL-309
title: "Every test isolates the user profile"
type: task
labels: []
board: main
epic: "Execution observability"
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-06
updated: 2026-09-06
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: [scripts/tests/_repo.mjs, scripts/tests/test-hygiene.test.mjs]
verification:                      # HOW to check the task is really done
  - id: isolated-home
    bash: "node --test scripts/tests/test-hygiene.test.mjs scripts/tests/agent-adapter-security.test.mjs scripts/tests/watch.test.mjs"
---

## Goal

Every test process isolates its user-home configuration before it imports code
that may resolve preferences, so the suite cannot depend on the developer's
actor, profiles, endpoint or state directory.

## Context

The full regression run found that `agent-adapter-security.test.mjs` and
`watch.test.mjs` do not call `isolateHome()`. The hygiene guard correctly fails
them. This is environment coupling rather than a conformance defect: the tests
may pass or fail depending on preferences in the person's home directory.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/tests/_repo.mjs` — the shared isolation primitive and its intended
   placement at test-file startup.
2. `scripts/tests/test-hygiene.test.mjs` — the guard and positive control that
   define the repository-wide rule.
3. `scripts/tests/agent-adapter-security.test.mjs` and `scripts/tests/watch.test.mjs`
   — the two files the guard identifies.

## Steps

1. Isolate home once at the start of each named test file.
2. Keep each test's existing fixture-specific environment overrides intact.
3. Verify the hygiene guard and the two focused suites together.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [ ] The hygiene guard reports no test file that reads the developer's home.
  [proof: isolated-home]
- [ ] Adapter-security and watch tests pass with their own isolated home.
  [proof: isolated-home]
