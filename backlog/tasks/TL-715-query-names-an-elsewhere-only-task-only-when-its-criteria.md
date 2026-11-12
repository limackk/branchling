---
id: TL-715
title: "query names an elsewhere-only task only when its criteria could match it"
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
created: 2026-11-12
updated: 2026-11-12
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: elsewhere-filtered
    bash: "node --test scripts/tests/query-elsewhere-filtered.test.mjs"
---

## Goal

query names a task that exists only on another branch only when it could match the query's criteria, instead of on every query.

## Context

`scripts/query.mjs` `collectBacklog` passes every task id of this tree to `absentHere` (`scripts/branch-scan.mjs`), so an id present only on an unmerged branch is printed on stderr for every query regardless of its filters. Observed 2026-11-12: with branch tl-676-mutation-run-survivors-named carrying TL-713, `query --text zzzz`, `query --status done --text reopen` and `query --ids TL-698` each print `# TL-713 is not in this tree — elsewhere: [...]`. TL-145 introduced the notice so a task on another branch is not silently absent; that remains right for `--ids` naming the id and for criteria the scan can evaluate (status). Every loop and agent pays this line on each query, and with several WIP branches it grows per branch.

## Steps

1. Apply the criteria the branch scan can evaluate (ids, status/scope) to the elsewhere-only list
2. Keep the notice when the query names the id with --ids
3. Say on stderr, once, how many elsewhere-only tasks were left out when filters cannot be evaluated against them

## Acceptance criteria

- [ ] A task present only on another branch is not named by a query whose --ids or --status excludes it, and is still named by --ids that lists it [proof: elsewhere-filtered]
