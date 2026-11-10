---
id: TL-691
title: "query --text accepts a value that begins with a dash"
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
  - id: query-text-dash
    bash: "node --test scripts/tests/query-text-dash.test.mjs"
---

## Goal

`branchling query --text "--help"` searches for the string --help instead of printing help.

## Context

Observed on 2026-11-10 while checking backlog coverage: `query --text "--help" --scope all` printed query's help. A value that begins with a dash after a flag that takes a value is treated as a flag. TL-248 settled the opposite policy for `plan add` (refusing a dash-leading value); query's --text is a search string where such values are legitimate. Parsing is in scripts/query.mjs.

## Steps

1. Treat the token after --text as its value whatever it begins with (and accept --text=<v>)
2. Test a dash-leading search string

## Acceptance criteria

- [ ] query --text accepts a dash-leading value [proof: query-text-dash]
