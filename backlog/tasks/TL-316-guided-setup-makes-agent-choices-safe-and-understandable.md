---
id: TL-316
title: "Guided setup makes agent choices safe and understandable"
type: task
labels: []
board: main
epic: "Guided agent setup"
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:codex
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-09-06
updated: 2026-09-07
blocked_by: [TL-313, TL-314, TL-315] # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs:
  - README.md
  - docs/manual.md
  - docs/backlog-config-and-portability.md
  - examples/agent-adapters/README.md
verification:                      # HOW to check the task is really done
  - id: documentation-tests
    bash: "node --test scripts/tests/docs-drift.test.mjs scripts/tests/agent-profile-setup.test.mjs"
  - id: product-check
    bash: "node scripts/cli.mjs check --foreign-context && node scripts/cli.mjs check --product-name"
---

## Goal

Make the guided experience explain what it configures, what it deliberately
does not do, and how to recover safely. A user should understand the difference
between a local profile, an adapter, a named fleet launch and an actual run.

## Context

An onboarding flow is trustworthy only when it makes consent and ownership
visible. A provider probe can spend quota; an adapter can execute code; profile
prompts and credentials have different storage rules. The wizard must state
these boundaries in short, contextual copy rather than hide them in a manual.

Do not turn the documentation into a provider catalogue. Reference adapters are
examples, not official support tiers, and the arbitrary adapter path is the
future-provider guarantee.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `README.md` — give new users a short guided entry and retain exact commands
   for automation and advanced users.
2. `docs/backlog-config-and-portability.md` — document the local-data and trust
   boundary precisely once, then link to it from other surfaces.
3. `scripts/cli.mjs` — ensure command help stays a compact decision aid rather
   than a duplicate manual.

## Steps

1. Document the recommended first-run route, generalist versus fleet decision,
   custom adapter path, local data paths, and the dry-run/check/live-probe
   sequence.
2. Add concise in-wizard explanations before each consequential choice and a
   final outcome summary that names created files and the next non-destructive
   command.
3. Document cancellation, correction and removal paths; no user should need to
   edit YAML merely to undo a wizard choice.
4. Add documentation drift and transcript assertions for the commands and
   safety statements that users rely on.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] README and manual distinguish profiles, adapters, launches and runs, and
  direct commands remain available for automation. [proof: documentation-tests]
- [x] The guided text never asks for a secret value or performs a billable/live
  action without a separate explicit command. [proof: documentation-tests]
- [x] Product-context and product-name checks remain green. [proof: product-check]
