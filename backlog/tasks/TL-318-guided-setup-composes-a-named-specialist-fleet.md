---
id: TL-318
title: "Guided setup composes a named specialist fleet"
type: task
labels: []
board: main
epic: "Guided agent setup"
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:codex
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-09-07
updated: 2026-09-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs:
  - scripts/agent-profiles.mjs
  - scripts/run-loop.mjs
verification:                      # HOW to check the task is really done
  - id: focused-tests
    bash: "node --test scripts/tests/agent-profile-setup.test.mjs scripts/tests/agent-launches.test.mjs"
---

## Goal

Extend the guided terminal path so a user can select or create profiles for
declared roles, review the mapping and save one named local launch without
assembling `launch create` flags.

## Context

TL-315 delivered the stable, flag-addressable launch store and `run --launch`.
It did not add a multi-profile interview to `profile setup`: combining profile
creation, role discovery and launch composition in the same change would have
obscured the safety boundary. This task is the remaining guided UX, built only
on that proven store.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/agent-profiles.mjs` — retain cancellation and one-final-write rules.
2. `scripts/agent-launches.mjs` — use its parser and creation operation rather
   than a wizard-only launch shape.
3. `scripts/run-loop.mjs` — preserve the distinction between local routing and
   explicit execution policy.

## Steps

1. Let the user choose generalist or specialist-fleet setup in the terminal.
2. For a fleet, list profiles already local to the machine, allow creation of a
   missing one through the existing profile interview, and select declared roles
   from the resolved backlog.
3. Present role mappings and launch name for one confirmation, then write a
   normal local launch and print `run --launch <name> --dry-run`.
4. Reject a non-backlog working directory for fleet role selection without
   writing anything, and retain a custom-adapter route for every new profile.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] A confirmed fleet interview creates only ordinary profiles and a normal
  local launch, which `run --launch` can consume. [proof: focused-tests]
- [x] Cancellation and an invalid role selection leave both local stores
  unchanged. [proof: focused-tests]
