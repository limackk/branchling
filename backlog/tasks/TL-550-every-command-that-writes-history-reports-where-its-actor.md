---
id: TL-550
title: "Every command that writes history reports where its actor came from"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-4
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 3h
confidence: medium                 # how much you trust the estimate
created: 2026-11-04
updated: 2026-11-05
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: actor-source-rest
    bash: "node --test scripts/tests/actor-source-remaining-writers.test.mjs"
---

## Goal

seed, import, deploy record, new and run report actorSource the way the commands TL-544 covered do, so a write made through them is never attributed to the default agent unseen.

## Context

TL-544 added actorSource, from resolveActorReport, to the writing commands' --json envelopes. scripts/seed-backlog.mjs, scripts/import-github.mjs, scripts/release-record.mjs (deploy record) and scripts/run-loop.mjs still call resolveActor and drop the source; scripts/new-task.mjs records the creation through the default chain in recordCreation and has no --actor flag at all.

## Steps

1. Resolve the actor through resolveActorReport in each of the five commands
2. Carry actorSource in each --json envelope and document it in docs/external-consumers.md
3. Give new an --actor flag, validated like the other writing commands
4. Assert actorSource per command in a targeted test

## Acceptance criteria

- [x] seed, import, deploy record, new and run report actorSource in their --json envelopes. [proof: actor-source-rest]
