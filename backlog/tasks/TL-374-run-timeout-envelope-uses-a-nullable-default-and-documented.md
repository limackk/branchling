---
id: TL-374
title: "Run timeout envelope uses a nullable default and documented key"
type: task
labels: []
board: main
epic: "Controlled and observable agent execution"
priority: P1
status: cancelled  # pending | in_progress | blocked | done | cancelled
owner: agent:codex
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 30m
confidence: medium                 # how much you trust the estimate
created: 2026-09-07
updated: 2026-09-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: [scripts/json-envelope.mjs, docs/manual.md] # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: timeout-envelope
    bash: "node --test scripts/tests/run-control.test.mjs scripts/tests/run-detach.test.mjs"
---

## Goal

Archive this duplicate diagnostic task. TL-249 already made the intended change:
the public `run` envelope always includes `timedOut` with `null` as its
non-wait default, and the manual documents the key. Keeping a second task for
the same correction would make the backlog claim that there is still work to do.

## Context

During the live execution test, the JSON-envelope shape and manual coverage
were corrected alongside TL-249's green-gate measurement work. This file was
created while diagnosing the suite but never filled in or claimed. Commit
`0172d8c` contains `scripts/json-envelope.mjs`, `docs/manual.md`, and the
run-control tests that implement and prove the correction.

Cancellation is the accurate outcome: TL-374 did not have an independent
implementation thesis after TL-249 closed. Repeating the patch would only
obscure the original evidence.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/json-envelope.mjs` — confirm that the stable run shape declares
   `timedOut: null`.
2. `docs/manual.md` — confirm that the reading-command envelope documents the
   nullable timeout key.
3. `scripts/tests/run-control.test.mjs` — confirm that a timed wait reports a
   boolean without changing the running state.

## Steps

1. Run the focused timeout-envelope tests against the current tree.
2. Cancel this task with a reason that names TL-249 as the owning correction.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] The stable run envelope declares `timedOut`, and a timed wait reports its
  boolean result without ending a live run. [proof: timeout-envelope]
