---
id: TL-338
title: "Guided profile setup defaults to the shortest safe path"
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
  - id: shortest-safe-flow
    bash: "node --test scripts/tests/agent-profile-setup.test.mjs scripts/tests/agent-project-scope.test.mjs"
---

## Goal

First-time setup must make the safe, inspectable reference-adapter path the
fewest-keystroke path while keeping custom adapters and global profiles easy to
choose deliberately. Every blank value must either mean a named default or be
explained as intentionally unset.

## Context

The current interview puts custom adapters and global scope first even though
its own hints call them advanced or less local. It has a good default copy
destination but no default task prompt, treats `back` at adapter selection as
cancellation, and does not distinguish a reference that needs a model from one
whose provider CLI can choose one. Defaults may never guess credentials or a
provider model name.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/agent-profiles.mjs` — setup state machine and reference metadata.
2. `scripts/tests/agent-profile-setup.test.mjs` — transcript-level no-write and
   cancellation guarantees.
3. `examples/agent-adapters/README.md` — provider-specific preparation users
   must understand before a real run.

## Steps

1. Put the recommended project scope and copied reference route first.
2. Offer a named generic prompt default; leave model, effort and credentials
   intentionally optional unless a selected reference requires a model.
3. Make adapter source and destination back navigation return to the preceding
   decision without writing.
4. Explain a selected reference's model requirement beside the input and
   include scope in the final summary and next command.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] The first selectable scope and adapter route are the recommended local,
  copied-reference choices. [proof: shortest-safe-flow]
- [x] Enter accepts named defaults for the starter prompt and copy destination;
  it never invents a provider model or credential. [proof: shortest-safe-flow]
- [x] A reference whose adapter needs a model refuses a blank model with an
  actionable preparation message. [proof: shortest-safe-flow]
- [x] Back from reference selection or destination revisits the relevant choice
  and leaves both configuration stores unchanged until confirmation.
  [proof: shortest-safe-flow]
