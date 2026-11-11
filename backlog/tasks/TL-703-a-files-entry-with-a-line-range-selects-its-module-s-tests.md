---
id: TL-703
title: "A --files entry with a line range selects its module's tests"
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
created: 2026-11-11
updated: 2026-11-11
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: range-entry-selects-tests
    bash: "node --test scripts/tests/mutation-changed-lines.test.mjs scripts/tests/mutation-run.test.mjs"
---

## Goal

A `--files path:start-end` entry selects the same tests as `--files path` in scripts/mutation-run.mjs: test selection matches the module's filename, not the entry with its line range.

## Context

Observed on 2026-11-11 while working TL-657. `plan()` in scripts/mutation-run.mjs takes `opts.files` verbatim as `modules`, and `selectTests()` matches `basename(m)` against each test file's text. For an entry with a range, `basename("scripts/build-viewer.mjs:397-397")` is `build-viewer.mjs:397-397`, which no test file contains, so `node scripts/mutation-run.mjs --plan --named-only --files scripts/build-viewer.mjs:397-397` refuses with `no test file reaches scripts/build-viewer.mjs:397-397`, while the same command with `--files scripts/build-viewer.mjs` selects 21 test files. Without `--named-only` the import-closure and CLI rules fail the same way, because `importClosure()` and `commandScripts()` compare whole paths. This is why the TL-605 review had to pass an explicit `--tests` list. The fix belongs in the selection: strip the `:start-end` suffix (the `parseEntry()` helper TL-657 added in mutation-run.mjs already parses it) before matching, while `mutate` keeps the entry with its range.

## Steps

1. Select tests by the file part of each `--files` entry, keeping the range in `mutate`
2. Add a case to scripts/tests/mutation-changed-lines.test.mjs or mutation-run.test.mjs: a fixture where `--files scripts/lib.mjs:6-7 --plan --json` selects the test file that names lib.mjs, plus the same with --named-only

## Acceptance criteria

- [ ] A --files entry with a line range selects the tests its module's filename selects [proof: range-entry-selects-tests]
