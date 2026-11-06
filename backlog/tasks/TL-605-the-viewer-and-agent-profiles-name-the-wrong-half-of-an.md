---
id: TL-605
title: "The viewer and agent profiles name the wrong half of an actor"
type: task
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
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1h
confidence: medium                 # how much you trust the estimate
created: 2026-11-06
updated: 2026-11-06
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: viewer-profile-actor-diagnosed
    bash: "node --test scripts/tests/actor-shape-diagnosis-readers.test.mjs"
---

## Goal

The viewer's identity prompt and the agent-profile check say which half of a refused actor is wrong, using the same diagnosis the writing commands use.

## Context

TL-590 added `actorRefusal()` to scripts/task-fields.mjs and moved every writing command onto it, so `agent:impl-TL-1` is now refused for its NAME instead of a namespace it already has. <!-- renumber: allow --> Two readers of an actor were outside that task's thesis and still answer with one fixed sentence whatever the fault: `startEdit()` in scripts/build-viewer.mjs prints `Enter a user:name identity before editing.` for `user:Kamil` as well as for `kamil`, and `profileProblems()` in scripts/agent-profiles.mjs reports `actor must be an `agent:<name>` identity` for `agent:Impl` although the namespace is right. task-fields.mjs is pasted into the viewer by source, so `actorRefusal` is already available in the page. The namespace restriction each of them adds (`user:` for the viewer, `agent:` for a profile) stays their own check; only the shape diagnosis is shared.

## Steps

1. In startEdit(), print actorRefusal(state.actor).refusal when the shape is wrong, and keep the user: requirement as its own message
2. In profileProblems(), report actorRefusal(profile.actor).refusal when the shape is wrong, and keep the agent: requirement as its own message
3. Test an uppercase name and a wrong namespace for each, each with its own message

## Acceptance criteria

- [ ] An actor with a right namespace and a wrong name is refused for the name by the viewer's identity prompt and by the agent-profile validation. [proof: viewer-profile-actor-diagnosed]
