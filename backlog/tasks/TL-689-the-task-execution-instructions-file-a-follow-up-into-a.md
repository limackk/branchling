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
    bash: "node --test scripts/tests/instructions.test.mjs scripts/tests/plan-wave-hint.test.mjs"
---

## Goal

A follow-up task filed in a loop worktree names the wave it belongs to without anybody editing `backlog/plan.yaml` in that worktree, the wave reaches plan.yaml on main without a merge conflict, and `branchling instructions task-execution` tells an agent to file follow-ups that way when a plan exists.

## Context

Tasks filed by supervised loops during a run (TL-660, TL-663 to TL-676) landed outside every wave, and a loop run refuses to start while `plan` reports unplanned open tasks; each time someone had to plan them by hand afterwards (commits 511ba9a, 7c9a1f6). `plan add` from main cannot do it while the task exists only in a worktree.

The first idea, recommending `new --wave` in the instructions, was tried on 2026-11-10 (run wf_f3a92efa-1cd, the loop prompt told implementers to use it) and is NOT enough. `new --wave` rewrites the wave's one-line `tasks:` list in plan.yaml inside the worktree, so parallel loops edit the same line: the coordinator's merge of TL-642 hit a real plan.yaml conflict (TL-693 from main against TL-694 from the branch), the TL-652 supervisor reverted the hunk instead and TL-696 went unplanned until commit 135ee9e, and four implementers flagged that it contradicts "only the coordinator edits plan.yaml".

The placement therefore has to travel in the task's OWN file (law 1: the data travels with the branch) and be folded into plan.yaml on main, where only one writer exists.

## Steps

1. Give `new --wave` a mode (or make it the default inside a linked worktree) that records the intended wave in the new task's frontmatter instead of editing plan.yaml; the field's shape is code, its value a wave name validated against plan.yaml
2. On main, `plan` reports such tasks as "waiting to be placed" rather than unplanned, and `plan place` (or `build`) appends each to its named wave in plan.yaml and clears the hint, as one diff; an unknown wave name is refused, naming the task
3. In the task-execution instructions, when plan.yaml exists, recommend that form for follow-ups; keep the wording in one source and test that it appears only when a plan exists
4. Test two worktrees filing into the same wave and both merging into main without a plan.yaml conflict

## Acceptance criteria

- [ ] follow-ups filed in two worktrees into one wave merge without a plan.yaml conflict and land in that wave on main, and the instructions name the form [proof: instructions-new-wave]
