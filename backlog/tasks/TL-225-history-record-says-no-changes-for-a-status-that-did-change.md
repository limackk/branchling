---
id: TL-225
title: "history-record says no changes for a status that did change, and the snapshot advances anyway"
type: bug
labels: []
board: main
epic: ""
priority: P1
status: done
owner: agent:codex
role: ""
executor: ""
estimate: 2h
confidence: medium
created: 2026-09-03
updated: 2026-09-07
blocked_by: []
blocks: []
related_docs: []
verification:
  - id: history-suite
    bash: "node --test scripts/tests/history.test.mjs"
---

## Goal

A status change made outside the viewer reaches the log, or the command says
plainly that it could not — never "no changes to record" while the snapshot
quietly moves on without it.

## Context

Found in a consumer's repository while fixing TL-224, and it is NOT that bug: the
hook ran to completion with a properly piped payload, and the log still gained
nothing.

**Measured, in a sandbox derived from `cli.test.mjs`'s own fixture** (a
hand-rolled one is not enough — a thin fixture fails the build for its own
reasons and looks like this defect):

1. `regen-hook` with a real payload for `BL-900`, status `blocked`. Views
   rebuilt, `INDEX.yaml` written, `↻ backlog: rebuilt …` printed. `history/`
   never created.
2. Status changed to `done` in the file. Hook run again, same payload. Views
   rebuilt again. `history/BL-900.jsonl` still absent.
3. `history-record --file … --actor agent:claude --source hook` run directly,
   with its output visible: **`branchling history: no changes to record`**, exit
   0, both times.

The actor resolves correctly (`agent:claude`), so this is not the actor guard.

**The same shape in the wild.** In the consumer's real backlog, a task carried
`status: done` in its file and `"status": "done"` in `history/.snapshot.json`,
while its `.jsonl` held only the `__created__` line — the transition existed in
neither. The snapshot had advanced past a change that never reached a log.

**This class is already named here.** The `adopted` reporting in
`history-record.mjs` carries the comment: *"ten changes moved into the snapshot,
none reached a log, and the command printed nothing about either."* TL-185
answered the case where the tasks were absent from the snapshot. The measurement
above is a task that IS in it, on the `--file` route, and still loses the change.

**Two candidates, neither confirmed — start by telling them apart.**

- The `--file`/`only` route seeds or advances the snapshot without emitting,
  so the first sighting of a task is silently absorbed rather than reported as
  a reference point (`seeded` is false, `entries` is empty, and the printed
  sentence is the reassuring one).
- Something other than `history-record` writes the snapshot — `build` is the
  obvious suspect, and it runs first in `regen-hook` — after which the
  reconcile has nothing left to see.

Deciding between them is a matter of instrumenting one run; it is written here as
a question rather than an answer so nobody inherits a guess as a finding.

## Pre-flight reading

1. `scripts/history-record.mjs` — the `only` path, and the branch that prints
   "no changes to record"
2. `scripts/history.mjs` — `reconcile`, `seeded`, `adopted`,
   `unattributedChanges`
3. `scripts/build-backlog.mjs` — whether it touches `history/.snapshot.json`

## Steps

1. Reproduce with the sandbox above, in a test.
2. Establish which of the two candidates it is before changing anything.
3. Whatever the cause: a run that moves the snapshot past a change it did not
   log must SAY SO. "No changes to record" is the sentence that made this
   invisible, and it reads as "everything is recorded".

## Acceptance criteria

- [x] A status change on the `--file` route reaches the log, or the run names
      what it could not record. [proof: history-suite]
- [x] The snapshot never advances past a change that reached no log without the
      run saying so. [proof: history-suite]
