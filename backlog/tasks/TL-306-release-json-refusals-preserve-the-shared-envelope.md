---
id: TL-306
title: "Release JSON refusals preserve the shared envelope"
type: task
labels: []
board: main
epic: "Provider-neutral agent execution"
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:codex
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-06
updated: 2026-09-06
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: [docs/manual.md]
verification:                      # HOW to check the task is really done
  - id: release-envelope
    bash: "node --test scripts/tests/release.test.mjs scripts/tests/json-envelope.test.mjs"
---

## Goal

`release --json` answers with the same complete envelope on success and every
refusal path, so a caller never has to parse stderr to learn why the release was
rejected.

## Context

TL-304 added `release` through the handoff write path. The command prints an
envelope after a successful release, but its refusal branches still print only a
human diagnostic. Adding a kind without exercising both paths also leaves the
global JSON-envelope contract test incomplete.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/release-task.mjs` — success and refusal paths for the command.
2. `scripts/json-envelope.mjs` — the shared shape and its emptiness rule.
3. `scripts/tests/json-envelope.test.mjs` — registration that proves every kind.

## Steps

1. Declare the release shape, including refusal information, in the shared
   envelope.
2. Route all command refusals through that shape when `--json` was requested.
3. Document and test both success and refusal responses.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] A release refusal remains valid JSON with its command kind and a concrete
  refusal explanation. [proof: release-envelope]
