---
id: TL-355
title: "Every run names one orchestration authority"
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
blocked_by: [TL-352, TL-353, TL-354] # ids of tasks that MUST be closed before this one starts
blocks: [TL-356, TL-357, TL-361]   # ids this task will unblock
related_docs: [docs/backlog-config-and-portability.md, scripts/agent-contract.mjs, scripts/run-loop.mjs]
verification:                      # HOW to check the task is really done
  - id: authority-contract
    bash: "node --test scripts/tests/run-agent-profiles.test.mjs scripts/tests/run-agent-launch.test.mjs scripts/tests/agent-adapter-conformance.test.mjs"
---

## Goal

Every agent run declares which layer owns delegation: Branchling-managed
workers, provider-managed subagents, or an explicit hybrid. The choice reaches
the adapter and execution receipt without adding provider names to core.

## Context

Branchling can route repository roles to local profiles while Codex, Claude and
future harnesses may also spawn their own subagents. Without one declared
authority, two schedulers can compete for the same files and backlog tasks.
OpenAI's multi-agent contract makes provider delegation configurable and warns
against agents contending over shared mutable state. The core must express a
provider-neutral policy, not infer behavior from an adapter filename. Keep the
choice as execution policy rather than repository vocabulary or a permanent
property of a reusable launch.

## Pre-flight reading

1. `scripts/run-loop.mjs` — follow profile resolution, adapter environment and
   execution receipts.
2. `scripts/agent-contract.mjs` — extend the provider-neutral contract rather
   than branching on Codex or Claude.
3. `docs/backlog-config-and-portability.md` — preserve the disjoint project and
   user configuration layers.

## Steps

1. Add a closed delegation-policy vocabulary with clear CLI help and JSON.
2. Pass the policy to adapters and record requested policy separately from the
   adapter's enforcement claim.
3. Refuse ambiguous or unsupported managed execution before claiming a task;
   provide one explicit override for uncontrolled adapters.
4. Cover raw commands, one general profile and role-routed launches without
   changing their existing default routing.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] A run exposes one requested delegation policy in CLI, JSON, adapter
      environment and local receipt. [proof: authority-contract]
- [x] Enforcement is reported as `enforced`, `requested` or `unsupported`; a
      provider cannot turn a request into false confirmation. [proof: authority-contract]
- [x] A managed fleet refuses an unsupported adapter before any task is
      claimed unless the operator explicitly accepts it. [proof: authority-contract]
- [x] No provider name or model-specific branch enters the core contract.
      [proof: authority-contract]
