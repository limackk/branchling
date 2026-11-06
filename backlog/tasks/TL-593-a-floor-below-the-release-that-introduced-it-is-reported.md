---
id: TL-593
title: "A floor below the release that introduced it is reported"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:impl-tl-593
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-06
updated: 2026-11-06
blocked_by: [TL-592]  # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: floor-below-key-test
    bash: "node --test scripts/tests/config-floor-below-key.test.mjs"
---

## Goal

A requires_version floor lower than the release that introduced requires_version is reported, because no release below that one can ever enforce it.

## Context

Found in the TL-586 review. scripts/config.mjs accepts any major.minor.patch for requires_version, for example `requires_version: 0.2.0`, and scripts/declare-vocabulary.mjs can raise such a floor to 0.3.0. KEY_SINCE.requires_version is 0.4.0: a release older than that does not know the key at all, so a floor below it can never take effect and only misleads the reader of the file. Two designs are open: report such a floor (in check or as a parse problem), or have declare raise it to KEY_SINCE.requires_version whenever it writes one. Choose one and say why in the commit body.

## Steps

1. Decide between reporting the meaningless floor and raising it, and record the rejected option in the commit body.
2. Implement it in scripts/config.mjs or scripts/declare-vocabulary.mjs.
3. Write scripts/tests/config-floor-below-key.test.mjs with a floor below KEY_SINCE.requires_version and a control floor equal to it.

## Acceptance criteria

- [x] a floor below the release that introduced requires_version is reported or raised, and a floor at that release is left alone [proof: floor-below-key-test]
