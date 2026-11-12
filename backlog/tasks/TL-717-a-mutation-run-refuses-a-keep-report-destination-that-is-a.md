---
id: TL-717
title: "A mutation run refuses a --keep-report destination that is a directory"
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
estimate: 30m
confidence: medium                 # how much you trust the estimate
created: 2026-11-12
updated: 2026-11-12
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: keep-report-dir
    bash: "node --test scripts/tests/mutation-run.test.mjs"
---

## Goal

`npm run mutation -- --keep-report <path>` refuses, before Stryker starts, a <path> that is an existing directory, as it already refuses one whose parent directory is missing.

## Context

TL-686 added `--keep-report <path>` to scripts/mutation-run.mjs. `main` checks only that `dirname(path)` is a directory before the run. A path that is itself an existing directory (for example `--keep-report out/` or `--keep-report .`) passes that check, the run takes up to an hour, and only then does `keepReport()` call `copyFileSync` onto a directory, which fails with EISDIR: the warning is printed, the run exits 1, and the report the flag exists to preserve is removed with the work directory. The pre-run check's own comment says the destination is checked before the run, not after it. Options: refuse an existing directory with exit 1, or write `mutation.json` inside it; refusing keeps one meaning for the flag.

## Steps

1. In `main` (scripts/mutation-run.mjs), refuse a --keep-report path that exists and is a directory, before the slot is taken
2. Test in scripts/tests/mutation-run.test.mjs that such a path exits 1 and starts no Stryker run, next to the TL-686 test for a missing parent

## Acceptance criteria

- [ ] an existing directory as the --keep-report destination is refused before the run [proof: keep-report-dir]
