---
id: TL-100
title: "Documentation drift detector that creates docs tasks"
type: task
labels: []
board: main
epic: "Agentic differentiators"
priority: P2
status: done
owner: agent:claude
estimate: 1d
confidence: low
created: 2026-08-31
updated: 2026-09-02
blocked_by: [TL-97]
blocks: []
related_docs:
  - docs/backlog-time-tracking.md
verification:
  - bash: "node --test scripts/tests/docs-drift.test.mjs"
---

## Goal

`worktrail docs-drift` points out documents that have likely gone stale
relative to the project, and on request (`--seed-tasks`) creates tasks for
them with the `docs` role — with the list of signals in the body. The `run`
loop with an agent command for the docs role (TL-98) picks up these tasks and
updates the documentation through the same verification gate as any other
work.

The core of the split: the tool does NOT write documentation — it detects
that it is dying, and turns that into a queue item with closing proof. A
swappable agent in the docs role writes it.

## Context

Emerged from a product decision (2026-08-31): the "documentation-maintaining
agent" idea inverted so as not to break the boundary drawn by TL-96
(worktrail is not an agent). The hard half of the problem is not writing, but
KNOWING that a document has gone stale — and that is computable from data
that already exists (git + tasks + `related_docs:`).

Drift signals, each a separate, testable detector:
1. **Tasks around a document younger than the document** — a document listed
   in the `related_docs:` of tasks closed AFTER its last change in git; a
   threshold on the number of tasks in configuration.
2. **Dead references** — the document links files or tasks that do not
   exist.
3. **Status lies** — a `**Status:** PROJECT …` heading (this repo's `docs/`
   convention), while the tasks listed in the heading are `done`; status
   heading patterns come from configuration, not code.

Honesty rules — the condition for the report not becoming noise everyone
ignores (the inverse of "green with no evidentiary force"):
- every flagged document has SPECIFIC signals listed out (which tasks, which
  dead links), never just a verdict;
- below the signal threshold a document is not reported — the "too little
  signal" class is explicit in the summary, like "too little data" in
  calibration
  ([docs/backlog-time-tracking.md](../../docs/backlog-time-tracking.md) §11);
- `--seed-tasks` is idempotent: a document with an open docs task does not
  get a second one (key: the document path in the `related_docs:` of an open
  task with the docs role);
- a created task requires executable `verification:` — minimum: detectors
  1–2 for that document pass after the update; signal 3 is sometimes not
  automatically verifiable and in that case lands in the body, not in the
  gate.

Out of scope: LLM analysis of document content (that is the docs agent's
work, not the detector's), watching files live, any writes beyond
`--seed-tasks`.

## Pre-flight reading

- `backlog/tasks/TL-97-pole-role-taska-wymog-roli-ze-slownika-konfiguracji.md`
  — the docs role in the dictionary.
- `backlog/tasks/TL-90-tasklog-audit-deklaracje-kontra-slady-aktywnosci.md`
  — a sibling command (declarations vs. traces of activity); shared report
  style and exit codes, consider sharing the task+history read path.
- this repo's `docs/` — **Status:** headings, relative link format; the
  detectors are meant to be built on this convention, but with patterns in
  configuration.

## Steps

1. Detectors 1–3 as pure functions over (tasks, document git log, document
   content); thresholds and patterns in `config.yaml`.
2. Report: per-document signals with specifics, a "too little signal"
   section; `--json`; exit codes like `audit` (0 clean / 1 found / 2 error).
3. `--seed-tasks`: idempotent creation of tasks with the docs role through
   the existing `new` mechanism, signals in the body, verification = rerun
   of detectors 1–2 for the document.
4. Tests on fixtures (a temporary repo with docs + tasks): each detector with
   a positive and a negative case; idempotency of the seed (a second run
   creates nothing); a fresh document is not reported.

## Acceptance criteria

- [ ] Every detector has a test where it finds something, and a test where
      it rightly stays silent.
- [ ] A flag always includes specific signals; there is no "document is
      stale" verdict without a list of reasons.
- [ ] A repeated `--seed-tasks` does not create a duplicate task for the
      same document.
- [ ] A task created by the seed passes `worktrail check` and has executable
      verification.
- [ ] Thresholds and status heading patterns come from configuration; no
      document name or phrase from this project in the code.

## Log

Append-only. Format: `YYYY-MM-DD status — who — note`.

- 2026-08-31 blocked — agent:claude — task created from the decision on
  maintaining documentation; drift detection instead of an agent in the
  tool, executed by the docs role (TL-97/1508).
