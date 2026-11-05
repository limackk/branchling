---
id: TL-538
title: "A guard captured without colour inherits no FORCE_COLOR"
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
estimate: 1h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-02
updated: 2026-11-02
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: [.github/workflows/test.yml]
verification:                      # HOW to check the task is really done
  - id: forced-colour-capture
    bash: "FORCE_COLOR=1 node --test scripts/tests/guard-capture-colour.test.mjs"
  - id: release-suite-forced
    bash: "FORCE_COLOR=1 node --test scripts/tests/external-target-field.test.mjs scripts/tests/current-release.test.mjs scripts/tests/release-gaps.test.mjs scripts/tests/release-multi-repo.test.mjs"
---

## Goal

A child process the CLI captures without colour must not also inherit
FORCE_COLOR. Once this holds, `check --json` carries every guard's document
whatever colour variables the caller exported, and the `test` workflow, which
runs the suite with FORCE_COLOR=1, is green on every Node line of the matrix.

## Context

The `test` run on 7d76538 failed on Node 18 and 20 (Linux and macOS) with
seven `TypeError`s, all reading `report` of the `release` guard as null.
`captureScript()` in `scripts/cli.mjs` spawned guards with NO_COLOR=1 on top
of the caller's environment; the workflow exports FORCE_COLOR=1, and Node
answers that pair with "Warning: The 'NO_COLOR' env is ignored due to the
'FORCE_COLOR' env being set" on stderr. `captureScript()` joins stderr to
stdout, so the release guard's `--json` document no longer parsed. A local
run never set FORCE_COLOR and stayed green; the Node 22 jobs passed.

The same `{ ...process.env, NO_COLOR: "1" }` shape stood in four other call
sites (`check-guards.mjs`, `context-budget.mjs`, `mcp-server.mjs`,
`run-loop.mjs`). They now share `plainChildEnv()` from `scripts/ui.mjs`.

Rejected: parsing only stdout for a `jsonReport` guard. It would hide the
symptom in one place and leave the warning in every other guard's `output`.

This blocked the v0.3.0 tag: the release workflow runs the same suite.

## Pre-flight reading

1. `scripts/cli.mjs` — `childEnv()` and `captureScript()`
2. `scripts/ui.mjs` — `colorAllowed()` and `plainChildEnv()`
3. `.github/workflows/test.yml` — why the suite runs under FORCE_COLOR

## Steps

1. A test that runs `check --release --json` under FORCE_COLOR and fails on
   Node 20 before the change.
2. `plainChildEnv()` removes FORCE_COLOR; every no-colour child uses it.

## Acceptance criteria

- [x] `check --release --json` under FORCE_COLOR=1 carries a non-null release
      report and no guard output carries Node's colour warning.
      [proof: forced-colour-capture]
- [x] The release-gate test files pass under FORCE_COLOR=1.
      [proof: release-suite-forced]
