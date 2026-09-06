---
id: TL-299
title: "Provider-neutral execution has an executable wave plan"
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
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs:
  - backlog/plan.yaml
  - docs/branchling-global-tool.md
verification:
  - id: plan-valid
    bash: "node scripts/cli.mjs check --plan"
  - id: set-valid
    bash: "node scripts/cli.mjs check"
---

## Goal

The Provider-neutral agent execution epic has an executable sequence of small
waves. Every task is scheduled after its declared prerequisites, independent
work is visibly parallel, and managed worker orchestration follows the stable
single-agent and adapter surface instead of defining it accidentally.

## Context

Nine tasks define profiles, the provider-neutral adapter contract, API-backed
harnesses, role routing, a generalist mode, preflight, conformance and
onboarding. They are currently unplanned. TL-149 is the active planned task but
would build managed worktrees before the profile and adapter boundaries are
stable. TL-295 is an unscheduled concurrency defect in `new`; a fleet whose
agents create discoveries must not be built on an identifier race.

The plan must preserve branchling's boundary: the project owns roles and their
briefs, the user owns provider profiles, adapters own vendor protocols, and
`run` owns task execution and verification. Do not place every task in one
nominal wave. A wave means its members may proceed without relying on unfinished
work beside them.

Two gaps need explicit tasks rather than prose in this plan: the trust boundary
for executing user-selected adapters against repository-controlled input, and
copyable reference adapters that prove the extension path is usable without
putting provider branches into core.

## Pre-flight reading

1. `backlog/plan.yaml` — preserve its comments and the completed historical
   waves while extending the executable order.
2. The tasks in the Provider-neutral agent execution epic — use their declared
   `blocked_by` edges rather than inventing a second dependency graph.
3. `backlog/tasks/TL-149-run-workers-n-owns-the-branch-lifecycle-of-a-fleet-of.md`
   — place managed parallelism after the execution boundary it will consume.
4. `backlog/tasks/TL-295-concurrent-new-commands-can-reserve-the-same-task-id.md`
   — schedule the prerequisite that makes discovery safe under concurrency.

## Steps

1. Add self-contained tasks for the adapter trust boundary and reference
   adapters, with executable verification contracts.
2. Correct missing dependency edges between profile execution, preflight,
   onboarding and managed workers.
3. Add waves from concurrency safety through profile semantics, the adapter
   contract, execution modes, validation, onboarding and managed workers.
4. Keep independent work in the same wave only when every member can complete
   without another member's result.
5. Run the plan guard and the complete backlog guard before closing.

## Acceptance criteria

- [x] Every open task in the epic is scheduled in a wave that does not precede
      any declared blocker. [proof: plan-valid]
- [x] TL-295 precedes managed concurrent execution, and TL-149 follows the
      stable profile, adapter and onboarding surface. [proof: plan-valid]
- [x] Adapter security and usable reference integrations are represented by
      self-contained tasks rather than assumptions inside another task.
      [proof: set-valid]
- [x] The plan remains executable and the repository's complete backlog guards
      pass. [proof: set-valid]
