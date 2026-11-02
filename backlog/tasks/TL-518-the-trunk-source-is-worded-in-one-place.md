---
id: TL-518
title: "The trunk source is worded in one place"
type: task
labels: []
board: main
epic: "Release tracking across environments"                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
priority: P3                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 30m                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-02
updated: 2026-11-02
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: [docs/release-tracking.md]                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: one-wording
    bash: "test -z \"$(grep -ln 'this clone has no' scripts/*.mjs | grep -v '^scripts/environments.mjs$')\" && node --test scripts/tests/show.test.mjs scripts/tests/release-status.test.mjs scripts/tests/query-trunk.test.mjs"
---

## Goal

Every report that names its trunk words the trunk's source from one constant:
`TRUNK_SOURCE_TEXT` exported by `scripts/environments.mjs`.

## Context

TL-517 made `query` name the trunk it counts deployment from, and exported
`TRUNK_SOURCE_TEXT` from `scripts/environments.mjs` for it. Two private copies
of the same map remain: in `scripts/show-task.mjs` and in
`scripts/release-status.mjs` (the `deploy status` report). They were not
replaced in TL-517 because TL-513 was renaming the report in parallel and the
task was scoped to `scripts/query.mjs`. Three copies of one sentence drift: a
change of wording in one reader would make the same trunk read differently in
`show`, `query` and `deploy status`.

A fourth wording sits inline in `scripts/check-release-gaps.mjs` (the
`trunkNote` ternary, near line 107): "the remote's default branch". The
verification grep for `this clone has no` does not catch it, because that
file words the `head` case differently and adds a third source, `flag`
(`--trunk`). Decide there whether the gate reuses `TRUNK_SOURCE_TEXT` for the
two shared sources and keeps only the `flag` and CI wording of its own.

A fifth copy sits in `scripts/viewer-release.mjs` (near lines 185-186), the
viewer's Release view, worded `origin/HEAD` without backticks. The
verification grep for `this clone has no` catches it, so the task cannot pass
until that copy is replaced as well.

## Pre-flight reading

1. `scripts/environments.mjs` — `defaultTrunk()` and `TRUNK_SOURCE_TEXT`
2. `scripts/show-task.mjs`, `scripts/release-status.mjs`, `scripts/viewer-release.mjs` — the local copies

## Steps

1. Import `TRUNK_SOURCE_TEXT` in all three files and delete the local maps.

## Acceptance criteria

- [ ] No file under `scripts/` other than `environments.mjs` defines the
  trunk-source wording, and the readers' tests stay green. [proof: one-wording]
