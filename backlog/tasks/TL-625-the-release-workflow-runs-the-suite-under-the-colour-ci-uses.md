---
id: TL-625
title: "The release workflow runs the suite under the colour CI uses"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P0
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-07
updated: 2026-11-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: release-tests-step-forces-colour
    bash: "grep -A3 'name: tests' .github/workflows/release.yml | grep -q 'FORCE_COLOR: \"1\"'"
---

## Goal

The release workflow runs the suite with FORCE_COLOR=1, as the test workflow does, so the colour guard defers instead of rerunning 216 rendering tests under a 600 s limit.

## Context

.github/workflows/release.yml runs `node --test scripts/tests/*.test.mjs` without FORCE_COLOR, while .github/workflows/test.yml sets FORCE_COLOR: "1" on its tests step (TL-466). Started without it, scripts/tests/suite-is-terminal-independent.test.mjs reruns every rendering test in colour with a 600 s timeout. In the v0.3.0 release run that rerun took 504 s; in the v0.4.0 release run (42361355340, 2026-11-07) it was killed at 600 s, the suite failed 2903 of 2904 and nothing was published. Rerunning that run cannot pass reliably, because a tag push runs the workflow file of the tagged commit.

## Steps

1. Set FORCE_COLOR: "1" on the tests step of .github/workflows/release.yml, with a comment naming test.yml as the run it mirrors.
2. Push a tag on a commit that carries the change and watch its release run.

## Acceptance criteria

- [x] the release workflow's tests step starts the suite in colour, so the guard defers to it [proof: release-tests-step-forces-colour]
