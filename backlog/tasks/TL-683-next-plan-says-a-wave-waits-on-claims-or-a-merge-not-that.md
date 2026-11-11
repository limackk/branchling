---
id: TL-683
title: "next --plan says a wave waits on claims or a merge, not that nothing is left"
type: task
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
created: 2026-11-10
updated: 2026-11-11
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: next-wave-waiting
    bash: "node --test scripts/tests/next-plan-waiting.test.mjs"
---

## Goal

When the active wave's remaining tasks are claimed in other trees or closed on an unmerged branch, `next --plan` answers with a refusal kind distinct from an empty backlog, and can optionally hand out the next wave's unblocked work.

## Context

In the supervised-loop runs of 2026-11-05 to 2026-11-09, `next --plan` returned `nothing-to-take` (exit 3; scripts/next-task.mjs around line 1239) 42+ times while the active wave still had work: typically `plan wave 7 … 5 task(s) scheduled, 1 still open` with that one claimed in another worktree, or the remaining task closed as done on a branch not yet merged into main. The refusal text explains it, but the refusalKind and exit code are the same as for an exhausted backlog, so a supervisor cannot tell "retry after the coordinator merges" from "stop". Four loops often ran as one. TL-664 (plan withholds a task another tree has claimed) is related but does not change what an idle loop is told.

## Steps

1. Add refusal kinds for `wave-claimed-elsewhere` and `wave-awaits-merge`, keeping `nothing-to-take` for a backlog with no work; document them in `next --help` and the --json envelope
2. Add an opt-in flag (e.g. `--plan --spill`) that, when every open task of the active wave is claimed elsewhere, hands out an unblocked task of the next wave that shares no conflict group with work in progress
3. Test each refusal kind with fixture trees

## Acceptance criteria

- [x] next --plan distinguishes a wave waiting on claims or a merge from an empty backlog [proof: next-wave-waiting]
