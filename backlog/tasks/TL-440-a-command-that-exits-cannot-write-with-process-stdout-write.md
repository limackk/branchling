---
id: TL-440
title: "A command that exits cannot write with process.stdout.write"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 3h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-22
updated: 2026-09-22
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: [scripts/stdout.mjs, scripts/mcp-server.mjs]
verification:
  - id: the-guard-runs
    bash: "node --test scripts/tests/exit-safe-output.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
  - id: guards-green
    bash: "node scripts/cli.mjs check"
---

## Goal

A write that can outlive its process fails the build, instead of being caught
by whoever happens to run the right command on the right operating system.

## Context

`scripts/stdout.mjs` exists because of TL-175, and its own header states the
reason it chose a synchronous writer: the alternative was "auditing every
`process.exit()` in every command and keeping them audited". That audit was
never automated, and on 2026-09-22 the same defect shipped a second time.

`scripts/mcp-server.mjs` wrote its answers with `process.stdout.write` and
answered the end of stdin with `process.exit(0)`. `process.stdout` is
synchronous for a file and for a TTY, but a PIPE is synchronous only on Linux
and Windows — on macOS it is asynchronous. So the bytes `write` had accepted
were still inside the process when it exited, and the client received a severed
line: `Unterminated string in JSON at position 16354` on the macOS runners of
run 35697131745. 16354 is a pipe buffer, not a message boundary.

TL-435 fixed that one call site. This task removes the class.

**The surface matters.** MCP is the only entry point some users ever touch, and
a truncated answer there is data loss on the wire, not a cosmetic defect. It
was invisible locally on Node 24, which flushes in time, and visible only on
two of six CI jobs.

**The exception has to be expressible.** Some writes genuinely may be
asynchronous — a long-running command that never exits abruptly. The repository
already has the shape for this: a marker beside that ONE line, like
`product-name: allow` and `former-name: allow`. Use `stdout: allow`.

## Pre-flight reading

1. `scripts/stdout.mjs` — `writeOut`, and the header stating why the audit was
   rejected in favour of a writer. This task does not reverse that decision; it
   adds the enforcement that decision assumed.
2. `scripts/mcp-server.mjs` — the call site that missed it, already fixed.
3. `scripts/tests/check-guards.mjs` — the shape a guard of this kind takes here.

## Steps

1. Write `scripts/tests/exit-safe-output.test.mjs`. Scan `scripts/*.mjs` and
   `bin/*.mjs` for `process.stdout.write`, `process.stderr.write` and
   `console.log` in a file that also calls `process.exit`, and fail naming the
   file and line.
2. Honour `stdout: allow` on the same line, or on the line above an indented
   block that cannot carry a comment of its own.
3. Add the positive control: a fixture that writes more than a pipe buffer with
   `process.stdout.write` and then exits MUST make the guard fail. A guard that
   only passes on the current tree proves nothing about the next commit.
4. Fix, or mark, whatever the guard finds today.

## Acceptance criteria

- [ ] A file that writes with `process.stdout.write` on a path that also exits fails the guard. [proof: the-guard-runs]
- [ ] The positive control fails as designed, so the guard is not green on a zero sample. [proof: the-guard-runs]
- [ ] The whole suite stays green. [proof: suite-green]
- [ ] The release gates stay green. [proof: guards-green]
