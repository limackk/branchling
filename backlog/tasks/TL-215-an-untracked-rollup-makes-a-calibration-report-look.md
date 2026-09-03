---
id: TL-215
title: "An untracked rollup makes a calibration report look complete when it is not"
type: task
labels: [hygiene]
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-09-03
updated: 2026-09-03
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs:
  - scripts/check-backlog-history-tracked.mjs
  - scripts/git-rules.mjs
verification:
  - id: the-guard-exists
    bash: "node scripts/cli.mjs check --help 2>&1 | grep -qi rollup && echo 'the guard is selectable — OK'"
  - id: green-on-this-tree
    bash: "node scripts/cli.mjs check --rollups"
  - id: positive-control
    bash: "node --test scripts/tests/rollup-tracked.test.mjs"
---

## Goal

A rollup written and never committed has to fail a guard, the way an untracked
history log already does.

## Context

Found while closing TL-197 on 2026-09-03. That task was filed on the belief that
`backlog/activity/rollup/` should be gitignored; the opposite is true — the
aggregate is what `calibration.mjs` (TL-29) builds its report from, and
`scripts/activity.mjs` says outright that it "travels with the project and goes
through review".

Measured before the fix: **10 of 44 rollups were tracked. 34 had been written
and never committed.** They are produced as a side effect of the activity hook,
so nobody stages them; `doctor` was honestly green throughout, because its
`git ignores the views` row checks the IGNORE RULES, and the ignore rules were
correct. Nothing anywhere asks the different question: is the thing that must
travel actually travelling?

**Why a snapshot fix is not enough.** TL-197 committed the 34 files, and that
holds until the next hook run writes the 35th. The drift is not an accident
somebody made once, it is what happens by default.

**The precedent is exact.** TL-43 found the same shape for
`backlog/history/*.jsonl` — the log is written beside a task and left untracked,
so another tree sees a task with no history and honestly takes it for new — and
answered it with `check --history` plus a `doctor` row. This is that guard, one
directory over. Read `scripts/check-backlog-history-tracked.mjs` first and copy
its shape rather than inventing a second one; in particular copy how it
separates "a log with no task in this tree" (somebody else's branch, a warning)
from "a log whose task IS here and is untracked" (a missing commit, an error).

**What the guard must NOT do.** It must not demand a rollup for every task.
Most tasks have none, because no session was measured against them, and a guard
that turned that into an error would be wrong about 170 archived tasks on the
day it shipped.

## Pre-flight reading

1. `scripts/check-backlog-history-tracked.mjs` — the whole file; this is the
   same guard for a different directory.
2. `scripts/git-rules.mjs` — `IGNORE_RULES` and `VIEW_PATHS`, so the new check
   agrees with the ignore rules instead of contradicting them.
3. TL-197 — how the premise was got backwards, so this one does not repeat it.

## Steps

1. `scripts/check-rollups-tracked.mjs`: every file under `activity/rollup/` that
   exists on disk is tracked by git. A missing rollup is not a finding.
2. Wire it into `check` as `--rollups` and into the default `check` run.
3. A `doctor` row beside the history one.
4. `scripts/tests/rollup-tracked.test.mjs` with a positive control: a fixture
   with one untracked rollup must FAIL, or the guard is green on nothing.

## Acceptance criteria

- [ ] `check --rollups` exists, is in the default run, and is green here.
- [ ] A fixture with an untracked rollup fails it.
- [ ] A task with no rollup at all is not a finding.
- [ ] `doctor` reports it in a row of its own.
