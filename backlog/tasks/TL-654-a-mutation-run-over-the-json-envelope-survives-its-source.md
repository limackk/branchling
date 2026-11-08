---
id: TL-654
title: "A mutation run over the JSON envelope survives its source-reading test"
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
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-08
updated: 2026-11-08
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: registry
    bash: "node --test scripts/tests/json-kind-registry.test.mjs"
---

## Goal

`npm run mutation -- --named-only` against a change to `scripts/json-envelope.mjs` reaches the mutant phase instead of stopping in Stryker's initial test run, so a change to the JSON envelope (a new kind, a new KIND_EXERCISE row) can be mutation-tested at all.

## Context

Observed on 2026-11-08 during TL-567, which added four kinds and their KIND_EXERCISE rows to `scripts/json-envelope.mjs`. The named-only run selected 348 tests; the initial (dry) run failed one of them, Stryker stopped with `ConfigError: There were failed tests in the initial test run.`, and `node scripts/mutation-run.mjs` reported `Stryker produced no report` (exit 1). The failing test is `the registry is declared where KINDS is, so registering needs no test edit` in `scripts/tests/json-kind-registry.test.mjs`: it reads `json-envelope.mjs` from disk and asserts `/export const KINDS = \{/` and `/export const KIND_EXERCISE = \{/`. In the Stryker sandbox the file on disk is the INSTRUMENTED copy, where object literals are wrapped (`stryMutAct_9fa48("…") ? {} : (stryCov_9fa48("…"), { … })`), so the regex cannot match and the dry run fails before any mutant is tried, whatever the change was. The failure does not appear in the default suite, which reads the uninstrumented source. TL-653 records the same class of failure for `scripts/build-viewer.mjs` and `scripts/tests/viewer-storage-keys.test.mjs`; if TL-653 settles it generically in `scripts/mutation-run.mjs`, this task is closed by verifying that repair against `json-envelope.mjs` rather than by a second mechanism. Candidate repairs, to be weighed rather than assumed: assert the property through the module's exports and a parse of the uninstrumented source from a path Stryker does not rewrite, or have the mutation runner exclude source-reading tests from the selection and name them in its report.

## Steps

1. Reproduce: make a trivial edit to scripts/json-envelope.mjs against main, run `timeout 1800 npm run mutation -- --named-only`, confirm the dry run fails on json-kind-registry.test.mjs
2. Choose and implement a repair that keeps the test's thesis (KINDS and KIND_EXERCISE are declared in the same production file) provable in the default suite
3. Rerun the mutation run and confirm it reaches the mutant phase and writes a report

## Acceptance criteria

- [ ] The registry guard still holds in the default suite. [proof: registry]
