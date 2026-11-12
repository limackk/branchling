---
id: TL-687
title: "query filters by conflict group"
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
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-10
updated: 2026-11-12
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: query-conflict-group
    bash: "node --test scripts/tests/query-conflict-group.test.mjs"
---

## Goal

`branchling query --conflict-group <g,…>` selects the tasks whose conflict_group contains any of the named groups.

## Context

Supervised loops schedule by conflict group, but `query` has no axis for it: on 2026-11-09 agents ran `query --conflict-group mutation` (`unknown flag`) and `query conflict_group=mutation` (`unexpected argument`), then grepped config.yaml and the --json output. The criteria are defined in scripts/query.mjs.

## Steps

1. Add `--conflict-group` as a criterion axis (OR inside, AND across), validated against the project's vocabulary if one is declared
2. Document it in `query --help`; test it

## Acceptance criteria

- [x] query --conflict-group selects exactly the tasks in those groups [proof: query-conflict-group]
