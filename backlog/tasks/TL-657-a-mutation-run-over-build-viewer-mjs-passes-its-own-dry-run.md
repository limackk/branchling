---
id: TL-657
title: "A mutation run over build-viewer.mjs passes its own dry run"
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
conflict_group: [mutation]  # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-08
updated: 2026-11-08
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: storage-keys-suite-green
    bash: "node --test scripts/tests/viewer-storage-keys.test.mjs"
---

## Goal

A mutation run over a change to scripts/build-viewer.mjs judges that change, including the page functions that live inside the page's template literal (`startEdit()` and its neighbours): it gets past Stryker's initial (dry) test run without a hand-picked `--tests` selection, AND page code produces mutants, or the run says in its own output that page code is outside what it mutates and names the guard that covers it instead.

## Context

Observed on 2026-11-08 in the TL-605 loop worktree: Stryker instrumented scripts/build-viewer.mjs, and the dry run of `npm run mutation -- --named-only` failed in exactly one test, `the prefix is the FROZEN constant, not the display name` in scripts/tests/viewer-storage-keys.test.mjs. That test reads the TEXT of build-viewer.mjs (VIEWER_SOURCE) and matches `/STORAGE_KEY_PREFIX \+ "-backlog"/`; Stryker's mutation switching rewrites string literals and expressions in the instrumented copy, so the regex no longer matches there although the plain suite (`node --test scripts/tests/*.test.mjs`) is green. scripts/mutation-run.mjs then prints `Stryker produced no report`, so no mutant of build-viewer.mjs is judged.

Two further facts were measured in the TL-605 review the same day, and they make the dry run the smaller half of the problem:

- (a) The dry-run failure is avoidable today with an explicit `--tests` selection that leaves viewer-storage-keys.test.mjs out. `node scripts/mutation-run.mjs --files scripts/agent-profiles.mjs:95-107,scripts/build-viewer.mjs:3191-3200 --tests scripts/tests/actor-shape-diagnosis-readers.test.mjs,scripts/tests/agent-profiles.test.mjs` passed its dry run.
- (b) Getting past the dry run does not bring page code under the gate. That same run instrumented 0 mutants in build-viewer.mjs: the line range 3191-3200 is the body of `startEdit()`, which is text inside the template literal that becomes the page's `<script>` (it begins near `<script>` at line 1968), not JavaScript that Stryker parses. Stryker mutates the module's own code; to it the whole page is one string literal, and a line range inside it selects nothing. Today the only guard on page functions is a test that executes the built page's source, for example scripts/tests/actor-shape-diagnosis-readers.test.mjs running `startEdit()` in `node:vm`, and that guard is only as strong as its assertions are exact.

So repairing the storage-keys test alone would turn "no report" into a report that silently omits every page function — a green result with no evidentiary force over the code most viewer changes touch.

Possible repairs for the dry run, to be chosen by the implementer: assert the derived prefix through the built page (the neighbouring test already reads `const STORAGE_PREFIX = "…"` from buildHtml output) instead of the source text; or have mutation-run.mjs exclude, and name, source-text tests whose subject is an instrumented file. Whichever is chosen, a test still has to fail if the page's prefix stops coming from the frozen constant.

Possible repairs for page code, to be chosen and justified by the implementer: mutate the page script as its own unit (for example, extract the page script to a file that Stryker can parse and that build-viewer.mjs inlines, the way task-fields.mjs is already pasted into the page by source); or, if that is rejected, have mutation-run.mjs report, for a `--files` range that falls inside the template literal, that 0 mutants were produced because the range is page text, rather than leaving a range that selected nothing indistinguishable from a range that was fully killed.

## Steps

1. Reproduce both facts: touch scripts/build-viewer.mjs on a branch and run `timeout 1800 npm run mutation -- --named-only` (dry-run failure in viewer-storage-keys.test.mjs); then run the explicit `--tests` command from (a) and confirm the dry run passes with 0 mutants in build-viewer.mjs
2. Make the frozen-prefix assertion independent of the instrumented source text, or exclude it from the mutation selection with a stated reason
3. Decide how page code is mutated, or how the run declares that it is not, and implement that decision
4. Rerun the mutation run over a change inside a page function and confirm it either produces and judges mutants there, or prints that the range is page text and was not mutated

## Acceptance criteria

- [ ] The storage-key guard still holds, including a check that fails when the page's prefix stops being derived from the frozen constant [proof: storage-keys-suite-green]
- [ ] A mutation run over a change to a page function in scripts/build-viewer.mjs no longer reports that range as if it were covered: either its mutants are generated and judged, or the run says that page text was not mutated
