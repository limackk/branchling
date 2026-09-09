---
id: TL-388
title: "Full suite uses a supported refusal and isolated home"
type: task
labels: []
board: main
epic: "Execution reliability"
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:codex
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-09-09
updated: 2026-09-09
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: [scripts/tests/json-pipe.test.mjs, scripts/tests/agent-activity-language.test.mjs, scripts/tests/test-hygiene.test.mjs]
verification:                      # HOW to check the task is really done
  - id: focused-regressions
    bash: "node --test scripts/tests/json-pipe.test.mjs scripts/tests/agent-activity-language.test.mjs scripts/tests/test-hygiene.test.mjs"
  - id: full-suite
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

The full test suite must use only commands that the current CLI supports, and
every test file must isolate its home directory before reading repository
sources or spawning a command.

## Context

The full suite on 2026-09-09 found two unrelated regressions. The pipe test
expects the removed `quote` command to return a task-not-found exit code, but
an unknown command correctly returns usage exit code 2. The activity-language
test does not call `isolateHome()`, so the uniform hygiene guard rejects it.
Use a supported command for the non-usage refusal and keep the assertion about
exit code 1. Do not weaken either guard or add an exception: both have positive
controls and protect different contracts.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/tests/json-pipe.test.mjs` — replace the obsolete command with the
   supported missing-profile refusal that returns exit code 1.
2. `scripts/tests/agent-activity-language.test.mjs` — add the standard
   per-file home isolation.
3. `scripts/tests/test-hygiene.test.mjs` — read the uniform isolation rule and
   its positive control before changing the activity-language test.

## Steps

1. Replace the obsolete `quote` invocation with the supported missing-profile
   refusal after parsing valid arguments.
2. Call `isolateHome()` once near the imports in the activity-language test.
3. Run the focused regressions and then the full suite.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] The pipe test distinguishes a supported missing-profile refusal (exit 1)
  from usage errors (exit 2). [proof: focused-regressions]
- [x] The activity-language test passes the repository-wide home-isolation
  guard without an exception. [proof: focused-regressions]
- [x] The full suite is green. [proof: full-suite]
