---
id: TL-462
title: "Three tests pass with colour forced on, on every Node version"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-10-15
updated: 2026-10-15
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: [TL-455]                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: colour-forced
    bash: "FORCE_COLOR=1 node --test scripts/tests/json-pipe.test.mjs scripts/tests/next.test.mjs scripts/tests/proofs-progress.test.mjs"
  - id: terminal-independent
    bash: "node --test scripts/tests/suite-is-terminal-independent.test.mjs"
---

## Goal

`the rendering tests pass with colour forced on`
(`scripts/tests/suite-is-terminal-independent.test.mjs:91`) is green on Node
18, 20 and 22, Linux and macOS.

## Context

In GitHub Actions run 38738911603 (commit f11b5b6, 2026-10-15) the forced-colour
rerun reported these besides the hook control that TL-461 owns:

- Node 22 (Ubuntu): `POSITIVE CONTROL: the old pattern truncates over the
  same number of bytes` — `scripts/tests/json-pipe.test.mjs:88`.
- Node 18 and 20 (Ubuntu and macOS): `an empty queue is code 3 — neither
  success nor a usage error` — `scripts/tests/next.test.mjs:281`, and
  `` `--quiet` silences the narration and leaves the report alone `` —
  `scripts/tests/proofs-progress.test.mjs:228`.

All three are green through a pipe, which is what the guard exists to catch:
their result depends on the observer. TL-434 fixed an earlier case of the same
class; read its decision before choosing a fix. Locally the suite runs on
Node 24, which is why none of this showed before the push.

## Steps

1. Reproduce each with `FORCE_COLOR=1` on the Node version that fails.
2. Make the test, or the code it measures, independent of colour — never by
   unsetting `FORCE_COLOR` inside the one test.

## Acceptance criteria

- [x] The three tests pass with colour forced on. [proof: colour-forced]
- [x] The terminal-independence guard is green. [proof: terminal-independent]
