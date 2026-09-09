---
id: TL-336
title: "Guided setup suggests a safe adapter copy destination"
type: task
labels: []
board: main
epic: "Provider-neutral agent execution"
priority: P1                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:codex
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 30m
confidence: medium                 # how much you trust the estimate
created: 2026-09-07
updated: 2026-09-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: [scripts/agent-profiles.mjs, scripts/home.mjs, backlog/tasks/TL-382-provider-execution-uses-one-thin-user-owned-adapter-path.md] # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: guided-default
    bash: "node --test scripts/tests/agent-profile-setup.test.mjs"
---

## Goal

Choosing a shipped adapter should not first require inventing a filesystem
layout. The guided flow offers an editable, user-owned default destination and
uses it when the user presses Enter, while still accepting an explicit path for
project-specific adapters.

## Context

Profiles are user configuration, not project configuration. A default under the
same user configuration directory therefore travels with the profile and
avoids creating untracked files in an arbitrary repository. The suggestion must
be derived from the selected adapter's stable identifier, not its display label.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/agent-profiles.mjs` — the terminal-independent profile interview
   and copy boundary.
2. `scripts/home.mjs` — the cross-platform, user-owned configuration location.
3. `scripts/tests/agent-profile-setup.test.mjs` — transcript tests for the
   no-write-until-confirmed contract.

## Steps

1. Derive a per-user adapter path from the selected reference identifier.
2. Explain the recommendation in the interview and accept Enter as that value.
3. Preserve a user-entered destination and cover both paths in transcript tests.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] A selected reference shows a user-owned recommended destination and Enter
  copies to it. [proof: guided-default]
- [x] An explicit destination still wins over the suggestion. [proof: guided-default]
- [x] The flow still writes neither profile nor adapter before confirmation.
  [proof: guided-default]
