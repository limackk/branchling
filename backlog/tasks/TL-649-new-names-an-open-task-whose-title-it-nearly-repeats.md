---
id: TL-649
title: "new names an open task whose title it nearly repeats"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-2
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-07
updated: 2026-11-08
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: new-duplicate-note
    bash: "node --test scripts/tests/new-duplicate-note.test.mjs"
---

## Goal

`branchling new` says, without refusing, when the title it is given nearly repeats the title of an open task, and names that task. Under --json the note is a field of the `task-new` envelope.

## Context

Observed on 2026-11-07 while planning: TL-571 "The consumer guide no longer says new has no --json" and TL-613 "The consumer contract no longer says new has no --json" state the same defect in the same file, docs/external-consumers.md. Both were open, filed by different sessions, and the duplicate was found only by reading the whole open list. A loop then spent a claim, a review and a merge on the second one. scripts/new-task.mjs does no comparison against existing titles. The comparison must be cheap (titles only, active scope) and must not refuse, because two similar titles can be two real tasks.

## Steps

1. Define a similarity measure over normalised titles (for example word-set overlap) and a threshold, both documented beside the code.
2. Print a note naming each open task above the threshold; add it to the --json envelope.
3. Test: creating a task whose title differs from an open one by one word prints the note and still creates the task; an unrelated title prints nothing.

## Acceptance criteria

- [x] new names an open task whose title it nearly repeats, and still creates the task [proof: new-duplicate-note]
