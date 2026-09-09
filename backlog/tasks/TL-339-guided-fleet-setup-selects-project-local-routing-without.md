---
id: TL-339
title: "Guided fleet setup selects project-local routing without typed names"
type: task
labels: []
board: main
epic: "Provider-neutral agent execution"
priority: P1                       # P0 blocker | P1 critical | P2 nice | P3 backlog
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
related_docs: [scripts/agent-profiles.mjs, backlog/tasks/TL-382-provider-execution-uses-one-thin-user-owned-adapter-path.md] # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: fleet-choice-flow
    bash: "node --test scripts/tests/agent-profile-setup.test.mjs scripts/tests/agent-project-scope.test.mjs"
---

## Goal

Fleet configuration offers the same safe project-local default as profile
configuration and lets a user choose existing profiles for every repository
role without remembering or typing their names.

## Context

The profile interview now puts project scope and copyable references first, but
the fleet interview still puts global scope first and asks free-text profile
names. A selector can expose names, descriptions and an explicit unassigned
choice consistently in Clack and plain terminals. It must retain the ability to
leave a role or generalist unassigned; missing role coverage is escalation, not
an error.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/agent-profiles.mjs` — fleet conversation and shared choice helper.
2. `scripts/tests/agent-profile-setup.test.mjs` — terminal-independent
   transcript coverage.

## Steps

1. Put this-project fleet routing first and explain both scope options.
2. Replace typed profile references with choices that include each current
   profile and an explicit unassigned outcome.
3. Preserve cancellation and delayed-write semantics in transcript tests.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] The first fleet scope is project-local and the summary reports the chosen
  scope. [proof: fleet-choice-flow]
- [x] Every role and the generalist can be assigned with a selectable profile
  or deliberately left unassigned without typing a profile name. [proof: fleet-choice-flow]
- [x] Invalid typed values in a plain-terminal fallback still fail loudly and
  no launch is written before final confirmation. [proof: fleet-choice-flow]
