---
id: TL-551
title: "The served viewer refuses a person's edit without a stated actor"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-04
updated: 2026-11-04
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: viewer-require-actor
    bash: "node --test scripts/tests/serve-require-actor.test.mjs"
---

## Goal

A field edit made through the served viewer on behalf of a person is refused, or shown to that person, when no actor was stated, instead of being recorded under the default agent.

## Context

TL-544 added --require-actor and actorSource on the CLI side. scripts/serve-backlog.mjs still runs its field edits without --require-actor and does not read actorSource, so an edit from a browser with no configured actor is recorded as the default agent, which attributes a person's act to a program.

## Steps

1. Pass --require-actor from the served viewer's field edit
2. Return the refusal to the page as a message that names how to state an actor
3. Test the refusal through the server

## Acceptance criteria

- [ ] The served viewer refuses a field edit with no stated actor and records one with a stated actor under that actor. [proof: viewer-require-actor]
