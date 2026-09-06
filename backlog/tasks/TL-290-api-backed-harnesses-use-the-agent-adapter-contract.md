---
id: TL-290
title: "API-backed harnesses use the agent adapter contract"
type: task
labels: []
board: main
epic: "Provider-neutral agent execution"
priority: P1
status: pending  # pending | in_progress | blocked | done | cancelled
owner: ""
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-09-05
updated: 2026-09-06
blocked_by: [TL-289, TL-300]
blocks: [TL-293, TL-301]
related_docs:
  - docs/branchling-global-tool.md
verification:
  - id: api-harness
    bash: "node --test scripts/tests/agent-api-harness.test.mjs"
  - id: no-provider-lock-in
    bash: "node scripts/cli.mjs check --product-name && node --test scripts/tests/agent-adapter.test.mjs"
---

## Goal

An agent harness authenticated with an API key can serve a branchling profile
through the same adapter contract as subscription-backed CLIs. Adding Kimi,
GLM, another OpenAI-compatible endpoint or a future API provider requires
configuration or an external adapter, not a change to branchling's core.

## Context

A raw language-model HTTP response is not a coding agent: it cannot inspect the
tree, apply edits, run verification or manage tool calls by itself. Branchling
must not quietly become an agent SDK in order to claim API support. The unit of
integration is an executable harness that owns its provider protocol and tool
loop and implements TL-289's process contract.

API credentials stay in provider environment variables or credential stores.
The profile may name which environment variable an adapter expects, but may not
contain its value. OpenAI-compatible APIs are an important path for Kimi and GLM
deployments, not a reason to hard-code either provider name or assume all future
APIs share one schema.

## Pre-flight reading

1. `scripts/seed-adapter.mjs` — learn from the existing OpenAI-compatible HTTP
   boundary without reusing a planning-only model call as a coding agent.
2. `scripts/run-loop.mjs` — keep agent execution and verification ownership
   where they already live.
3. `backlog/tasks/TL-289-one-adapter-contract-serves-every-agent-provider.md` —
   implement exactly the provider-neutral contract established there.

## Steps

1. Document what an API-backed harness must do and what branchling deliberately
   does not do.
2. Add a deterministic integration fixture: a fake remote model endpoint behind
   a small harness adapter that completes a repository task.
3. Prove credentials are read only by the adapter from an environment-variable
   reference and never appear in task input, reports or logs.
4. Demonstrate both an OpenAI-compatible request shape and a differently shaped
   mock provider without adding provider branches to core code.
5. State how third parties publish adapters as ordinary executables.

## Acceptance criteria

- [ ] A mock API-backed harness completes a task through the normal adapter
      contract, including verification and closure. [proof: api-harness]
- [ ] Credential values are absent from stdout, stderr, task input and stored
      run logs. [proof: api-harness]
- [ ] Two incompatible mock API shapes work without provider names or branches
      in branchling core. [proof: no-provider-lock-in]
