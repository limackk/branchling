---
id: TL-362
title: "Setup explains orchestration and live run control"
type: task
labels: []
board: main
epic: "Controlled and observable agent execution"
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:codex
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-09-07
updated: 2026-09-07
blocked_by: [TL-356, TL-359, TL-360, TL-361] # ids of tasks that MUST be closed before this one starts
blocks: [TL-149]                   # ids this task will unblock
related_docs: [README.md, docs/backlog-config-and-portability.md, scripts/agent-profiles.mjs]
verification:                      # HOW to check the task is really done
  - id: guided-control
    bash: "node --test scripts/tests/agent-profile-setup.test.mjs scripts/tests/run-control.test.mjs scripts/tests/watch.test.mjs"
---

## Goal

A new user can choose who orchestrates work, start the recommended safe mode and
immediately see how to inspect, wait for or cancel the resulting agents.

## Context

The setup already creates a general profile and optional specialist routing,
but it does not explain the conflict between Branchling workers and provider
subagents. Add a short choice with consequences and a recommended default:
Branchling-managed delegation for a specialist fleet, provider-managed helpers
for a single generalist, and hybrid only behind an advanced path. Setup must
not start a provider or consume quota. Its completion screen should print the
exact dry-run, detached start and watch commands for the configuration created.

## Pre-flight reading

1. `scripts/agent-profiles.mjs` — integrate the choice into the existing
   Clack flow without duplicating configuration logic.
2. `README.md` — keep the five-minute path and operator model consistent.
3. `docs/backlog-config-and-portability.md` — explain which choices are local
   execution policy and which data belongs to the repository.

## Steps

1. Explain workers versus provider helpers before asking for a delegation mode.
2. Recommend the mode from the selected generalist or fleet shape while letting
   an advanced user choose explicitly.
3. Show whether each selected adapter enforces, requests or cannot control the
   policy before saving.
4. End with copyable `dry-run`, detached start, watch and cancel guidance.
5. Document the same flow for flags and automation without requiring Clack.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] Every delegation choice states who may claim backlog tasks and what
      provider subagents may do. [proof: guided-control]
- [x] A specialist fleet defaults to Branchling-managed orchestration; one
      generalist can choose provider-managed helpers. [proof: guided-control]
- [x] Unsupported enforcement is visible before configuration is accepted.
      [proof: guided-control]
- [x] Completion prints working dry-run, detached execution, watch and cancel
      commands in TTY and plain-text paths. [proof: guided-control]
- [x] Setup performs no provider call and stores no credential value.
      [proof: guided-control]
