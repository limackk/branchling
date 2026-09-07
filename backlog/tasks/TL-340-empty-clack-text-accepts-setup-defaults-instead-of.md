---
id: TL-340
title: "Empty Clack text accepts setup defaults instead of cancelling"
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
related_docs: [scripts/agent-profiles.mjs, scripts/tests/agent-profile-setup.test.mjs] # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: empty-means-default
    bash: "node --test scripts/tests/agent-profile-setup.test.mjs"
---

## Goal

Pressing Enter at a Clack text prompt with a displayed default passes an empty
answer into setup so the default is used; it does not cancel setup.

## Context

Clack returns `undefined` for an accepted empty text entry. The current bridge
passes that value to `setupAnswer`, whose deliberate EOF/cancellation rule also
treats `undefined` as cancellation. The bridge, not the state machine, must
normalise this provider-specific empty value to an empty string while preserving
Clack's explicit cancel sentinel.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/agent-profiles.mjs` — Clack bridge and setup answer semantics.
2. `scripts/tests/agent-profile-setup.test.mjs` — transcript defaults and
   regression tests.

## Steps

1. Isolate the Clack text-result normalisation.
2. Map accepted empty text to `""` and cancellation to `null`.
3. Prove the default path without conflating it with an EOF transcript.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] An accepted empty Clack text result reaches setup as an empty string and
  therefore accepts a displayed default. [proof: empty-means-default]
- [x] The Clack cancellation sentinel still reaches setup as cancellation.
  [proof: empty-means-default]
