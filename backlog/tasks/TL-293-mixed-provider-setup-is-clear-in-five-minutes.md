---
id: TL-293
title: "Mixed-provider setup is clear in five minutes"
type: task
labels: []
board: main
epic: "Provider-neutral agent execution"
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-09-05
updated: 2026-09-05
blocked_by: [TL-290, TL-291, TL-292, TL-294]
blocks: []                         # ids this task will unblock
related_docs:
  - README.md
  - docs/manual.md
verification:
  - id: onboarding
    bash: "node --test scripts/tests/agent-onboarding.test.mjs"
  - id: public-surface
    bash: "node scripts/cli.mjs check --language && node scripts/cli.mjs check --product-name"
---

## Goal

A new user can configure one generalist or a mixed-provider fleet, validate it
and run a dry pass in five minutes from the README. The documentation explains
the ownership boundaries and failure modes without requiring knowledge of
branchling's internal architecture.

## Context

The feature is not complete when the configuration merely exists. Users must be
able to predict which task goes to which agent, where prompts come from, which
credentials are used, and what happens when a provider is unavailable.

Lead with the common case: one general agent. Follow with a two-role example
using Claude for development and Codex for review. Then show that Kimi, GLM,
local models and API-backed harnesses fit the same adapter contract. Vendor
names are examples in documentation, not defaults or closed vocabulary.

Do not publish real model identifiers as timeless recommendations. Clearly mark
where users obtain current provider-specific model names and authentication
instructions.

## Pre-flight reading

1. `README.md` — place the shortest successful path where a new user meets the
   dispatcher.
2. `docs/manual.md` — document the complete profile, adapter and routing model.
3. `scripts/cli.mjs` — make examples match the exact help surface.
4. The completed tasks in this epic — document only behavior the tests prove.

## Steps

1. Write a copyable quickstart for creating, checking and dry-running one
   generalist profile.
2. Add a mixed `dev`/`review` example using different providers and explain
   prompt composition.
3. Add provider-neutral CLI and API-backed harness examples with credential
   environment variables represented by names, never values.
4. Document precedence, missing profiles, unavailable binaries, quota/auth
   failures, timeouts and logs.
5. Test every command snippet against isolated fixtures so documentation cannot
   silently drift from the CLI.

## Acceptance criteria

- [ ] The README path from no profile to a successful generalist dry run is
      executable in an isolated home. [proof: onboarding]
- [ ] The mixed-provider example visibly routes development and review to
      different profile names. [proof: onboarding]
- [ ] CLI, local-model and API-backed adapter paths share one conceptual model,
      and provider examples introduce no production defaults. [proof: public-surface]
