---
id: TL-614
title: "A task id mentioned in a commit body does not claim its files"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-3
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-06
updated: 2026-11-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: body-mention-not-attributed
    bash: "node --test scripts/tests/modified-files.test.mjs"
---

## Goal

A commit that only mentions a task id in its body does not attribute its files to that task, so the capability record `done` writes lists only files the task itself changed.

## Context

parseLog in scripts/modified-files.mjs gives a commit's files to EVERY task id found anywhere in the commit message (the scanner runs over the whole %B). A commit that files or references a follow-up therefore hands that follow-up all of its files. Observed in Wave 20: commit 52986cb (TL-588) says 'filed as TL-595' in its body, so when TL-595 closed, taskModifiedFiles in done-task.mjs returned scripts/hooks-command.mjs, and backlog/history/TL-595.jsonl records it in contractCapability.changedFilesExecuted although TL-595 never touched that file. The TL-595 supervisor first suspected a diff against origin/main; the code shows it is the attribution rule, not a base ref. The same index answers `query --modified-file`, so that answer is affected too. The module header states the link is 'the task id in the commit message' and that the repository convention puts the id at the start of the title; the rule has to decide which ids in a message count (the title's leading ids, a range such as TL-607..TL-611, merge commits already excluded) and say why.

## Steps

1. Decide which ids in a commit message attribute its files (for example only ids in the title, or only the title's leading ids) and record the rejected option in the module header
2. Change parseLog accordingly, keeping the multi-id title case working
3. Add a test in scripts/tests/modified-files.test.mjs with a fixture commit whose body mentions a second task id, asserting that the second task gets no files, with a positive control for an id in the title
4. Check that `query --modified-file` and the done capability record still agree with the new rule

## Acceptance criteria

- [x] A task id mentioned only in a commit body is not given that commit's files, and an id in the title still is [proof: body-mention-not-attributed]
