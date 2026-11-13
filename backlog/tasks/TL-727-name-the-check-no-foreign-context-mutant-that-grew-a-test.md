---
id: TL-727
title: "Name the check-no-foreign-context mutant that grew a test process to 30 GB"
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
created: 2026-11-13
updated: 2026-11-13
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: foreign-context-runaway-mutant
    bash: "node --test scripts/tests/foreign-context.test.mjs"
---

## Goal

The mutant of scripts/check-no-foreign-context.mjs that grew one test process to 30 GB on 2026-11-13 is named (line, mutator, replacement) in this task, and a test in scripts/tests/foreign-context.test.mjs kills it by an assertion within seconds instead of by exhausting memory.

## Context

2026-11-13 08:09 CET: a whole-module mutation run of scripts/check-no-foreign-context.mjs (253 mutants, --concurrency 2) reached 107/253 when one mutant's `node` test process grew to 30 GB anon-rss, off the V8 heap, in under a minute; the kernel OOM killer then took the session down (TL-726 records the measurement). Which of the 253 mutants did it was never identified. TL-708 later ran a changed-lines run only (2 mutants, both killed, no allocation failure), so the runaway sits on a line outside that change and is still unknown. A mutant that is detected only because the machine runs out of memory is not detected by the suite: under a per-process data cap it dies with `Array buffer allocation failed` or `JavaScript heap out of memory` and Stryker counts it as killed, which hides the missing assertion. Do NOT repeat the whole-module run without a per-process cap: either the cap TL-726 builds into scripts/mutation-run.mjs, or `ulimit -d 4194304` in the shell that starts the run. Never raise or remove that cap.

## Steps

1. Under a 4 GiB per-process data cap (TL-726, or `ulimit -d 4194304`), run `npm run mutation -- --named-only --files scripts/check-no-foreign-context.mjs --concurrency 2` and find the mutant(s) whose test process died with an allocation failure (Stryker's mutation.json report, or the run's own report once TL-726 adds it).
2. Record the mutant's line, mutator and replacement in this task's Context, and explain the mechanism that makes it allocate without bound.
3. Write a test in scripts/tests/foreign-context.test.mjs that fails on that mutant by an assertion, and confirm with a run restricted to it that it is killed without reaching the cap.

## Acceptance criteria

- [ ] The runaway mutant of check-no-foreign-context.mjs is named in this task and killed by an assertion in foreign-context.test.mjs, not by the per-process memory cap. [proof: foreign-context-runaway-mutant]
