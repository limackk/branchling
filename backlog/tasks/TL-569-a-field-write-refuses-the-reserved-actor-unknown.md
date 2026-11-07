---
id: TL-569
title: "A field write refuses the reserved actor unknown"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-4
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1h
confidence: medium                 # how much you trust the estimate
created: 2026-11-05
updated: 2026-11-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: field-write-refuses-unknown-actor
    bash: "node --test scripts/tests/field-write-reserved-actor.test.mjs"
---

## Goal

A field write that names the reserved actor `unknown` is refused by `writeTaskField()`, so neither `set --actor unknown` nor the served viewer can record a change the tool made as one nobody made.

## Context

`unknown` is reserved for a change that was OBSERVED, not made by the tool (AGENTS.md, TL-105); it must never be typed by hand. `isValidActor()` in scripts/task-fields.mjs accepts it on purpose, because `reconcile()` and history readers need it as a value. `writeTaskField()` in scripts/field-write.mjs uses that same predicate as its gate, so a POST to the served viewer's /api/task with `actor: "unknown"` (TL-551 refuses only an UNSTATED actor) and `set <ID> <field> <value> --actor unknown` both write the task and record the edit under `unknown` with source `viewer` or `cli` — a record that contradicts itself. Found while doing TL-551, deliberately left out of it: the fix belongs in the shared core, which `set` also uses.

## Steps

1. Refuse `unknown` (ACTOR_UNKNOWN) as the actor of a field write in `writeTaskField()`, before the file is read, with a message that names the namespaced forms
2. Leave `isValidActor()` and the readers that accept `unknown` from history untouched
3. Test both callers: `set --actor unknown` exits with a refusal and writes nothing; POST /api/task with actor `unknown` is refused and writes nothing; a namespaced actor still writes

## Acceptance criteria

- [x] A field write naming the reserved actor `unknown` is refused through `set` and through the served viewer, and nothing is written. [proof: field-write-refuses-unknown-actor]
