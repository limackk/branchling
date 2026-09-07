---
id: TL-366
title: "A failed history write cannot close a task"
type: bug
labels: []
board: main
epic: "Controlled and observable agent execution"
priority: P1                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-07
updated: 2026-09-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: [scripts/done-task.mjs, scripts/history.mjs]
verification:                      # HOW to check the task is really done
  - id: durable-close
    bash: "node --test scripts/tests/done-task.test.mjs scripts/tests/history.test.mjs"
---

## Goal

A task is never left with `status: done` unless its corresponding history
records were written too. A failure to acquire the history mutex must leave the
task unchanged, or the command must recover the paired records before it
reports success.

## Context

`done-task.mjs` currently writes task frontmatter before calling `recordEdit`.
During TL-355 finalization, a sandbox-denied write to the external state
directory made `recordEdit` fail after the task had already become `done` and
its criteria were ticked. The next invocation correctly refused an already
closed task, leaving no `done` history event. The close operation must not have
that partial-success state.

## Pre-flight reading

1. `scripts/done-task.mjs` — inspect the order of frontmatter and history writes.
2. `scripts/history.mjs` — preserve the mutex and append-only history contract.
3. `scripts/tests/done-task.test.mjs` — extend the finalization regression suite.

## Steps

1. Make finalization transactional from the user's point of view: no closed
   frontmatter without its history record.
2. Add a deterministic regression that makes the history write fail after
   verification succeeds.
3. Preserve existing successful close behavior and append-only history rules.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [ ] A failed history write leaves status and proof markers unchanged, and a
      normal close still writes matching task and history state. [proof: durable-close]
