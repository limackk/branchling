---
id: TL-544
title: "Writing commands report where their actor came from"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:lane-a
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-03
updated: 2026-11-04
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: actor-source
    bash: "node --test scripts/tests/actor-source.test.mjs"
---

## Goal

Every writing command's --json answer carries actorSource (flag, env, config or default), as decide --json does since TL-537, so an interface can see that a person's write was attributed to the default agent actor.

## Context

TL-537 added actorSource and --require-actor to decide only (scripts/decide-task.mjs, via resolveActorSource in scripts/actor.mjs). take, next, handoff, release, set, body, ask and done each resolve their actor in their own module with resolveActor, which discards the source, and their envelopes in scripts/json-envelope.mjs have no actorSource key.

## Steps

1. Resolve the actor with resolveActorSource in each writing command and map the user source to config
2. Add actorSource to each writing kind in scripts/json-envelope.mjs, docs/manual.md and docs/external-consumers.md
3. Decide per command whether --require-actor applies, and add it where a person's act is recorded

## Acceptance criteria

- [x] Each writing command's --json answer names the source of its actor, default included. [proof: actor-source]
