---
id: TL-608
title: "The overview names a foreign target beside a local one as unobservable"
type: bug
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
conflict_group: [instructions]  # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-06
updated: 2026-11-08
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: mixed-targets-name-unobservable
    bash: "node --test scripts/tests/instructions-promotion.test.mjs"
---

## Goal

With both a local and a foreign deploy target declared, the overview guide says that the foreign target's tasks show as unobservable, instead of describing every stage as computed from git.

## Context

TL-597 changed `promotionState` in scripts/instructions.mjs so that when every entry in `deploy_targets` declares `repository:`, the overview no longer claims the stages are computed from git. It deliberately left the mixed case unchanged: when at least one target is local (`observedTargets(config.deployTargets).length > 0`), the text still promises 'what each stage does not hold yet' for all targets, while `deploy status` shows a foreign target's tasks as unobservable. The TL-597 supervisor recorded this as a minor issue. scripts/tests/instructions-promotion.test.mjs already has a MIXED fixture, which currently serves as the positive control that the git claim is still present.

## Steps

1. In promotionState, when observedTargets is non-empty but shorter than deployTargets, add one sentence naming the foreign targets as unobservable here and `target:` as how a task joins one
2. Keep the local-only text byte for byte
3. Extend the MIXED fixture in instructions-promotion.test.mjs to assert that sentence, keeping the assertion that the local-only fixture has no such sentence

## Acceptance criteria

- [x] With local and foreign targets the overview names the foreign ones as unobservable, and a local-only backlog's overview is unchanged [proof: mixed-targets-name-unobservable]
