---
id: TL-560
title: "Each open question carries its task's priority"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-3
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: [log-task]  # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1h
confidence: medium                 # how much you trust the estimate
created: 2026-11-04
updated: 2026-11-05
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: question-priority
    bash: "node --test scripts/tests/open-questions.test.mjs"
---

## Goal

Every entry of `log --open-questions --json` carries the priority of the task the question belongs to.

## Context

Found by branchling-ui during UI-23: once its decisions view read open questions through the one `log --open-questions` call (TL-536), it could no longer show a priority beside each question, because the entries carry none. openQuestionsAcross in scripts/log-task.mjs builds the entries from task records that already hold the priority.

## Steps

1. Add the task's priority to each entry in openQuestionsAcross
2. Document the key in docs/external-consumers.md
3. Assert it in the open-questions test

## Acceptance criteria

- [x] Every open-question entry carries its task's priority. [proof: question-priority]
