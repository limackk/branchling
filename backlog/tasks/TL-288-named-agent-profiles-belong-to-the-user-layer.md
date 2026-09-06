---
id: TL-288
title: "Named agent profiles belong to the user layer"
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
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: [TL-289, TL-291, TL-292, TL-294, TL-300]
related_docs:
  - docs/backlog-config-and-portability.md
verification:
  - id: profile-store
    bash: "node --test scripts/tests/agent-profiles.test.mjs scripts/tests/user-config.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

Users can create, inspect, update and remove named agent profiles without editing
branchling's source. A profile keeps the user's prompt, adapter, model and effort
in the user layer, so two contributors may use different providers against the
same repository and both remain correct.

## Context

`run` currently accepts raw shell command strings through `--agent`,
`--agent-for` and `BACKLOG_AGENT_COMMAND`. That proves provider neutrality, but
it is not a reusable configuration: a mixed fleet must reconstruct quoting,
prompts, model names and effort flags on every invocation.

Profiles are facts about a person and their machine. They must not enter the
project's `backlog/config.yaml`, which owns shared vocabulary, and credentials
must never be copied into a profile. Store only references to environment
variables or provider configuration. Do not introduce a closed provider enum:
Codex and Claude are today's examples, while Kimi, GLM and future providers must
work without a branchling release.

The profile format should be easy to read and diff, but it may remain local.
Record the chosen file shape and command names with `branchling decide`; the
task deliberately specifies the contract rather than guessing the syntax.

## Pre-flight reading

1. `scripts/home.mjs` — preserve the disjoint user and project configuration
   layers and the existing XDG path rules.
2. `scripts/run-loop.mjs` — understand the raw command inputs profiles will
   eventually replace by name.
3. `scripts/config.mjs` — do not move project vocabulary into the user layer.
4. `docs/backlog-config-and-portability.md` — keep the portability contract.

## Steps

1. Decide and record the smallest local file shape that can represent a name,
   executable adapter, optional model, optional effort, and either an inline
   prompt or prompt-file reference.
2. Add parsing and validation with unknown keys rejected and clear diagnostics.
3. Add a CLI surface for creating, listing, showing, editing and removing
   profiles; every write must also be expressible non-interactively with flags.
4. Reject inline credentials and document environment-variable references as
   the secret boundary.
5. Keep existing user configuration files valid without migration.

## Acceptance criteria

- [ ] Two isolated users can define profiles with the same name and different
      adapters, models, efforts and prompts without changing the repository.
      [proof: profile-store]
- [ ] Unknown fields, duplicate names, unreadable prompt files and credential
      values in forbidden fields fail with actionable errors. [proof: profile-store]
- [ ] Existing user configuration and raw `run` commands remain valid.
      [proof: suite-green]
