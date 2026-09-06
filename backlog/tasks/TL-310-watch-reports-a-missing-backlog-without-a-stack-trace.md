---
id: TL-310
title: "Watch reports a missing backlog without a stack trace"
type: task
labels: []
board: main
epic: "Execution observability"
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-06
updated: 2026-09-06
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: [scripts/watch.mjs, scripts/tests/no-backlog-message.test.mjs]
verification:                      # HOW to check the task is really done
  - id: missing-backlog-message
    bash: "node --test scripts/tests/no-backlog-message.test.mjs scripts/tests/watch.test.mjs"
---

## Goal

`branchling watch` handles a missing backlog as a readable refusal with a next
step, never as an uncaught stack trace.

## Context

The command-table regression test invokes every non-server command from an
empty directory. `watch` currently reaches its backlog resolver without the
same named-error handling as other commands, so first contact emits a stack
trace. The watcher should preserve its normal output and alternate-buffer
behaviour when a backlog exists; only the predictable no-backlog path changes.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/watch.mjs` — argument parsing, backlog resolution and its terminal
   lifecycle.
2. `scripts/tests/no-backlog-message.test.mjs` — the command-table contract for
   a missing backlog.
3. `scripts/tests/watch.test.mjs` — watcher-specific output and JSON coverage.

## Steps

1. Catch the named missing-backlog error at the command boundary.
2. Render the shared refusal shape with a usable `--dir` or `init` next step.
3. Add a watcher-specific regression assertion if the table-wide test cannot
   distinguish the error from a generic non-stack failure.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [ ] Running `watch` outside a backlog produces no stack trace and names how
  to select or create a backlog. [proof: missing-backlog-message]
- [ ] Existing `watch` output and JSON tests remain green. [proof: missing-backlog-message]
