---
id: TL-644
title: "next can say what it would hand out without claiming it"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 3h
confidence: medium                 # how much you trust the estimate
created: 2026-11-07
updated: 2026-11-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: next-dry-run
    bash: "node --test scripts/tests/next-dry-run.test.mjs"
---

## Goal

`branchling next --dry-run` (and `--dry-run --json`) answers which task `next` would hand out with the same flags, without claiming it: no reservation in the state directory, no change to any task file, no history record. The question "what should I work on" stops having a write as its side effect.

## Context

Observed on 2026-11-07: a session asked only to survey the backlog ran `next`, which claimed TL-571 (pending -> in_progress, owner agent:claude). Undoing it took `release --reason` (refused without one) plus discarding the two changed files with `git restore`, because the history kept both the claim and the release. `next --help` offers `--probe`, which also claims; the only read-only projection is `run --dry-run --plan`, a different command whose flags and output answer a different question (the whole run, not the next task). The selection lives in scripts/next-task.mjs; the dry run must reuse it rather than re-implement it, or the projection and the real hand-out will drift apart (the class of bug TL-206 fixed for `run`).

## Steps

1. Add `--dry-run` to `next` in scripts/next-task.mjs and to its row in the COMMANDS table of scripts/cli.mjs, including --help.
2. Run the same selection, then stop before the reservation and every write; print the task and say that nothing was claimed. Under --json answer in the `task-take` kind with `taken: false` and a field that says it was a dry run.
3. Test: on a fixture, `next --dry-run` names the same id a following real `next` takes, and between the two the tree (`git status --porcelain`) and the state directory are unchanged.

## Acceptance criteria

- [ ] next --dry-run names the task next would take and writes nothing [proof: next-dry-run]
