---
id: TL-558
title: "The plain resume briefing marks project closing entries"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-1
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1h
confidence: medium                 # how much you trust the estimate
created: 2026-11-04
updated: 2026-11-05
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: resume-project-mark
    bash: "node --test scripts/tests/resume-project-entries.test.mjs"
---

## Goal

In the text output of `resume`, a row that comes from a project closing entry is visibly marked as one.

## Context

TL-496 made resume list the project closing contract. The `project: true` flag appears in the model and in --json, but the text renderer in scripts/resume-task.mjs prints those rows like the task's own entries, so a reader cannot tell which checks belong to the task.

## Steps

1. Mark project rows in the text renderer of scripts/resume-task.mjs
2. Assert the mark in a test

## Acceptance criteria

- [x] A project closing entry's row in the plain resume output carries a visible mark. [proof: resume-project-mark]
