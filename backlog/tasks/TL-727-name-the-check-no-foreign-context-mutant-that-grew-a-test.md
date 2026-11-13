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
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-2
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

### The mutant, named (2026-11-13, measured under `ulimit -d 4194304`)

Measured with a line-range run, not a whole-module one: `npm run mutation -- --named-only --files scripts/check-no-foreign-context.mjs:123-216 --concurrency 2 --keep-report <path>` (129 of the module's 253 mutants; 46 lie on lines 1-122 and 78 on lines 217-279). FOUR mutants of the same shape reached the 4 GiB cap, each in about 2 seconds, all in the test "this repository's public documents pass":

| line | mutator | replacement | whole-module position |
|---|---|---|---|
| 157 | ConditionalExpression | `if (PERSONAL_PATH.test(line))` → `if (true)` | 103 of 253 |
| 161 | ConditionalExpression | `if (EMAIL.test(line))` → `if (true)` | 110 |
| 167 | ConditionalExpression | `if (BIG_COUNT.test(line))` → `if (true)` | 122 |
| 171 | ConditionalExpression | `if (SHARE_OF.test(line))` → `if (true)` | 129 |

The 08:09 run's report was never kept, so which of the four it was cannot be read back. Line 157 is the most probable: it is the first of them in mutant order, and that run was at 107 of 253 when the process grew.

THE MECHANISM IS THE TEST, NOT THE GUARD. Each mutant makes every line of every public document a finding, tens of thousands on this tree, and the test asserted `assert.deepEqual(findings, [])`. On failure node's `assert` diffs the inspected array against `[]` with a Myers diff that keeps one `Int32Array` of about twice the input's line count per edit step. Memory therefore grows with the SQUARE of the printed lines, in ArrayBuffer backing stores outside the V8 heap. That is why the process grew to 30 GB anon-rss off the heap. Measured on node v22.22.0: 3000 findings alone take 2.6 GB of `arrayBuffers` to diff. Under the cap the test process died at the allocation (`Committing semi space failed. Allocation failed - JavaScript heap out of memory` in the run's report), or, depending on which allocation failed first, the failure was thrown inside the test and reported as a test failure. Either way Stryker counted all four as Killed, which is the hidden missing assertion this task names.

THE FIX. In scripts/tests/foreign-context.test.mjs, `assertNoFindings()` asserts the COUNT, with a message naming the first five findings, so a failure costs the same however many findings there are. The tree test and the positive-control document now use it. A new test, "a tree in which every line is a finding fails by assertion, not by memory", gives the helper one finding per line of the real tree and requires an AssertionError whose message stays under 1000 characters. After the fix, the same line-range run killed all four mutants by that assertion: no allocation failure, each test process finishing in under 0.5 s.

## Steps

1. Under a 4 GiB per-process data cap (TL-726, or `ulimit -d 4194304`), run `npm run mutation -- --named-only --files scripts/check-no-foreign-context.mjs --concurrency 2` and find the mutant(s) whose test process died with an allocation failure (Stryker's mutation.json report, or the run's own report once TL-726 adds it).
2. Record the mutant's line, mutator and replacement in this task's Context, and explain the mechanism that makes it allocate without bound.
3. Write a test in scripts/tests/foreign-context.test.mjs that fails on that mutant by an assertion, and confirm with a run restricted to it that it is killed without reaching the cap.

## Acceptance criteria

- [x] The runaway mutant of check-no-foreign-context.mjs is named in this task and killed by an assertion in foreign-context.test.mjs, not by the per-process memory cap. [proof: foreign-context-runaway-mutant]
