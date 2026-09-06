---
id: TL-294
title: "Agent profiles can be checked before a run"
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
created: 2026-09-05
updated: 2026-09-06
blocked_by: [TL-288, TL-289, TL-291, TL-292, TL-300]
blocks: [TL-293, TL-301]
related_docs:
  - docs/manual.md
verification:
  - id: profile-check
    bash: "node --test scripts/tests/agent-check.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

Users can validate agent profiles and a planned role mapping before branchling
claims work. Missing executables, prompt files, credential environment variables
and incompatible profile references fail as setup problems rather than being
recorded as failed task attempts.

## Context

TL-184 proved that an expired login is a machine fact, not evidence that work
failed. Named profiles add more setup that can be wrong before an agent starts.
A professional workflow needs a cheap local preflight and `run` must perform the
deterministic part automatically before touching the queue.

The default check must not spend tokens, make a model request or expose secrets.
An optional adapter-defined live probe may check authentication or reachability,
but it must be visibly opt-in and report that it can incur provider usage.

## Pre-flight reading

1. `scripts/run-loop.mjs` — fail deterministic setup before the first claim.
2. `scripts/tests/run-agent-launch.test.mjs` — preserve the distinction between
   a task failure and an agent that never ran.
3. `scripts/home.mjs` — resolve profiles from the real user configuration path.
4. `scripts/ui.mjs` — use the common diagnostic shape and output rules.

## Steps

1. Add a read-only command that checks one profile or all profiles and supports
   human and JSON output.
2. Validate schema, executable lookup, prompt readability, referenced secret
   variable names and adapter protocol version without contacting a provider.
3. Make `run` perform all deterministic checks for the profiles it will use
   before claiming a task.
4. Define an optional live probe contract with an explicit usage warning and
   stable result categories.
5. Separate setup failures from task outcomes in exit codes and reports.

## Acceptance criteria

- [x] Local checks find missing executables, prompt files and secret-variable
      names without network access or credential disclosure. [proof: profile-check]
- [x] `run` refuses an invalid selected profile before any task is claimed.
      [proof: profile-check]
- [x] JSON distinguishes invalid configuration, unavailable adapter and failed
      optional live probes. [proof: profile-check]
- [x] Existing never-ran and task-failure accounting remains unchanged.
      [proof: suite-green]
