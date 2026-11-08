---
id: TL-621
title: "The requires_version floor controls test distinct floors"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-1
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: [release]  # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-06
updated: 2026-11-08
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: floor-controls
    bash: "node --test scripts/tests/config-floor-below-key.test.mjs scripts/tests/declare-requires-version.test.mjs"
---

## Goal

The control loops that prove a requires_version floor at or above its key's release is accepted test two distinct floors, or say in an assertion that only one exists in this build, and the test titles name what they actually exercise.

## Context

Found in the TL-593 review. READABLE_VERSION (package.json 0.3.0, next minor) is 0.4.0, the same as KEY_SINCE.requires_version, so `for (const floor of [SINCE, READABLE_VERSION])` in scripts/tests/config-floor-below-key.test.mjs (around line 88) and `for (const floor of [READABLE_VERSION, KEY_SINCE[REQUIRES_VERSION_KEY]])` in scripts/tests/declare-requires-version.test.mjs (around line 77) each run the same floor twice. Neither proves a floor ABOVE the key's release yet, while both read as if they did. The title of the declare test, 'a floor higher than the key's release is left alone, and so is an equal one' (line 72), is also stale: since TL-593 a floor equal to KEY_SINCE.releases (0.3.0) is a parse problem, so through the CLI both floors are higher than `releases`, and the equal case is proved only by the pure appendEntryText test further down. A loop that collapses to one value is a guard with less evidentiary force than it claims (AGENTS.md: a guard that passes on a zero sample).

## Steps

1. Deduplicate the floor list in both control loops and assert how many distinct floors remain, with a message that names the collapse while READABLE_VERSION equals the key's release.
2. Where a floor strictly above the key's release can be tested without a version this build refuses, test it; otherwise state in the assertion message that the case returns when READABLE_VERSION moves past the key's release.
3. Rename the declare-requires-version test so its title says which floors it exercises through the CLI, and point at the appendEntryText test for the equal case.

## Acceptance criteria

- [x] both control loops run over distinct floors or assert the collapse, and the renamed test passes [proof: floor-controls]
