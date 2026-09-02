---
id: TL-90
title: "worktrail audit — declarations versus traces of activity"
type: task
labels: []
board: main
epic: "Agentic distinguishers"
priority: P2
status: pending
owner: unassigned
estimate: 1d
confidence: medium
created: 2026-08-31
updated: 2026-08-31
blocked_by: []
blocks: []
related_docs:
  - docs/backlog-field-editing-history.md
  - docs/backlog-time-tracking.md
verification:
  - bash: "node --test scripts/tests/audit.test.mjs"
---

## Goal

`worktrail audit` cross-checks the backlog's declarations against traces in
the event log and reports divergences:

- a task marked `done` with not a single transition event in `history/` —
  closed without a trace;
- a task reopened after `done` — rework, counted per closing actor
  ("done by agent:claude comes back N% of the time");
- `in_progress` with no field change for `audit_stale_days` — parked, not
  being worked on;
- `blocked` with an empty `blocked_by` — a declaration with no premise.

The backlog stops being a set of declarations taken on faith: every "done"
either has proof or is flagged. No competitor (Backlog.md, mdtask) can do
this, because none of them has transition events or attribution.

## Context

Grew out of a review of distinguishers against Backlog.md (2026-08-31). The
class of bug is real and local: commit 27776f0 ("TL-52 was done and said
pending") and the parked `in_progress` state described in
[docs/backlog-time-tracking.md](../../docs/backlog-time-tracking.md) §3.1
(45 `in_progress` tasks, 32 with `owner: claude` — that is not 32 working
agents).

Rules, without which this report would itself be lying:
- **No trace is a suspicion, not a verdict.** History started on 2026-08-30
  and is a log of observations, not an audit log
  ([docs/backlog-field-editing-history.md](../../docs/backlog-field-editing-history.md)
  §4). Tasks closed before day zero are to be filtered out by date, not
  reported in bulk as anomalies.
- **Thresholds live in configuration** (`audit_stale_days` etc.) — the code
  knows the shape.
- **This is a backlog-hygiene tool, not a tool for evaluating people** — the
  same boundary that time-tracking §13 sets for time measurement; the
  sentence has to appear in the command's description.
- Per-actor buckets below a threshold `n` report "insufficient data" (the
  rule from time-tracking §11).

Distinction from `worktrail check`: check validates STRUCTURAL CONSISTENCY
(ID collisions, boards, dangling references) and fails a commit; audit
validates the TRUSTWORTHINESS OF DECLARATIONS and is a report for a human.
Do not merge them — different moment of use, different exit code.

## Pre-flight reading

- [docs/backlog-field-editing-history.md](../../docs/backlog-field-editing-history.md)
  §2, §4 — entry format, deduplication, deliberate limits of attribution.
- [docs/backlog-time-tracking.md](../../docs/backlog-time-tracking.md) §3.1,
  §8.2 — the cycle-time trap and the "unknown is a number" rule.
- `scripts/check-backlog-refs.mjs` — the existing pattern for walking tasks
  with references.

## Steps

1. Detectors as separate functions over a shared read (tasks + history):
   done-with-no-trace, reopen-after-done, stale-in-progress,
   blocked-with-no-premise.
2. Text report grouped by detector + `--json`; count of each class in the
   header; `--since` filter defaulting to history's day zero.
3. Rework rate per actor with a threshold `n` and "insufficient data" below
   it.
4. Exit codes: 0 clean, 1 divergences found, 2 call error — consistent with
   the rest of the CLI.
5. Tests on fixtures: each detector has a positive case and a negative case;
   a positive control is mandatory (a guard that passes on an empty tree is
   green with no evidentiary force — CLAUDE.md).

## Acceptance criteria

- [ ] Each detector has a test where it finds SOMETHING, and a test where it
      rightly stays silent.
- [ ] Tasks predating the start of history are not reported as "done with no
      trace".
- [ ] Thresholds come from `config.yaml`; an unknown key fails as before.
- [ ] The per-actor report applies the threshold `n` and does not evaluate
      below it.

## Log

Append-only. Format: `YYYY-MM-DD status — who — note`.

- 2026-08-31 pending — agent:claude — task created from a review of agentic
  distinguishers; motivation: 27776f0 and §3.1 of the time-tracking document.
