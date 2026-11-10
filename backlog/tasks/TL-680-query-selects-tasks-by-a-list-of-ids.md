---
id: TL-680
title: "query selects tasks by a list of ids"
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
  - id: query-ids
    bash: "node --test scripts/tests/query-ids.test.mjs"
---

## Goal

`branchling query` selects tasks by a list of ids, so asking about several known tasks needs no --json post-processing.

## Context

Observed on 2026-11-10: to read the priority, conflict group and title of fifteen known tasks (TL-660, TL-663 to TL-676) a session tried `branchling query --id TL-660`, which fails with `unknown flag: --id`, and then piped `query --json` through a node one-liner to filter by id. `--text` matches a substring of "<id> <title>", so `--text TL-66` also matches TL-660 to TL-669 and cannot express a list. The criteria live in the query command (scripts/query.mjs, registered in the command table of scripts/cli.mjs).

## Steps

1. Add `--ids <id,id,…>` as a criterion axis (OR inside it, AND with the other axes); an id that does not match the configured prefix is refused, one that matches nothing is reported on stderr
2. Make it apply across --scope as the other criteria do
3. Document it in `query --help` and test a list, a mix with --status, and an unknown id

## Acceptance criteria

- [ ] query --ids selects exactly the listed tasks and combines with other criteria [proof: query-ids]
