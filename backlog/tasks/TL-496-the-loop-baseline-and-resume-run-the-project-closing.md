---
id: TL-496
title: "The loop baseline and resume run the project closing contract"
type: task
labels: []
board: main
epic: "Parallel worktree loops"
priority: P3
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-10-30
updated: 2026-10-30
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: loop-inherits-project-red
    bash: "grep -q closingContractOf scripts/run-loop.mjs && grep -q closingContractOf scripts/resume-task.mjs"
---

## Goal

The worktree loop's inherited-red check and `resume` read the contract `done` runs, project `closing_contract` included, through `closingContractOf()` in scripts/done-task.mjs.

## Context

TL-495 routed `done`, `take --probe`, `next --probe` and `check --proofs` through `closingContractOf()`. Two readers still parse only the task's own `verification:`: `contractProbe()` in scripts/run-loop.mjs, whose rows feed `baselineFailure()` — so a project entry that was already red when the hand took the task is not in the baseline, and the refusal `done` produces on it is treated as the hand's own failure — and the contract run in scripts/resume-task.mjs (around `contractProblem(entries, problems)`).

## Steps

1. Route contractProbe in scripts/run-loop.mjs through closingContractOf, refusing a shared id as probeTask does
2. Route the contract read in scripts/resume-task.mjs through closingContractOf
3. A fixture test: a project entry red at take is reported as inherited, not as the hand's failure

## Acceptance criteria

- [ ] The loop baseline and resume read the contract done runs [proof: loop-inherits-project-red]
