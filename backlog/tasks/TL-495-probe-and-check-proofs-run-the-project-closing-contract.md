---
id: TL-495
title: "probe and check --proofs run the project closing contract"
type: task
labels: []
board: main
epic: "Parallel worktree loops"
priority: P3
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-10-30
updated: 2026-10-30
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: probe-closing
    bash: "node --test scripts/tests/done-closing-contract.test.mjs"
---

## Goal

`check --proofs` and `probe` run the project `closing_contract` (config.yaml, TL-493) after a task's own entries, exactly as `done` does, so a probe before work and a proof audit see the same red lines the closing will.

## Context

TL-493 added `closing_contract` and `withClosingContract()` in scripts/done-task.mjs, used only by `done`. `probeTask()` in scripts/done-task.mjs and the proofs guard (scripts/check-backlog-proofs.mjs) still parse only the task frontmatter, so a task whose module tests pass is reported green there while `done` would refuse it on a project entry.

## Steps

1. Route probeTask and check --proofs through withClosingContract
2. Report a shared id the way done refuses it
3. Tests with a fixture config, including a failing project entry as positive control

## Acceptance criteria

- [x] probe and check --proofs run the project closing_contract [proof: probe-closing]
