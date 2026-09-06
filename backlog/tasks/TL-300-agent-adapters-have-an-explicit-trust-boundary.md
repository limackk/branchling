---
id: TL-300
title: "Agent adapters have an explicit trust boundary"
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
blocked_by: [TL-288, TL-289]
blocks: [TL-290, TL-291, TL-292, TL-294, TL-296]
related_docs:
  - docs/branchling-global-tool.md
  - docs/backlog-human-agent-decisions.md
verification:
  - id: trust-boundary
    bash: "node --test scripts/tests/agent-adapter-security.test.mjs"
  - id: execution-regression
    bash: "node --test scripts/tests/agent-adapter-security.test.mjs scripts/tests/agent-adapter.test.mjs scripts/tests/agent-profiles.test.mjs scripts/tests/run.test.mjs"
---

## Goal

The adapter boundary states and enforces which inputs are trusted, which
repository values are untrusted, which environment variables reach a child
process and which values may be persisted. A project cannot cause an arbitrary
user profile to run or turn a credential into task, report or history data.

## Context

Named profiles execute programs selected by the user, while prompts, role briefs
and task bodies come from a repository that may have been cloned from somebody
else. Provider-neutral execution therefore creates a trust boundary before it
creates a convenience feature. Without an explicit contract, an adapter may
inherit every secret in the parent environment, interpolate repository text
into a shell command or copy credentials into diagnostic output.

Profiles remain user-owned and may name an executable plus references to secret
environment variables. Project configuration may declare roles and prose but
must never select a local profile or executable. Use argument arrays and
structured input; do not claim to sandbox an agent process. The goal is a small,
honest boundary, not a new security runtime.

## Pre-flight reading

1. `scripts/run-loop.mjs` — identify the environment, stdin, shell and logging
   surfaces inherited by current agent commands.
2. `scripts/home.mjs` — preserve the user-owned configuration boundary.
3. `backlog/tasks/TL-288-named-agent-profiles-belong-to-the-user-layer.md` —
   use the profile shape established there.
4. `backlog/tasks/TL-289-one-adapter-contract-serves-every-agent-provider.md` —
   constrain the public process contract before its consumers are built.

## Steps

1. Write a concise threat model covering a malicious repository, an erroneous
   profile and a compromised adapter, with claims limited to what branchling
   can enforce.
2. Prevent project data from selecting a user profile, executable or secret
   variable reference.
3. Pass profile values as arguments or structured input without shell
   interpolation and give adapters only the documented environment contract.
4. Redact referenced credential values from terminal, JSON and stored logs,
   including child-process failures.
5. Add positive controls showing that repository prompts still reach the agent
   as data and that an explicitly selected adapter can receive its named secret.

## Acceptance criteria

- [x] Project-controlled fields cannot select a local profile, executable or
      credential reference. [proof: trust-boundary]
- [x] Profile values and repository text are never interpolated into a shell
      command assembled by branchling. [proof: trust-boundary]
- [x] Sentinel secrets are absent from human output, JSON, task files, history
      and stored run logs on success and failure. [proof: trust-boundary]
- [x] Documentation says that adapters execute with the user's authority and
      that branchling does not sandbox them. [proof: execution-regression]
