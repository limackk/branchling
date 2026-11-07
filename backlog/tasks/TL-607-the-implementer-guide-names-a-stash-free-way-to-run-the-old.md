---
id: TL-607
title: "The implementer guide names a stash-free way to run the old code"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: [instructions]  # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-06
updated: 2026-11-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: guide-names-stash-free-revert
    bash: "node --test scripts/tests/instructions.test.mjs"
---

## Goal

The implementer guide names a stash-free way to watch a new test fail without the change, so parallel worktrees stop trading each other's edits through the shared stash.

## Context

In wave 19 two implementers (TL-594 and TL-597) each ran `git stash push` / `git stash pop` to prove their new test failed without their change. `refs/stash` belongs to the clone, not to a worktree, so each pop took the other session's stash: TL-594's doctor.mjs and install-skills.mjs edits landed in the TL-597 tree and TL-597's scripts/instructions.mjs edit landed in the TL-594 tree. Both trees were repaired by hand, but the TL-597 `done` record (backlog/history/TL-597.jsonl, id 01M6SAM6BEBP85JGYGJC9M511H) lists scripts/install-skills.mjs under contractCapability.changedFilesExecuted, and that append-only record cannot be corrected. scripts/instructions.mjs already says `git stash` is shared across worktrees, but only in the paragraph about inheriting a red suite from a pipeline; the step every implementer takes, showing that a test fails without the change, has no stated method. The supervisors in the same wave used `git archive <branch>` into a scratch directory with main's copy of the module swapped in, which touches no shared ref.

## Steps

1. Find where the guide (`instructions`, and the role brief an implementer reads) tells a session to show that its test fails without the change
2. State the stash-free method there: a `git archive` or `git worktree add --detach` copy with the old module put back, and say why `git stash` is not one
3. Add an assertion in scripts/tests/instructions.test.mjs that the guide names the method and names `git stash` as shared, with a positive control that the paragraph is found at all

## Acceptance criteria

- [ ] The implementer guide names a stash-free way to run a test against the old code, and the test fails if that paragraph is removed [proof: guide-names-stash-free-revert]
