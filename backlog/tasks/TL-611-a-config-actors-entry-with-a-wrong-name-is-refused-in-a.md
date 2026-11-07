---
id: TL-611
title: "A config actors entry with a wrong name is refused in a sentence"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: [config]  # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-06
updated: 2026-11-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: actors-refusal-parses
    bash: "node --test scripts/tests/actor-shape-diagnosis.test.mjs"
---

## Goal

A config.yaml `actors` entry with a wrong name is refused in a sentence that parses.

## Context

After TL-590, validateConfig in scripts/config.mjs builds the name-problem message as "`actors` contains " + bad.refusal + " — " + bad.hint, and bad.refusal from actorRefusal (scripts/task-fields.mjs) is itself a full clause, for example '`agent:impl-TL-584` has an invalid name — ...'. The result reads "`actors` contains the actor ... has an invalid name", which does not parse. scripts/tests/actor-shape-diagnosis.test.mjs pins the current wording. The namespace branch beside it keeps its own sentence ('with no valid namespace — use local:x / agent:x / user:x'), which the TL-590 source guard does not look for, because the guard matches only 'has no valid namespace'. The TL-590 supervisor recorded both as minor issues.

## Steps

1. Change the name branch to a sentence that parses, for example "`actors`: " + bad.refusal
2. Update the assertion in actor-shape-diagnosis.test.mjs to the new wording and assert it no longer contains 'contains' followed by a clause
3. Decide whether the namespace branch's own sentence stays, and if it does, widen the source guard to recognise it as the deliberate second phrasing

## Acceptance criteria

- [ ] The config `actors` refusal for a bad name is one sentence that parses, and the test fails on the old wording [proof: actors-refusal-parses]
