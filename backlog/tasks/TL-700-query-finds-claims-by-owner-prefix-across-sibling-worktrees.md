---
id: TL-700
title: "query finds claims by owner prefix across sibling worktrees"
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
  - id: query-owner-worktrees
    bash: "node --test scripts/tests/query-owner-worktrees.test.mjs"
---

## Goal

A coordinator can list every task claimed by `agent:loop-*` across the repository's worktrees with one `branchling query` call.

## Context

On 2026-11-10 the loop coordinator, at five merges, looped awk/grep over `.claude/worktrees/loop-*/backlog/tasks/*.md` or ran `query --status in_progress --json` once per worktree. Two gaps: `query --owner 'agent:loop-*'` returns 0 because the owner match is exact; and `elsewhere` reads committed branches only, so a claim `take` made in a worktree and not yet committed is invisible from main. The criteria live in scripts/query.mjs.

## Steps

1. Accept a trailing `*` (prefix match) in --owner
2. Add an opt-in (e.g. `--worktrees`) that also reads the working trees listed by `git worktree list`, reporting each hit with the worktree it was found in
3. Test both, including an uncommitted claim in a sibling worktree

## Acceptance criteria

- [ ] query --owner prefix --worktrees finds an uncommitted claim in a sibling worktree [proof: query-owner-worktrees]
