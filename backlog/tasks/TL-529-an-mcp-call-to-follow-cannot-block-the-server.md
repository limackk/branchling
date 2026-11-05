---
id: TL-529
title: "An MCP call to follow cannot block the server"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1h
confidence: medium                 # how much you trust the estimate
created: 2026-11-02
updated: 2026-11-02
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: mcp
    bash: "node --test scripts/tests/mcp.test.mjs"
---

## Goal

An MCP tool call to `follow` returns instead of blocking the server forever.

## Context

scripts/mcp-server.mjs exposes every command not in NOT_EXPOSED, and `follow` (TL-524) is not there. `callCli` runs each call with `spawnSync` and no timeout, while `follow` without `--max-events` never exits, so a client calling the `follow` tool hangs the whole stdio server: no later request is answered. Either `follow` joins NOT_EXPOSED with its reason (a stream cannot be one tool result, as `serve` and `run` already state), or the call is bounded. docs/external-consumers.md (TL-525) already tells consumers to run `follow --json` beside MCP rather than through it.

## Decision

`follow` joins `NOT_EXPOSED`; the call is not bounded. A bounded call
(`--max-events` forced, or a timeout on `spawnSync`) would return a truncated
slice of a stream as if it were an answer, and picking the bound is a guess
either way: too short and a quiet backlog returns nothing, too long and the
server still stalls every other request for that long, because calls are
served one at a time. A stream is not one tool result — the same reason
`serve` and `run` are excluded — and docs/external-consumers.md already tells
consumers to run `follow --json` beside MCP. Not done: a general timeout for
every tool call, which is a separate question about commands that are meant to
return.

## Steps

1. Decide between NOT_EXPOSED and a bounded call, and record why.
2. Add a test in scripts/tests/mcp.test.mjs that the follow tool is either absent from tools/list or returns within a bound.

## Acceptance criteria

- [x] The follow tool no longer blocks the MCP server. [proof: mcp]
