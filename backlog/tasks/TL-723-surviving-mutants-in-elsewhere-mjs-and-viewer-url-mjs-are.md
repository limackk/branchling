---
id: TL-723
title: "Surviving mutants in elsewhere.mjs and viewer-url.mjs are killed"
type: task
labels: []
board: main
epic: "Viewer"
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: awaiting_vouch  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-2
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-12
updated: 2026-11-13
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: mutation-survivors
    manual: "A rerun of `npm run mutation -- --named-only --files scripts/elsewhere.mjs,scripts/viewer-url.mjs` reports no survivor that is not named as equivalent in the task; evidence: the run's summary."
---

## Goal

The 20 mutants that survive a whole-module mutation run over scripts/elsewhere.mjs and scripts/viewer-url.mjs are each killed by an assertion or named as equivalent.

## Context

During TL-702 (2026-11-12) `npm run mutation -- --named-only --files scripts/elsewhere.mjs,scripts/viewer-url.mjs --concurrency 2` passed its initial test run and scored 85.40% (117 killed, 20 survived, 0 timeouts). Survivors in elsewhere.mjs: lines 20, 24, 44 (x2), 67 StringLiteral; 64 ConditionalExpression -> false; 65 ArrayDeclaration; 87 Regex -> /[/\\]$/. Survivors in viewer-url.mjs: line 30 StringLiteral (x2); 40 and 61 StringLiteral; 41, 45, 65 ArrayDeclaration; 75 EqualityOperator SORT_KEYS.indexOf(sort) > 0; 81 BlockStatement -> {}; 82 ConditionalExpression -> true and -> false; 82 EqualityOperator route !== TASKS_HASH_ROUTE. The selected tests were those naming the modules: viewer-elsewhere-card, viewer-url, viewer-release, viewer-release-filter. Line numbers are as of commit 8bec271 plus TL-702, which did not touch either module. Per AGENTS.md a surviving mutant is a missing assertion; some (for example a StringLiteral in prose-only text) may be equivalent and should be named rather than chased.

## Steps

1. Rerun the same command and confirm the survivor list.
2. For each survivor write the test that fails on it, or name it as equivalent with the reason.
3. Rerun and record the new score.

## Equivalent mutants

Fifteen of the twenty survivors are killed by assertions added to
`scripts/tests/viewer-elsewhere-card.test.mjs` and
`scripts/tests/viewer-url.test.mjs`. The five below cannot be killed by any
test, because no input makes the mutant behave differently:

- `elsewhere.mjs:65` ArrayDeclaration `|| []` -> `|| ["Stryker was here"]`.
  The element is a string, so `o.status` is undefined and reads as `""`, which
  never equals the in-progress status: line 64 has already returned for an
  empty one.
- `elsewhere.mjs:67` StringLiteral `o.status || ""` -> `o.status || "Stryker was here!"`.
  The fallback is compared with a non-empty in-progress status (line 64), so
  `""` and the mutant text both fail the comparison for every status a project
  could configure other than the mutant text itself.
- `viewer-url.mjs:41` ArrayDeclaration `view.filters || []` -> `["Stryker was here"]`.
  The element is a string with no `values`, so the inner loop iterates `[]`
  and appends nothing.
- `viewer-url.mjs:61` StringLiteral `query || ""` -> `"Stryker was here!"`.
  `URLSearchParams(undefined)` is empty, and the mutant's one key is its own
  text, which is none of `board`, `q`, `task`, `sort`, `id` or a filter name.
- `viewer-url.mjs:75` EqualityOperator `>= 0` -> `> 0`. The only index the
  mutant excludes is 0, `priority`, which is `SORT_DEFAULT`: both branches
  return the same value as long as the default is the first key.

The rerun on 2026-11-13 (`npm run mutation -- --named-only --files
scripts/elsewhere.mjs,scripts/viewer-url.mjs --concurrency 2`, 13 min 35 s)
scored 96.35%: 132 killed, 0 timeouts, 5 survived, and the five survivors
are exactly the ones listed above.

## Acceptance criteria

- [ ] Every surviving mutant in elsewhere.mjs and viewer-url.mjs is killed or named as equivalent. [proof: mutation-survivors]
