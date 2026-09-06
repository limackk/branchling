---
id: TL-304
title: "A claimed task can be released back to the queue"
type: task
labels: []
board: main
epic: "Provider-neutral agent execution"
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:codex
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-09-06
updated: 2026-09-06
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: [TL-290]
related_docs:
  - docs/branchling-global-tool.md
verification:
  - id: release-contract
    bash: "node --test scripts/tests/release.test.mjs scripts/tests/handoff.test.mjs"
---

## Goal

An actor that claimed a task can explicitly return it to the queue without
inventing a receiver. The command clears the owner and session reservation,
records why work stopped, and never changes a closed or somebody else's task.

## Context

`handoff` deliberately requires a receiver, because passing work to a role or
person is different from putting it down. TL-290 exposed the missing companion:
an agent must be able to defer work safely when its scope is deliberately moved
to a later phase. Reuse the existing history, lock and queue semantics rather
than editing frontmatter directly.

## Pre-flight reading

1. `scripts/handoff-task.mjs` — preserve the one write path and queue policy.
2. `scripts/take-task.mjs` — release the reservation held by a claim.
3. `scripts/tests/handoff.test.mjs` — retain handoff's distinct receiver rule.

## Steps

1. Add a `release <ID> --reason` command that works only for the claiming actor.
2. Reuse the in-progress queue-status resolution and lock release from handoff.
3. Record the reason in field history and an event readable by the next worker.
4. Cover success, another actor, closed task and a positive re-take.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] A claimant can return an in-progress task to the queue with a reason and
      no owner or reservation left behind. [proof: release-contract]
- [x] A release never takes work from another actor or reopens a closed task.
      [proof: release-contract]
