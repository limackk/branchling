---
id: TL-539
title: "The follow SIGINT test runs only where POSIX signals exist"
type: task
labels: [ci]
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
estimate: 30m                      # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-02
updated: 2026-11-02
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: [scripts/tests/watch-stream.test.mjs]
verification:                      # HOW to check the task is really done
  - id: watch-stream-green
    bash: "node --test scripts/tests/watch-stream.test.mjs"
  - id: skip-declared
    bash: "grep -A2 'SIGINT stops the watch' scripts/tests/watch-stream.test.mjs | grep -q 'POSIX signal contract'"
---

## Goal

The `test` workflow's Windows job is green again: the one test that asserts
a POSIX signal contract for `follow` is skipped on win32, as the other
signal tests of this suite already are.

## Context

The `test` run on a44ea14 failed on windows-latest / Node 22 at
`SIGINT stops the watch with exit 0` (scripts/tests/watch-stream.test.mjs,
added by TL-524): the exit code was null, not 0. Windows has no SIGINT a
parent can deliver; `child.kill("SIGINT")` terminates the process
outright, so the handler never runs. `proofs-progress.test.mjs` and
`serve-lifetime.test.mjs` skip their signal tests on win32 with the
reason "POSIX signal contract", and Windows is not yet a supported
platform (TL-456).

Rejected: changing `follow` itself. Its behaviour on Ctrl-C in a Windows
console is a separate question that this test could never measure.

This blocked the v0.3.0 tag, which needs every matrix job green.

## Pre-flight reading

1. `scripts/tests/watch-stream.test.mjs` — the SIGINT test
2. `scripts/tests/serve-lifetime.test.mjs` — the existing skip pattern

## Steps

1. Skip the test on win32 with the shared reason.

## Acceptance criteria

- [x] The follow stream tests pass where POSIX signals exist.
      [proof: watch-stream-green]
- [x] The SIGINT test declares its POSIX-only skip. [proof: skip-declared]
