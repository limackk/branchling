---
id: TL-493
title: "seed and plan take the fields a module backlog needs, and done runs a project closing contract"
type: task
labels: []
board: main
epic: "Parallel worktree loops"
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-10-27
updated: 2026-10-27
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: seed
    bash: "node --test scripts/tests/seed.test.mjs scripts/tests/plan-write.test.mjs"
  - id: closing
    bash: "node --test scripts/tests/done-closing-contract.test.mjs"
---

## Goal

`seed` accepts epic, role, executor, labels, related_docs and wave per item; `plan add` accepts several ids; a project config key `closing_contract` adds verification entries that `done` runs for every task.

## Context

Observed in a downstream repository on the night of 2026-10-26/27: three `branchling run` loops, one per git worktree of one clone, each driven by a wrapper script that merges the base branch into the loop branch before a task and back after it, and pauses every loop on any failure. The loops paused many times in one night. Pain points 5 and 7. Seeding 55 tasks of a module needed hand edits of epic, executor and related_docs after seed (ITEM_KEYS in scripts/seed-backlog.mjs ~90 has none of them) and 55 `plan add` calls. One task closed with module tests green while repo-wide guards (tenant isolation, query budget) failed after the merge; a closing contract would have caught it.

## Steps

1. Extend ITEM_KEYS, validateItems and writePlan (~592), scheduling waves like `new --wave`.
2. Multi-id `plan add`.
3. closing_contract config key appended by done-task.mjs before the contract runs.
4. Tests.

## Acceptance criteria

- [ ] seed writes the new fields and waves, plan add takes several ids [proof: seed]
- [ ] done runs the project closing contract [proof: closing]
