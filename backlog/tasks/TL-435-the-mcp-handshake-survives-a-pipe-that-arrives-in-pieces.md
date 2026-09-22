---
id: TL-435
title: "The MCP handshake survives a pipe that arrives in pieces"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-22
updated: 2026-09-22
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: [TL-158]                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: mcp-suite
    bash: "test -f scripts/tests/mcp.test.mjs && node --test scripts/tests/mcp.test.mjs"
  - id: green-on-macos
    bash: "id=$(gh run list --workflow test.yml --branch master --limit 1 --json databaseId --jq '.[0].databaseId') && gh run view $id --json jobs --jq '.jobs[] | select(.name | test("macos")) | .conclusion' | grep -vqx success && exit 1 || echo 'every macOS job of the latest run on master is green — OK'"
---

## Goal

The MCP server's first handshake over a pipe is answered on a macOS runner too — today `it answers `initialize` and lists its tools over a pipe` dies on `Unexpected end of JSON input` there.

## Context

Measured on 2026-09-22 (Europe/Warsaw) in https://github.com/limackk/branchling/actions/runs/35697131745 (commit 12bacb6). `scripts/tests/mcp.test.mjs:76` fails on `test (18, macos-latest)` and `test (20, macos-latest)` with `SyntaxError: Unexpected end of JSON input` raised at `mcp.test.mjs:69` — the helper `rpc()` splitting the server's stdout into JSON lines got an empty or truncated chunk. The same case passes on both ubuntu runners and on every local run, and the neighbouring cases ('a version nobody knows is answered in one we do', 'an unknown method is an error') pass on the SAME runner, which points at the FIRST request rather than at the protocol.

Two candidates, and they need different fixes: the test reads stdout before the child has written a complete line (a test defect — the reader must accumulate until a newline instead of parsing whatever arrived), or the server writes its first response in more than one chunk. Either way a caller of an MCP server over a pipe faces the same thing, so the finding is not confined to the test.

## Steps

1. Read the `rpc()` helper in `scripts/tests/mcp.test.mjs` and make it accumulate stdout until it has whole lines, so an empty or partial chunk is not parsed.
2. Check `scripts/mcp-server.mjs` writes each response as one line and does not depend on stdout flushing at exit.
3. Prove it against the runner that failed, not only locally: the case is green on a macOS job of a run on the default branch.

## Acceptance criteria

- [ ] The MCP tests pass in this session's environment. [proof: mcp-suite]
- [ ] Every macOS job of the newest run on the default branch concluded success. [proof: green-on-macos]
