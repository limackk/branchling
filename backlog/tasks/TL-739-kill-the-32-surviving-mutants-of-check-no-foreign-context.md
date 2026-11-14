---
id: TL-739
title: "Kill the 32 surviving mutants of check-no-foreign-context.mjs lines 123-216"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3  # P0 blocker | P1 critical | P2 nice | P3 backlog
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-2
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-13
updated: 2026-11-14
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: foreign-context-tests
    bash: "node --test scripts/tests/foreign-context.test.mjs"
---

## Goal

Every mutant that a line-range mutation run of scripts/check-no-foreign-context.mjs lines 123-216 (`auditText`, `walk`, `auditTree`) leaves alive is either killed by an assertion in scripts/tests/foreign-context.test.mjs or named in this task as equivalent, with the reason.

## Context

TL-727 ran `npm run mutation -- --named-only --files scripts/check-no-foreign-context.mjs:123-216 --concurrency 2` on 2026-11-13 to find a runaway mutant. That run had a different purpose, but it also reported 32 of 129 mutants as Survived. The tests pass on the real tree, yet nothing asserts most of the shapes these mutants break. The survivors, by line:

- 123-126: the `words` default, the empty-string fallback, the `filter(Boolean)` and the escaping regex/replacement for forbidden words. No test passes a word containing a regex metacharacter or an empty word.
- 152, 158, 162, 168, 172: `line: i + 1` → `i - 1`, and `line.trim()` → `line`. No test asserts the reported LINE NUMBER or the trimmed TEXT of a finding.
- 156: the "already reported this line" short-circuit. No test has a line that both matches a forbidden word and carries a personal path, which would show a duplicate finding.
- 178-190: `SKIP_DIRS` emptied, the skip condition made false, the `statSync` catch emptied, `.sort()` removed, `/\.md$/` loosened to `/\.md/` or `true`. No test walks a fixture tree that holds a `node_modules`, `.git` or `demo` directory, a non-markdown file, or a dangling link.
- 198-216: `words` defaulted to a placeholder, `measurements` forced false, the `linesChecked` accumulation and the spread of a finding's fields. No test asserts `linesChecked` or the `file` field of a tree finding.

Build a fixture tree in a temporary directory rather than relying on the real backlog, so that each survivor is decided by data the test establishes (AGENTS.md: do not assert another project's values).

Compare findings with `assertNoFindings()` or another bounded assertion, never with `assert.deepEqual(bigArray, [])`. TL-727 showed that a failing deepEqual over tens of thousands of findings grows the process beyond 4 GiB.

## Pre-flight reading

1. `scripts/check-no-foreign-context.mjs` — the module; its header explains which detector applies where.
2. `scripts/tests/foreign-context.test.mjs` — the existing tests and `assertNoFindings()`.
3. `backlog/tasks/TL-727-name-the-check-no-foreign-context-mutant-that-grew-a-test.md` — why a failing assertion here must stay bounded.

## Steps

1. Rerun the line-range mutation run above with `--keep-report` and list the survivors.
2. For each survivor, write the assertion that fails on it, or name it as equivalent with the reason.
3. Rerun and confirm that no survivor remains except those named as equivalent.

## Acceptance criteria

- [x] No mutant of check-no-foreign-context.mjs lines 123-216 survives except those named in this task as equivalent, and the tests stay green. [proof: foreign-context-tests]

## Equivalent mutants

A rerun of the line-range run on 2026-11-14 left four of 129 mutants alive,
each named here as equivalent: it differs from the code only for a text that
literally contains Stryker's placeholder string, which is not a property of
the guard (the same reasoning as viewer-field-editors.test.mjs).

- line 123, the `words = []` default of `auditText` as `["Stryker was here"]`;
- line 124, the `String(text || "")` fallback as `"Stryker was here!"`;
- line 125, `(words || [])` as `["Stryker was here"]`;
- line 198, the `words = []` default of `auditTree` as `["Stryker was here"]`.

The test written for the `filter(Boolean)` survivor on line 125 also exposed
a defect: with an empty word ahead of a real one, a finding's reason named the
word at the same index of the UNFILTERED list (`word:` instead of
`word:northwind`). The reason now indexes the filtered list it was compiled
from.
