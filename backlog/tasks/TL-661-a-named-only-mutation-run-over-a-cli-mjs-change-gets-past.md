---
id: TL-661
title: "A named-only mutation run over a cli.mjs change gets past its dry run"
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
created: 2026-11-08
updated: 2026-11-08
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: named-only-cli-selection
    bash: "node --test scripts/tests/mutation-named-only-cli.test.mjs"
---

## Goal

`npm run mutation -- --named-only` over a change that touches scripts/cli.mjs still gives the fast lower bound AGENTS.md promises: the selected test set gets past Stryker's initial (dry) test run, or the run refuses before starting Stryker and says that the named-only selection for cli.mjs is effectively the whole suite and what to pass instead.

## Context

Observed on 2026-11-08 at 13:18 CET in the TL-649 loop worktree (.claude/worktrees/loop-2). The change touched scripts/new-task.mjs, scripts/json-envelope.mjs and scripts/cli.mjs (four lines of --help text). `timeout 1800 npm run mutation -- --named-only` instrumented 4307 mutants across the three files and then failed with `ERROR DryRunExecutor Initial test run timed out!` after about five minutes, so no mutant was judged. The cause is the selection, not the machine: `grep -l cli.mjs scripts/tests/*.test.mjs` matches 223 test files, because nearly every end-to-end test spawns the CLI by path, so 'the test files that name the module' is almost the whole suite for cli.mjs, and that selection's dry run exceeds Stryker's dry-run timeout. AGENTS.md describes --named-only as 'a fast lower bound'; for any change that touches cli.mjs it is neither fast nor a bound, and it fails rather than reporting anything. scripts/mutation-run.mjs builds the selection; the related open tasks are TL-648 (mutate only the changed lines — fewer mutants, but the dry run is the same) and TL-658 (a line range in --files loses its test selection). Possible repairs, to be chosen by the implementer: treat a module named by more than some share of the suite as not selective under --named-only and say so; select for cli.mjs by the command a test exercises rather than by the path it spawns; or raise Stryker's dry-run timeout in proportion to the selected set and report the expected duration before starting.

## Steps

1. Reproduce: on a branch, change one line of --help text in scripts/cli.mjs and run `timeout 1800 npm run mutation -- --named-only`; confirm the dry-run timeout
2. Choose and implement a repair in scripts/mutation-run.mjs, stating the rejected options in the commit body
3. Test: a fixture change to cli.mjs under --named-only either produces a selection the dry run can finish or a refusal naming the cause, never a Stryker stack trace

## Acceptance criteria

- [ ] a --named-only run over a change to cli.mjs gets past the dry run or refuses with the cause named [proof: named-only-cli-selection]
