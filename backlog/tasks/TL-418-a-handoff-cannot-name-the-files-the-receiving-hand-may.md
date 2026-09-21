---
id: TL-418
title: "A handoff cannot name the files the receiving hand may change"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-21
updated: 2026-09-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: the-exception-is-recorded
    bash: "node --test scripts/tests/handoff.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

A hand that passes a task on can name the files the receiving hand is permitted
to change, so an exception to a charter is on the RECORD rather than in a
sentence nobody can act on.

## Context

TL-277 decided that a registration table is not a proof, and that the way out of
a boundary two hands cannot cross is to move the registry beside what it
registers — not to license an exception. That closed the measured case and left
this one open: a change which genuinely needs an edit on both sides, where
neither hand is wrong and nothing can be moved.

Today the only channel is `--reason`, free text. It is read by a person, not by
the tool, and nothing afterwards can tell whether the receiving hand stayed
inside the exception it was granted.

`handoff --with <files>` was sketched in TL-277 step 3 and not built: the
command lives in `scripts/handoff-task.mjs`, which was held by another branch,
and the shape is a real design question rather than a flag. What does the tool
do with the list — record it in the history and stop, or check it? A check that
cannot be enforced would be a promise the tool does not keep, and a record that
nothing reads is a comment with extra syntax.

## Pre-flight reading

1. `backlog/tasks/TL-277-two-hands-pass-one-task-back-and-forth-because-neither-may.md`
   — the decision this is the remainder of
2. `scripts/handoff-task.mjs` — the command and what it writes to the history
3. `backlog/roles/dev.md`, `backlog/roles/spec.md` — the charters an exception
   would be an exception to

## Steps

1. Settle what the list IS — a record, or a check — and record it with
   `branchling decide`.
2. Build the smaller half first: the list in the history entry, so a later
   reader can see the exception that was granted.

## Acceptance criteria

- [ ] A handoff can name the paths the receiving hand may change, and they are
      recorded as part of the handoff event rather than inside its prose.
      [proof: the-exception-is-recorded]
- [ ] A handoff with no such list behaves exactly as it does today.
      [proof: suite-green]
