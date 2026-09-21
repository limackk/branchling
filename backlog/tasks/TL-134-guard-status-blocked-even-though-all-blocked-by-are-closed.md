---
id: TL-134
title: "Guard: status blocked even though all blocked_by are closed"
type: task
labels: []
board: main
epic: "Data integrity"
priority: P1                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:session
estimate: 2h                       # 30m | 2h | 1d | 1w | 1mo
created: 2026-09-01
updated: 2026-09-02
blocked_by: []
blocks: []
related_docs: []
verification:                      # HOW to check that the task is really done
  - id: guard-fails-on-stale
    bash: "node --test scripts/tests/dangling-refs.test.mjs"
  - id: guard-green-on-tree
    bash: "node scripts/cli.mjs check --refs"
---

## Goal

`worktrail check` should **report** a task with `status: blocked` whose every
`blocked_by` is already closed (`done` / `cancelled`). Today it passes without
a word.

## Context

Measured on 2026-09-01 on this repository, while laying out waves for the
"Agent-facing distinctives" epic. Four tasks — TL-95, TL-96, TL-101, TL-114 —
sat at `blocked`, while all of their blockers had been `done` for many
commits.

**Why this is not cosmetic.** `blocked` is in `reason_required_statuses`
(`backlog/config.yaml`), and `worktrail next` deliberately does NOT hand out
statuses from that list — because entering them was someone's decision, which
an unsupervised agent has no right to reverse. A stale `blocked` is therefore
something worse than a bad field: **it removes the task from the queue for
good**, and silently. `worktrail plan` showed the wave as ready to take, and
`next` had nothing to hand out from it.

This is the same class as TL-41 (dangling `blocked_by` did not fail any
gate), but a **different case**: there the reference pointed to a
non-existent task, here every reference is valid and closed. The guard from
TL-41 does not catch this — checked.

**What this task does NOT cover.** Automatically switching the status.
Leaving `blocked` is a state change and has to go through a write with a
reason, like any other; the guard is to REPORT, and leave the decision to a
human or to a writing command.

## Steps

1. In `scripts/check-backlog-refs.mjs` (or a separate module, if it does not
   fit there), add a rule: `status` == the status meaning blocked **and**
   every `blocked_by` closed → report.
2. Decide the level: FAIL or warn. Argument for a warning — the sequence of
   closing the blocker and unblocking is inherently two writes, so a momentary
   drift is normal mid-work.
3. Take statuses from `config.yaml`, not from the literal `"blocked"` — a
   status name is another project's vocabulary (law 3).
4. Positive control in the test: a fixture with such a task MUST be reported.
   A guard that passes on a zero sample is green with no evidentiary force.

## Acceptance criteria

- [x] A task with a blocked status and all `blocked_by` closed is reported by
      `worktrail check`. [proof: guard-fails-on-stale]
- [x] The status name comes from `config.yaml`, not from a literal in the
      code. [proof: guard-fails-on-stale]
- [x] The test has a positive control — a fixture on which the guard MUST
      report. [proof: guard-fails-on-stale]
- [x] The guard is green on the current tree of this repository. [proof:
      guard-green-on-tree]
- [x] The guard changes nothing — it reports and ends. [proof:
      guard-fails-on-stale]
