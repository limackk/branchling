---
id: TL-146
title: "An agent that is not Claude Code can reach the backlog over MCP"
type: task
labels: []
board: main
epic: ""
priority: P2                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
estimate: 1d                       # 30m | 2h | 1d | 1w | 1mo
created: 2026-09-02
updated: 2026-09-02
blocked_by: []
blocks: []
related_docs: ["docs/branchling-global-tool.md"]
verification:                      # HOW to check that the task is really done
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
  - id: guards-green
    bash: "node scripts/cli.mjs check"
---

## Goal

`worktrail mcp` starts a Model Context Protocol server over stdio that exposes
the existing commands to any MCP client, so an agent that is not Claude Code
(Codex, Gemini CLI, Kiro, an IDE) can read and write the backlog without
shelling out to the CLI.

Today the only way in is the CLI. For Claude Code that is enough, because it
runs shell commands natively and `worktrail instructions` hands it the
procedure. For every other agent host it is a barrier at the door, and it is
the first line of the comparison with Backlog.md, which ships `backlog mcp
start` and lists four hosts it connects to. Without this, that comparison is
lost before the differences that matter (a `done` that refuses, a log with an
actor and a reason, atomic reservation) are ever reached.

## Context

**This is a thin adapter, not a second interface.** Law 4 in
`docs/branchling-global-tool.md` §3 is what makes it thin: every reading
command already answers in a `--json` envelope with `schemaVersion` (TL-72),
and every writing command is callable from outside. The MCP server maps tools
onto those two surfaces and adds NOTHING of its own — no logic, no second
validation, no vocabulary. A rule that exists only in the MCP layer is a rule
the CLI does not enforce, which is the divergence the four laws exist to
prevent.

Constraints that follow directly from the repository's rules:

- **Zero dependencies stays.** The MCP wire format over stdio is JSON-RPC 2.0
  and is small enough to implement with `node:readline` and `JSON.parse`. If
  an SDK turns out to be unavoidable, that is a decision to record, not a
  default.
- **The product name comes from `scripts/product.mjs`.** Tool names and the
  server's self-description go through it; `check --product-name` will catch
  a literal.
- **An unknown tool or argument FAILS**, the same way an unknown command or
  flag fails in `cli.mjs`. The tool list is closed for the same reason
  `COMMANDS` is.
- **Reservation semantics carry over.** `next` and `take` over MCP reserve
  the task exactly as the CLI does — same lock, same actor rule. An MCP call
  without a namespaced actor is refused, not defaulted.
- **The instructions travel too.** Expose `instructions overview` and the
  three phase guides as MCP resources, so an agent on another host reads the
  same procedure Claude Code reads, rendered with this backlog's vocabulary.

What this deliberately does NOT do: it does not replace `worktrail
instructions` for Claude Code, and it does not add a transport other than
stdio. HTTP is the hosted mode's concern (§6 of
`docs/branchling-state-and-sync.md`) and is not built before §8's gate opens.

## Steps

1. Enumerate the commands to expose and their `--json` shapes; the tool
   schema is DERIVED from the command table, not written by hand beside it.
2. Implement the stdio JSON-RPC loop and the `initialize` / `tools/list` /
   `tools/call` / `resources/list` / `resources/read` handlers.
3. Route each tool call through the same code path the CLI uses, so a
   refusal (unknown flag, missing reason, bare actor) is the SAME refusal.
4. Add a test that drives the server over a pipe and asserts, with a positive
   control, that an unknown tool is refused and that `take` over MCP leaves
   the same lock file the CLI leaves.
5. Document the client configuration for at least two hosts in the README.

## Acceptance criteria

- [x] `worktrail mcp` speaks MCP over stdio and lists its tools. [proof: suite-green]
- [x] Every tool routes through the CLI's own code path; no rule exists only in the MCP layer. [proof: suite-green]
- [x] An unknown tool or argument is refused with a non-zero-style error, never ignored. [proof: suite-green]
- [x] `take` over MCP creates the same reservation the CLI creates, and a bare actor is refused. [proof: suite-green]
- [x] The phase guides are readable as MCP resources. [proof: suite-green]
- [x] No new dependency in `package.json`, and no product-name literal. [proof: guards-green]
