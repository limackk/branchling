---
id: TL-187
title: "TL-182 is closed but new still writes no history, and its contract could not tell"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:dev
role: dev  # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-03
updated: 2026-09-03
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: new-writes-history
    bash: "node --test scripts/tests/new-task.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

`branchling new` writes `backlog/history/<ID>.jsonl` for the task it just
created, and a test FAILS if it stops doing so. That is what TL-182 set out to
do; it is closed and it did not happen.

## Context

Measured on 2026-09-03 in this repository while working on TL-183. `node
scripts/cli.mjs new --title "…"` created two task files, TL-186 and TL-187, and
`backlog/history/` gained nothing for either — before or after a `build` and a
`check`. `scripts/new-task.mjs` contains no reference to the history at all: its
only write is the task file itself, at line 383.

TL-182 ("`new` writes no history, so a task's birth is recorded by whoever
reconciles first") is `status: done`, closed on 2026-09-03. Its two commits,
d41a7dc and d6de39f, changed exactly two files: the task's own description and
its own history log. No code was touched.

**Why the contract did not notice.** TL-182's `verification:` is one entry —
`node --test scripts/tests/new-task.test.mjs scripts/tests/history.test.mjs` —
two suites that already existed and that pass whether or not `new` records
anything. It is the zero-sample guard CLAUDE.md warns about: green, with no
evidentiary force. A contract that names the thesis would have been a test that
runs `new` and then asserts the log file exists.

**Why this is a new task and not a reopening.** TL-182's closing is a fact in
the history, and rewriting a closed task's status from another session would
erase the trace of how it was closed. This task names it instead and finishes
the work.

**The defect TL-182 described is still true**, so its Context still applies: a
task's `__created__` entry is written by whichever tree reconciles first, under
that tree's actor, which is also what TL-180 is about from the other side.

## Pre-flight reading

1. `scripts/new-task.mjs` — the only write is `writeFileSync(full, text, …)`
   around line 383; nothing else leaves the tasks directory.
2. `backlog/tasks/TL-182-new-writes-no-history-so-a-task-s-birth-is-recorded-by.md`
   — the reasoning, the measurement and the decisions are all there and stand.
3. `scripts/history-record.mjs` and `scripts/history.mjs` — how the other
   writing commands append an entry, and under which actor.
4. `scripts/take-task.mjs` — a writing command that records what it did, as the
   shape to follow.

## Steps

1. Make `new` append the creation entry under the resolved actor, the way the
   other writing commands do.
2. Write the test FIRST and watch it fail against the current code: run `new` in
   a fixture tree and assert `history/<ID>.jsonl` exists and names the actor.
   A test that cannot fail today would repeat TL-182's mistake exactly.
3. Leave TL-182 closed and untouched. This task's commit says what happened.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] `new` in a fixture tree leaves a history log for the task it created,
      naming the actor that ran it. [proof: new-writes-history]
- [x] The test fails when the write is removed — established by running it
      against the current code before the fix. [proof: new-writes-history]
- [x] Nothing else in the suite changed. [proof: suite-green]
