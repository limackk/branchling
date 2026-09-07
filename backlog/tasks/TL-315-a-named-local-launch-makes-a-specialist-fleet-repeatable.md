---
id: TL-315
title: "A named local launch makes a specialist fleet repeatable"
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
created: 2026-09-06
updated: 2026-09-07
blocked_by: [TL-314]               # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs:
  - scripts/run-loop.mjs
  - scripts/agent-profiles.mjs
  - docs/backlog-config-and-portability.md
verification:                      # HOW to check the task is really done
  - id: focused-tests
    bash: "node --test scripts/tests/agent-launches.test.mjs scripts/tests/run-agent-profiles.test.mjs"
  - id: run-tests
    bash: "node --test scripts/tests/run-generalist-profile.test.mjs scripts/tests/run-roles.test.mjs"
---

## Goal

Let a person configure a developer/reviewer fleet once and start it later by a
local name, rather than reconstructing a growing `run --profile --profile-for`
command. The saved launch must be local user data and compose existing profiles;
it cannot become repository configuration or a second execution engine.

## Context

One profile is enough for a generalist, but a useful fleet maps the repository's
declared roles to several local profiles. Printing a long command after setup is
better than hidden state, yet it is brittle and fails the goal of making a
complex configuration approachable. A small named local launch is the missing
composition layer.

Keep the configuration deliberately narrow: a launch contains an optional
generalist profile and zero or more role-to-profile mappings. Scheduling,
workers, retry policy, paths and provider settings remain explicit `run` flags.
This avoids inventing a second, opaque job specification.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/run-loop.mjs` — preserve the current claim, preflight, role-routing
   and report behaviour by resolving a launch before the run begins.
2. `scripts/home.mjs` and `scripts/agent-profiles.mjs` — colocate user-owned
   data and match its narrow parser/error style.
3. `scripts/tests/run-agent-profiles.test.mjs` — retain proof that role routing
   selects a profile only from the user's local choices.

## Steps

1. Define, parse and serialize a small local launch store beside agent profiles,
   with unique names, known profile references and role slugs validated against
   the selected repository only when a launch is run.
2. Add non-interactive `launch list`, `show`, `create`, `update` and `remove`
   commands with flags and JSON envelopes, so the data stays accessible to
   scripts and other clients.
3. Add `run --launch <name>` and resolve it before task claim; reject conflicting
   direct profile-routing flags and any broken reference before an agent can take
   work.
4. Extend guided setup with a fleet branch: select a generalist optionally,
   create or select role profiles one at a time, show the mappings, confirm, and
   finish with `run --launch <name> --dry-run`.
5. Test parsing, local-machine isolation, invalid/missing profile or role
   references, run preflight, and routing equivalence with the existing direct
   flags.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] A named local launch recreates the same generalist and role routing as the
  equivalent existing `run` flags. [proof: run-tests]
- [x] Missing profiles, invalid roles and conflicting run inputs fail before a
  task is claimed. [proof: focused-tests]
- [x] Launch data does not modify repository files or expose provider secrets.
  [proof: focused-tests]
