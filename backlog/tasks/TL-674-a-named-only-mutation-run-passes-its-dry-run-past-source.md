---
id: TL-674
title: "A named-only mutation run passes its dry run past source-reading tests"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-2
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-09
updated: 2026-11-11
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: mutation-run-tests
    bash: "node --test scripts/tests/mutation-run*.test.mjs"
---

## Goal

A named-only mutation run over a change to scripts/cli.mjs or scripts/json-envelope.mjs gets past Stryker's initial test run: the tests that read a module's SOURCE TEXT either see the original text inside the sandbox or are left out of the selection with the reason printed, instead of failing the dry run so that no mutant is judged.

## Context

Observed on 2026-11-09 at about 17:18 CET in .claude/worktrees/loop-4 (TL-630). The change touched scripts/new-task.mjs, scripts/json-envelope.mjs and scripts/cli.mjs. `npm run mutation -- --named-only --concurrency 2` selected 2776 tests, and unlike TL-661 the dry run did NOT time out: it completed with 5 failures, Stryker stopped with `There were failed tests in the initial test run`, and scripts/mutation-run.mjs reported `Stryker produced no report`. The five failures were: agent-hooks.test.mjs 'every command entry names a script that is in the tree' ('only 0 command scripts found — the reader is looking at the wrong text'), json-kind-registry.test.mjs 'the registry is declared where KINDS is' ('KINDS is not declared where it is expected'), docs-links.test.mjs 'this repository passes its own guard', line-endings.test.mjs 'a checkout writes LF into code, prose and task files alike' (a git command failing inside the sandbox), and suite-is-terminal-independent.test.mjs 'the rendering tests pass with colour forced on'. The first two read the source of a module Stryker had instrumented, so they parse instrumented text; the others depend on a git checkout or on rerunning tests, which the sandbox under /tmp/mutation-run-*/sandbox does not provide the same way. The same suite is green outside Stryker (3202 of 3202 on the same tree). TL-661 is the related task for the cli.mjs selection timing out; this one is the dry run failing after it finishes. Repairs to choose from: exclude from the selection the tests that read a mutated module's text or need the repository's own git state, and print which were excluded and why; or make those tests read the original file from the repository rather than the sandbox copy. scripts/mutation-run.mjs builds the selection.

## Steps

1. Reproduce with a named-only run over a change to scripts/json-envelope.mjs
2. Choose and implement the repair in scripts/mutation-run.mjs or in the affected tests
3. Add a test in scripts/tests/ that holds the repair

## Acceptance criteria

- [x] A named-only selection over a source-reading module does not fail Stryker's dry run [proof: mutation-run-tests]
