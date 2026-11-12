---
id: TL-718
title: "query --text accepts a value that spells a dispatcher flag"
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
  - id: query-text-dispatcher-flags
    bash: "node --test scripts/tests/query-text-dash.test.mjs"
---

## Goal

A value of `query --text` that spells a dispatcher flag (`--color`, `--no-color`, `--dir`) reaches query as its search string.

## Context

TL-691 made the dispatcher's help scan skip the token after `--text`, so `query --text --help` searches. Two dispatcher steps in `scripts/cli.mjs` still run before that scan and read every token: `takeColorFlags(argv)` strips `--color` and `--no-color` wherever they stand, and the global `--dir` reader looks for `--dir` on the whole line. Observed on 2026-11-12: `branchling query --text "--color" --scope all --count` fails with "unexpected argument: all", because the value was removed and `--text` then took `--scope` as its value. The fix should reuse the per-command `literalValueFlags` list TL-691 introduced (COMMANDS.query), so the dispatcher reads the line the way the command's parser does.

## Steps

1. Make takeColorFlags and the global --dir reader skip the token after a flag in the command's literalValueFlags
2. Test `query --text --color`, `--no-color` and `--dir` against a fixture with a positive control

## Acceptance criteria

- [ ] query --text accepts a value that spells a dispatcher flag [proof: query-text-dispatcher-flags]
