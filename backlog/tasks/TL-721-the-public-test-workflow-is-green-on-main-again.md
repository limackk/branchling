---
id: TL-721
title: "The public test workflow is green on main again"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-12
updated: 2026-11-12
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: ci-green
    manual: "The latest test.yml run on main concludes success on all seven matrix jobs. Evidence: the run URL."
---

## Goal

The public test workflow (.github/workflows/test.yml) is green on main on every job of its matrix, so the repository's CI status and TL-456's Windows evidence say something true.

## Context

Observed 2026-11-12 through the public GitHub API: every test.yml run on main since 2026-11-07 concluded `failure`, the last one being run 43069560036 (2026-11-11, push of 0ae2e44), where all seven jobs (ubuntu and macos on Node 18, 20 and 22, windows on 22) failed in the `tests` step with exit code 1. Locally the same suite passes (3401 of 3402, 1 skipped) on Linux, so the failure is environment-dependent: candidates are tests that assume a local state the runner lacks (git identity, Stryker in node_modules, a TTY, the state directory, sibling worktrees) or Node 18/20 API differences. The job logs need an authenticated `gh run view <id> --log-failed`; the annotations carry only the exit code. Until this is green, TL-456 (Windows support demonstrated by a public run) cannot be vouched. It sits with the human gates because it needs an authenticated gh and a push.

## Steps

1. Read the failing tests from `gh run view 43069560036 --log-failed` and group them by cause
2. Fix each cause in the tests or the code, without asserting anything only the runner's environment provides
3. Push and confirm a green run on main for all seven jobs

## Acceptance criteria

- [ ] The latest test.yml run on main concludes success on all seven matrix jobs. Evidence: the run URL. [proof: ci-green]
