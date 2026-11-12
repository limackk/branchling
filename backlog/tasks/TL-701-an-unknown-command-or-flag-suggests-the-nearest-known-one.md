---
id: TL-701
title: "An unknown command or flag suggests the nearest known one"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-2
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-10
updated: 2026-11-12
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: did-you-mean
    bash: "node --test scripts/tests/cli-did-you-mean.test.mjs"
---

## Goal

The unknown-command and unknown-flag refusals name the closest known command or flag when one is near, and for intents with a different name (verify) the command that does it.

## Context

On 2026-11-10 loop agents typed `query --grep` (`unknown flag: --grep`; meant --text) and `branchling verify TL-661` (`unknown command: verify`; meant `done --dry-run`). The refusals list everything available but suggest nothing; agents then read --help. The refusals are built in scripts/cli.mjs.

## Steps

1. Add an edit-distance suggestion (`→ did you mean --text?`) to both refusals, only when the distance is small
2. Add a short alias table for intents whose name differs (verify → done --dry-run, grep → --text), printed as a suggestion, never executed
3. Keep exit codes unchanged; test both refusals

## Acceptance criteria

- [x] unknown commands and flags name the nearest known one [proof: did-you-mean]
