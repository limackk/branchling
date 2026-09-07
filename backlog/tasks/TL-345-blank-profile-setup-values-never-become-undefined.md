---
id: TL-345
title: "Blank profile setup fields render as empty"
type: bug
labels: [agents, cli]
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
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
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: setup-tests
    bash: "node --test scripts/tests/agent-profile-setup.test.mjs"
---

## Goal

Accepting Enter in an optional text field of `branchling profile setup` must
render an empty submitted value and persist an empty profile field. The terminal
must never show the literal word `undefined` as if it were a selected effort or
credential configuration.

## Context

During project-local Codex profile setup, accepting the optional `Reasoning
effort` field with Enter displayed `undefined`. The state boundary already
normalises Clack's missing result to an empty string, so the profile would not
need an `undefined` value. The fault is in Clack's submitted-text rendering:
without a placeholder it renders its own absent default as that word. The same
path affects every optional text question in the guided setup.

Do not introduce a fake value such as `none`: it would be passed to an adapter
as an actual provider setting. Give Clack an explicitly empty presentation
fallback instead, preserving the empty value passed into the existing state
normalisation.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/agent-profiles.mjs` — inspect the guided Clack text boundary and
   the existing empty-result normalisation.
2. `scripts/tests/agent-profile-setup.test.mjs` — extend the focused setup
   contract without depending on a real terminal.

## Steps

1. Add one small, named helper for the Clack text options used by guided setup.
2. Set its placeholder to an explicit empty string so Clack's submitted render
   has no absent value to stringify.
3. Use the helper at the terminal boundary and add a focused test for it.
4. Run the declared verification.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] An accepted blank optional field has an empty presentation fallback, not
  an undefined one. [proof: setup-tests]
- [x] The existing cancellation and accepted-empty input semantics remain
  covered by the focused setup test suite. [proof: setup-tests]
