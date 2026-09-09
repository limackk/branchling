---
id: TL-389
title: "Doctor JSON completes within the UI contract timeout"
type: task
labels: []
board: main
epic: "Execution reliability"
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:codex
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-09-09
updated: 2026-09-09
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: [scripts/doctor.mjs, scripts/tests/ui.test.mjs, scripts/tests/suite-is-terminal-independent.test.mjs]
verification:                      # HOW to check the task is really done
  - id: doctor-json-ui
    bash: "node --test scripts/tests/ui.test.mjs scripts/tests/suite-is-terminal-independent.test.mjs"
  - id: full-suite
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

`doctor --json` must finish before the UI test's 30-second command timeout and
emit one complete parseable JSON document on the repository's current backlog.

## Context

On 2026-09-09 the UI test reproduced an incomplete `doctor --json` response
both inside and outside the full suite. A direct command eventually succeeded
after about 90 seconds for 388 tasks; `spawnSync` therefore killed the UI test
child at 30 seconds and left partial JSON. Do not increase that timeout: JSON
commands are a machine boundary and this latency makes the result unreliable.
Identify and remove duplicated or avoidable work in the doctor path while
preserving every check and its evidence.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/doctor.mjs` — identify each traversal and subprocess on the JSON
   path.
2. `scripts/tests/ui.test.mjs` — preserve the parseability and timeout
   contract.
3. `scripts/tests/suite-is-terminal-independent.test.mjs` — preserve the
   forced-colour regression runner that calls the UI test.

## Steps

1. Measure the doctor JSON path and locate its repeated or avoidable work.
2. Make the smallest implementation change that retains the same check set and
   JSON envelope.
3. Prove the focused UI tests and the full suite.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] `doctor --json` is complete and parseable through the UI test command
  boundary within its existing timeout. [proof: doctor-json-ui]
- [x] Forced-colour rendering remains terminal-independent. [proof: doctor-json-ui]
- [x] The full suite is green. [proof: full-suite]
