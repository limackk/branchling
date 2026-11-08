---
id: TL-653
title: "A mutation run over the viewer builder survives its source-reading tests"
type: task
labels: []
board: main
epic: "Viewer"
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: [mutation]  # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-08
updated: 2026-11-08
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: viewer-mutation-dry-run
    manual: "With a change to `scripts/build-viewer.mjs` on the branch, `timeout 1800 npm run mutation -- --named-only` passes the initial test run and reports mutants. Evidence: the tail of the run's output."
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

`npm run mutation -- --named-only` against a change to `scripts/build-viewer.mjs` reaches the mutant phase instead of stopping in Stryker's initial test run, so a viewer change can be mutation-tested at all.

## Context

Observed on 2026-11-08 during TL-473, which changed only CSS inside `scripts/build-viewer.mjs`. The run aborted with `ConfigError: There were failed tests in the initial test run.` and `node scripts/mutation-run.mjs: Stryker produced no report` (exit 1). The one failing test was `the prefix is the FROZEN constant, not the display name` in `scripts/tests/viewer-storage-keys.test.mjs`: it asserts `VIEWER_SOURCE` matches `/STORAGE_KEY_PREFIX \+ "-backlog"/`, where `VIEWER_SOURCE` is the text of `build-viewer.mjs` read from disk. In the Stryker sandbox that file is the INSTRUMENTED copy, where every string literal is wrapped (`stryMutAct_9fa48("…") ? "" : "-backlog"`), so the regex can never match and the dry run fails before any mutant is tried. The failure is independent of the change under test: any module whose test reads its own source text with a regex has the same problem. Stryker also warned that it could not disable type checks for `backlog/viewer.html` (a generated file it should not be looking at). Candidate repairs, to be weighed rather than assumed: read the source in such tests from a path Stryker does not instrument, assert on the built page instead of the source, or have `scripts/mutation-run.mjs` exclude source-reading tests from the selection and say so in its report.

## Steps

1. Reproduce: touch a comment in `scripts/build-viewer.mjs` on a branch and run `timeout 1800 npm run mutation -- --named-only`.
2. Choose the repair, apply it, and confirm the guard in `viewer-storage-keys.test.mjs` still fails when the prefix is written as a literal.

## Acceptance criteria

- [ ] A mutation run over the viewer builder gets past Stryker's dry run. [proof: viewer-mutation-dry-run]
- [ ] The default suite stays green. [proof: suite-green]
