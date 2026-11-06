---
id: TL-599
title: "The released-backlog tests remove the repositories they create"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:impl-tl-599
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 30m
confidence: medium                 # how much you trust the estimate
created: 2026-11-06
updated: 2026-11-06
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: released-tests-clean-up
    bash: "node --test scripts/tests/released-backlogs.test.mjs"
  - id: released-tests-leave-tmpdir-empty
    bash: "node --test scripts/tests/released-backlogs-cleanup.test.mjs"
---

## Goal

scripts/tests/released-backlogs.test.mjs leaves no temporary repository behind after a run.

## Context

Found in the TL-587 review. `upgradedRepo` (and the raw-copy control) in scripts/tests/released-backlogs.test.mjs create directories with `mkdtempSync(join(tmpdir(), "branchling-released-..."))` and never remove them, so every run of the suite leaks one directory per released fixture plus the controls. Most test files that create temporary trees remove them with `rmSync` in an `after` or `t.after` hook.

## Steps

1. Register removal of every directory the file creates (`t.after` or a module-level `after`) with `rmSync(..., { recursive: true, force: true })`
2. Prove it: count the `branchling-released-*` entries in the temporary directory before and after running the file

## Acceptance criteria

- [x] The released-backlog tests still pass, and every temporary repository they create is removed in an after hook. [proof: released-tests-clean-up]
- [x] A run of the released-backlog tests with a private TMPDIR leaves that directory empty. [proof: released-tests-leave-tmpdir-empty]
