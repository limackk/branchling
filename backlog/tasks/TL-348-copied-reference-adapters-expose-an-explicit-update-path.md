---
id: TL-348
title: "Copied reference adapters expose an explicit update path"
type: code
labels: [agents, setup]
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: cancelled                  # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-07
updated: 2026-09-08
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: adapter-update-tests
    bash: "node --test scripts/tests/agent-profile-setup.test.mjs scripts/tests/agent-reference-adapters.test.mjs"
---

## Goal

A copied reference adapter must disclose its source version and have one
explicit, safe update path. A person who set up a profile months ago must be
able to discover that its local wrapper predates a security or capability fix
without Branchling silently replacing their modifications.

## Context

Profile setup intentionally copies a reference adapter into local configuration
so the user can inspect and change it. That makes the adapter a snapshot: the
Codex effort support added in TL-346 reaches new copies but not existing ones.
Overwriting local wrappers on an upgrade would destroy user changes; leaving no
path makes the product's documented setup stale in silence.

The solution must preserve the local, provider-neutral boundary. It may compare
a recorded source identity with the shipped reference and offer a preview or
explicit replacement, but it must never inspect credentials, infer user edits
as an error, or update any adapter without an affirmative command.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/agent-profiles.mjs` — inspect reference-copy creation and profile
   setup choices.
2. `examples/agent-adapters/` — identify a versioned, copyable reference source.
3. `scripts/tests/agent-profile-setup.test.mjs` — preserve interactive setup
   and non-interactive profile behaviour.
4. `scripts/tests/agent-reference-adapters.test.mjs` — extend the executable
   reference-adapter contract.

## Steps

1. Define the source identity stored beside a newly copied reference adapter.
2. Add a read-only status/preview that distinguishes an unchanged old copy, a
   modified local copy and a current copy.
3. Provide an explicit update command that writes a replacement only after the
   user chooses it; preserve a recoverable backup of a modified local copy.
4. Surface the update path in guided setup and documentation without making a
   provider name part of Branchling core.
5. Add positive, modified-copy and refusal controls.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [ ] An existing reference-adapter copy can be identified as current, outdated
  or locally modified without reading secrets or changing it. [proof: adapter-update-tests]
- [ ] A user can explicitly update an unmodified copy, while a modified copy is
  never overwritten silently and has a recoverable path. [proof: adapter-update-tests]
- [ ] The setup guidance explains that copied adapters are local snapshots and
  points to the update action. [proof: adapter-update-tests]
