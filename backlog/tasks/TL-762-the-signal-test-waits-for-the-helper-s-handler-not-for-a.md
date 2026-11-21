---
id: TL-762
title: "The signal test waits for the helper's handler, not for a timer"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 30m
confidence: medium                 # how much you trust the estimate
created: 2026-11-21
updated: 2026-11-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: signal-order
    bash: "node --test --test-name-pattern='terminated by a signal|handed its configuration' scripts/tests/mutation-run.test.mjs"
---

## Goal

The signal test of mutation-run.test.mjs ('a run terminated by a signal stops Stryker's group…') sends its signal only after the helper in Stryker's group has installed its SIGTERM handler, so it stops failing on the Node 18 jobs of the test workflow.

## Context

Red on macOS Node 18 in every main run since 2026-11-14 and on Ubuntu Node 18 in two of three, always with "Stryker's group was not sent SIGTERM before SIGKILL": the file helper-termed was never written. The fake Stryker in FAKE_STRYKER wrote sleeping.json — the test's cue to send the signal — on a fixed 300 ms timer after spawning the helper, assuming the helper's handler was installed by then. On a loaded runner a Node 18 helper is still starting at 300 ms, SIGTERM's default disposition ends it, and nothing is recorded; the product's order (SIGTERM, then SIGKILL) was never what failed. The helper now writes helper-ready after installing its handler and the fake Stryker waits for that file. Rejected: a longer timer, which moves the race instead of removing it; and giving the group time after Stryker closes, a product change the evidence does not ask for. Not reproducible on demand here: the test passed on a local Node 18.20.8 before and after, so the CI run is what confirms it.

## Steps

1. Have the helper write helper-ready after process.on('SIGTERM') in FAKE_STRYKER.
2. Replace the 300 ms timer with a poll for helper-ready before writing sleeping.json.
3. Remove helper-ready between the cases of the signal test.

## Acceptance criteria

- [x] the signal test and the other user of the fake Stryker pass with the readiness handshake [proof: signal-order]
