---
id: TL-478
title: "New outside a backlog refuses without a stack trace"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-10-17
updated: 2026-10-17
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: new-no-backlog
    bash: "node --test scripts/tests/no-backlog-refusal.test.mjs"
---

## Goal

`branchling new` run where no backlog exists prints the named refusal, not a JavaScript stack trace.

## Context

Observed on 2026-10-17 in a clone with no backlog/tasks/: `branchling new --title …` printed `file:///…/scripts/paths.mjs:132 throw new BacklogNotFoundError` followed by the stack, while `doctor` in the same tree printed the intended one-line refusal. TL-47 made BacklogNotFoundError a named, foreseen state precisely so that it never reaches the user as a crash; scripts/new-task.mjs main (around line 524) calls resolveBacklogDir() without the handling other commands use (resolveBacklogDirOrExit or an equivalent catch). Other commands may share the gap, which is worth checking across scripts/*.mjs.

## Steps

1. Route new-task.mjs through the same no-backlog handling as doctor
2. Check the other writing commands for a bare resolveBacklogDir() at the top level
3. Assert stderr carries no stack trace for new outside a backlog

## Acceptance criteria

- [ ] new and every other backlog command outside a backlog exit non-zero with the refusal and without a stack trace [proof: new-no-backlog]
