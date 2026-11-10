---
id: TL-689
title: "The task-execution instructions file a follow-up into a plan wave"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-10
updated: 2026-11-10
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: instructions-new-wave
    bash: "node --test scripts/tests/instructions.test.mjs"
---

## Goal

When the backlog has a plan.yaml, `branchling instructions task-execution` tells an agent filing a follow-up task to use `new --wave "<name>"`, so tasks filed mid-run are never left unplanned.

## Context

Tasks filed by supervised loops during a run (TL-660, TL-663 to TL-676) landed outside every wave, and a loop run refuses to start while `plan` reports unplanned open tasks; each time someone had to plan them by hand afterwards (commits 511ba9a, 7c9a1f6). `plan add` from main cannot do it while the task exists only in a worktree. `new --wave` already exists, but the instructions (scripts/instructions.mjs) never mention it.

## Steps

1. In the task-execution instructions, when plan.yaml exists, recommend `new --title … --wave "<the active or a named follow-up wave>"`
2. Keep the wording in one source as the rest of the instructions are; test that the text appears only when a plan exists

## Acceptance criteria

- [ ] the task-execution instructions name new --wave when a plan exists [proof: instructions-new-wave]
