---
id: TL-337
title: "Project-scoped agent profiles stay local to one repository"
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
related_docs: [scripts/agent-profiles.mjs, scripts/home.mjs, scripts/lock.mjs, scripts/run-loop.mjs] # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: project-scope
    bash: "node --test scripts/tests/agent-project-scope.test.mjs scripts/tests/agent-profile-setup.test.mjs scripts/tests/agent-launches.test.mjs"
---

## Goal

A contributor can use a different provider, model, prompt and credential
contract in each repository without exposing that configuration to another
repository or committing it. Guided setup must offer a project-only scope whose
profiles and fleet routing are available from every worktree of that repository
and nowhere else.

## Context

Profiles, prompts, model identifiers, effort and credential-variable names are
facts about a person's machine, never backlog configuration. A project scope is
therefore a local user-state partition keyed by Git's common directory, the same
identity used for locks; this shares an intentional setup across linked
worktrees without relying on checkout paths. Global and project stores are
disjoint: duplicate names fail rather than silently choosing one layer.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/agent-profiles.mjs` — profile storage, setup interview and resolver.
2. `scripts/agent-launches.mjs` — named generalist and role routing storage.
3. `scripts/lock.mjs` — canonical repository identity across worktrees.
4. `scripts/run-loop.mjs` — pre-claim profile and launch resolution boundary.

## Steps

1. Add a local, Git-common-directory keyed store for profiles and launches.
2. Offer global or this-project scope in guided setup, and make reference
   adapters default beside their chosen scope.
3. Resolve project and global configuration as disjoint sets for profile checks,
   named launches and runs; refuse duplicate names.
4. Prove isolation, worktree sharing, adapter copying and fleet routing without
   writing personal configuration into the repository.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] Guided setup offers an explained global-or-this-project choice before it
  writes a profile. [proof: project-scope]
- [x] A project-only profile preserves adapter, prompt, model, effort and
  credential-variable names outside the repository and is unavailable in a
  different repository. [proof: project-scope]
- [x] Project-only fleet routing is available from a linked worktree of the same
  Git repository and is unavailable elsewhere. [proof: project-scope]
- [x] A name occurring in global and project configuration is refused rather
  than silently resolved by precedence. [proof: project-scope]
