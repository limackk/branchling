---
id: TL-376
title: "Profile runs attribute the selected provider instead of a stale default actor"
type: bug
labels: []
board: main
epic: "Controlled and observable agent execution"
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:codex
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-09-07
updated: 2026-09-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: [scripts/run-loop.mjs, scripts/agent-profiles.mjs, scripts/tests/run-agent-profiles.test.mjs] # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: profile-attribution
    bash: "node --test scripts/tests/run-agent-profiles.test.mjs scripts/tests/execution-records.test.mjs"
---

## Goal

Make the actor recorded by a profile-driven run identify the provider selected
by that profile when the caller did not explicitly supply `--actor`. A run of
the Codex adapter must not be recorded as `agent:claude`, because the activity
history and execution receipts are evidence a user relies on to audit who did
the work.

## Context

The live end-to-end run of TL-308 used profile `codex-dev-terra` and recorded
the requested model `gpt-5.6-terra` correctly, but its run and attempt records
used the stale default actor `agent:claude`. The model receipt prevents a false
provider conclusion only for readers who inspect the nested execution record;
the top-level attribution remains misleading.

Preserve an explicitly passed `--actor`: it is an operator's deliberate
attribution and must take precedence. Do not infer a vendor from arbitrary
adapter paths; derive the safe default from the selected profile/adapter
contract, or require the profile to declare it if that contract has no stable
provider identity.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/run-loop.mjs` — trace actor defaulting, run record construction and
   the environment passed to the adapter.
2. `scripts/agent-profiles.mjs` — identify profile metadata available to the
   launcher and its validation boundaries.
3. `scripts/tests/run-agent-profiles.test.mjs` — extend the real profile-run
   contract without duplicating fixture setup.
4. `scripts/tests/execution-records.test.mjs` — retain provenance guarantees in
   the durable receipt.

## Steps

1. Define the profile-level source of a default actor and validate it alongside
   existing profile fields.
2. Make profile launches use that source only when `--actor` is absent; preserve
   explicit actor and raw-agent behaviour.
3. Record the resolved actor consistently in run, attempt and task history
   records.
4. Add positive controls for Codex profile attribution and explicit override.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] A Codex profile run without `--actor` records a Codex actor in both the
  run and its execution receipt. [proof: profile-attribution]
- [x] An explicit `--actor` remains unchanged by profile defaulting.
  [proof: profile-attribution]
