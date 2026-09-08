---
id: TL-381
title: "Execution leaves branch and worktree lifecycle to the caller"
type: task
labels: []
board: main
epic: "Evidence-gated product focus"
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-08
updated: 2026-09-08
blocked_by: [TL-377]
blocks: []                         # ids this task will unblock
related_docs:
  - README.md
  - scripts/run-loop.mjs
verification:
  - id: execution-boundary
    bash: "node --test scripts/tests/execution-product-boundary.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

`run` executes one task at a time in the caller's existing working tree and
returns an honest, bounded result. Branch creation, worktree lifecycle, worker
pools, detached supervision, merge and cleanup remain owned by the caller or an
external orchestrator.

## Context

Branchling must still demonstrate provider replacement, retry after a failed
verification and safe recovery from a dead agent. Those outcomes need a
sequential process boundary, not a software-factory runtime. Keep `run` as the
composition of `next`, one external command and `done`; remove machinery that
exists to supervise several processes or to own Git topology.

An agent may still be launched by an external command in a worktree prepared by
the caller. Branchling receives that working directory and does not create,
merge or remove it.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/run-loop.mjs` — separate the one-task contract from orchestration.
2. `scripts/run-control.mjs`, `scripts/watch.mjs` and execution record modules —
   identify detached and live-supervision machinery.
3. `scripts/next-task.mjs` and `scripts/done-task.mjs` — preserve their public
   behaviour rather than reimplementing it inside `run`.
4. `README.md` and execution instructions — make ownership of Git lifecycle
   explicit.

## Steps

1. Retain one foreground, single-worker `run` path with bounded retries.
2. Remove `runs`, `watch`, managed-worker flags and detached process control.
3. Remove any code or promise for automatic branch, worktree, merge or cleanup.
4. Keep plan-aware selection optional and consistent with `next` and `done`.
5. Add a fixture proving the caller's branch and worktree are never created,
   merged, switched or removed by `run`.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [ ] One foreground agent can receive a task, fail verification, retry and
      close only after evidence succeeds. [proof: execution-boundary]
- [ ] No shipped command manages parallel workers or detached runs.
      [proof: execution-boundary]
- [ ] Execution never creates, merges, switches or removes a branch or worktree.
      [proof: execution-boundary]
- [ ] Plan-aware execution and direct `next` use the same eligibility rules.
      [proof: execution-boundary]
- [ ] The complete remaining suite passes. [proof: suite-green]
