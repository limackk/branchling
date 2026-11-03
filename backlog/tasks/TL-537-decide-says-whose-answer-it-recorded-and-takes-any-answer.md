---
id: TL-537
title: "decide says whose answer it recorded and takes any answer text"
type: task
labels: []
board: main
epic: "External UI contract"
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-02
updated: 2026-11-03
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: decide-actor
    bash: "node --test scripts/tests/decide.test.mjs"
---

## Goal

An answer recorded through `decide` is never silently attributed to the default agent actor, and any answer text, including one that starts with '-', can be passed.

## Context

Consumer: branchling-ui (limackk/branchling-ui), which may reach a backlog only through this CLI's --json answers. Its UI-23 waits on this; the envelope itself is TL-528. When no actor is configured, `decide` falls back to the default agent actor without saying so, and its JSON does not say where the actor came from, so a person's answer given through a UI can land in history as an agent's. Its argument parser has no `--` terminator and no `--flag=value`, so `--reason "-1 for this"` is refused.

## Steps

1. Add `actorSource: "flag" | "env" | "config" | "default"` to `decide --json`, and to the other writing commands' JSON if cheap
2. Accept `--reason=<text>` and a `--` terminator
3. Add `--require-actor`, refusing when the actor would come from the default

## Acceptance criteria

- [x] A reason starting with '-' is recorded verbatim, with no actor configured the JSON says actorSource default, and --require-actor refuses. [proof: decide-actor]
