---
id: TL-91
title: "Board time-lapse replayed from the event log"
type: task
labels: []
board: main
epic: "Agentic differentiators"
priority: P3
status: pending
owner: unassigned
estimate: 1d
confidence: low
created: 2026-08-31
updated: 2026-08-31
blocked_by: []
blocks: []
related_docs:
  - docs/backlog-field-editing-history.md
  - docs/worktrail-state-and-sync.md
verification:
  - bash: "node --test scripts/tests/board-replay.test.mjs"
---

## Goal

The viewer gets a replay mode: the event log knows every status transition
with a timestamp, so the board can be scrubbed through time — from day zero
to today, with a slider and animation, distinguishing an `agent:` actor from
a human by color. The same mechanism gives "board on day X" (a time machine
for retrospectives).

Product value: a visual proof of the architecture (state = fold(log)) and
material that circulates on GitHub — 1400 tasks flowing through the board in
a minute.

## Context

Came out of a review of differentiators against Backlog.md (2026-08-31).
Everything is a pure derivative of existing data (Law 2 — computed,
deletable): the function `stateAt(taskId, ts)` is a fold of `history/`
entries up to a given moment. Zero new data, zero new writes.

Constraints that must be shown, not hidden:
- **History starts on 2026-08-30.** Before that date, the only honest signal
  is completion timestamps backfilled from git (TL-27, once it exists) —
  following the rule "backfill the completion timestamp, never the work
  time" ([docs/backlog-time-tracking.md](../../docs/backlog-time-tracking.md)
  §2). Without TL-27 the timeline starts on the day history begins, and the
  slider must show that explicitly rather than pretend the project was empty
  before it started.
- `legacy` entries (without a ULID) participate in the fold by `ts`, like
  everything else.

A technical decision to make at the start: compute the replay in the browser
from the history embedded in the build (as history already is in `file://`
mode today) — no new endpoint. If the volume of entries makes the build too
heavy, only then move to a per-day frame aggregate (also computed, also
deletable).

## Pre-flight reading

- [docs/backlog-field-editing-history.md](../../docs/backlog-field-editing-history.md)
  §2 — entry format, dedup on read, `__created__` / `__deleted__`
  pseudo-fields (a frame needs to know whether the task exists at all at
  that point).
- `scripts/build-viewer.mjs` — how history reaches the build and how client
  code lives inside a template literal (the backslash trap, §8 of the same
  doc).
- `scripts/history.mjs` — reading entries.

## Steps

1. `stateAt`: fold per-task history up to moment `ts` (status + existence);
   a module runnable in Node (testable) and inlined as source into the
   viewer, like `task-fields.mjs`.
2. UI: a date-range slider + replay at adjustable speed; a day counter and
   per-status task counts; color distinguishes `agent:` changes from the
   rest.
3. View state in the URL (consistent with the existing view-state
   mechanism), so "board on 2026-07-01" can be linked directly.
4. Explicit data boundary: the start of the timeline is labeled ("history
   since …"), optional completion timestamps from git when available.
5. Tests for `stateAt` on fixtures: event ordering, a task deleted and
   re-created, legacy entries.

## Acceptance criteria

- [ ] `stateAt` is a pure function with tests outside the browser.
- [ ] Replay performs no writes and works in `file://` mode.
- [ ] A moment before history begins is marked as no data, not as an empty
      board.
- [ ] Changes made by `agent:` are visually distinguishable from human ones.

## Log

Append-only. Format: `YYYY-MM-DD status — who — note`.

- 2026-08-31 pending — agent:claude — task created from a review of agentic
  differentiators; a pure derivative of history/, zero new data.
