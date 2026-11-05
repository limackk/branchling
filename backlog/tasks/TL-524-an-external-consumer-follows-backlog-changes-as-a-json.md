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
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
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

- [x] Editing a fixture task while the command runs produces exactly one parseable envelope naming that task and field, and closing stdout ends the process. [proof: watch-stream]

## Decisions

- **The command is `follow`, not `watch`.** `watch` was the name of the live
  execution monitor that TL-381 removed from the product, and
  `scripts/tests/execution-product-boundary.test.mjs` asserts it stays absent.
  Reusing the name for a different contract would weaken that guard and make
  the archived tasks that describe `watch` (TL-305, TL-360, TL-369) read as if
  they described this stream.
- **Content is compared, not events counted.** One atomic write is several
  filesystem events; the stream diffs each task file against the last snapshot
  (`diffMeta` over the tracked fields, plus the body under the history log's
  name `__body__`), so one edit is one envelope and an event that changed
  nothing is silent. `updated:` is not reported, for the reason `diffMeta`
  already gives.
- **`--max-events <n>` bounds the stream.** `0` arms the watch, prints `ready`
  and exits, which is how the envelope registry exercises the kind without a
  process that waits forever; `1` is "wait for the next change".
- **Not done:** `plan.yaml`, history records and other worktrees are not part
  of the stream (stated in `--help`); `serve`'s SSE contract is unchanged.
