---
id: TL-590
title: "A refused actor names the part that is wrong"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:impl-tl-590
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-06
updated: 2026-11-06
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: actor-name-diagnosed
    bash: "node --test scripts/tests/actor-shape-diagnosis.test.mjs"
---

## Goal

An actor refused for the shape of its NAME says so, instead of claiming that a correct namespace is missing, so a caller can fix the right half on the first retry.

## Context

`isValidActor` in scripts/task-fields.mjs tests `ACTOR_RE = /^(local|agent|user):[a-z0-9][a-z0-9._-]{0,62}$/`, and every writing command reports any mismatch as `the actor ... has no valid namespace` (scripts/take-task.mjs and the copies in ask-task.mjs, body-task.mjs, decide-task.mjs, done-task.mjs, handoff-task.mjs, new-task.mjs, history-record.mjs, import-github.mjs, migrate-prefix.mjs). Observed on 2026-11-06: `take <ID> --actor agent:impl-TL-584` was refused with `has no valid namespace` and the hint `Use one of: local:<name> | agent:<name> | user:<name>` although `agent:` was given; the real cause was the uppercase letters in the name. The message sends the reader to the half that was already right. One shared diagnosis (namespace missing or unknown, versus name empty, too long or carrying a character outside [a-z0-9._-]) used by every writer is the likely shape; ten hand-copied messages are the reason they all say the same wrong thing.

## Steps

1. Add a pure function beside isValidActor that names WHICH part of an actor is wrong
2. Use it in every writing command that prints the namespace refusal
3. Test an uppercase name, an unknown namespace and a missing namespace, each with its own message

## Acceptance criteria

- [x] An actor with a valid namespace and an invalid name is refused with a message about the name, not the namespace, in every writing command. [proof: actor-name-diagnosed]
