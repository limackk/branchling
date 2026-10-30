---
id: TL-497
title: "check --proofs runs a project closing entry once per audit"
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
  - id: proofs-project-once
    bash: "node --test scripts/tests/proofs-project-once.test.mjs"
---

## Goal

`check --proofs` runs each project `closing_contract` entry at most once per audit and reuses its result for every proven closing, instead of once per closing.

## Context

Since TL-495, scripts/check-backlog-proofs.mjs appends the project `closing_contract` to every proven closing's contract, as `done` does. Against one tree those entries give one answer, yet the audit re-runs them for each closing: with a repository-wide suite as the project entry and hundreds of closings, the audit costs that suite hundreds of times, and one red project entry is reported as hundreds of broken proofs. The cost line printed before the first command already counts them, so the cost is visible but not bounded.

## Steps

1. Run the project entries once, after the first closing's own entries, and cache the result by id and command
2. Report a red project entry once, as a project finding, with the closings it would have failed
3. A fixture test in scripts/tests/proofs-project-once.test.mjs: two proven closings, one run of the project entry

## Acceptance criteria

- [ ] check --proofs runs a project entry once per audit [proof: proofs-project-once]
