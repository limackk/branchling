---
id: TL-524
title: "An external consumer follows backlog changes as a JSON stream"
type: task
labels: []
board: main
epic: "External UI contract"
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 4h
confidence: medium                 # how much you trust the estimate
created: 2026-11-02
updated: 2026-11-02
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: watch-stream
    bash: "node --test scripts/tests/watch-stream.test.mjs"
---

## Goal

An external consumer can subscribe to changes in one backlog as a stream of JSON envelopes on stdout, without polling and without depending on the private HTTP API of `branchling serve`.

## Context

scripts/serve-backlog.mjs already watches tasks/ and the backlog directory with fs.watch and pushes changes to the served page over SSE at /api/events, but that endpoint is an internal contract of the served page. A separate interface (for example a branchling-ui package that composes `--json` reading commands) currently has to poll `query --json`, paying a Node start per poll, or reimplement the watcher with its own debounce and reconciliation rules. One newline-delimited stream of declared envelopes keeps the fourth law: composition through output, no plugin API.

## Steps

1. Extract the watcher and its debounce from serve-backlog.mjs into a module both serve and the new command use.
2. Add a command (for example `branchling watch --json`) that prints one envelope per line for each changed task (id, change type, the fields that changed) and a heartbeat, and exits cleanly on SIGINT and when stdout closes.
3. Declare the event kind in scripts/json-envelope.mjs.
4. State in --help what the stream does not promise (ordering across worktrees, changes on other branches).

## Acceptance criteria

- [ ] Editing a fixture task while the command runs produces exactly one parseable envelope naming that task and field, and closing stdout ends the process. [proof: watch-stream]
