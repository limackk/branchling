---
id: TL-115
title: "Decision panel in the viewer: what is waiting on a human"
type: task
labels: []
board: main
epic: "Agentic differentiators"
priority: P1
status: done
owner: agent:session
estimate: 1d
created: 2026-09-01
updated: 2026-09-02
blocked_by: [TL-113, TL-114]
blocks: []
related_docs:
  - docs/backlog-human-agent-decisions.md
verification:
  - bash: "node --test scripts/tests/decision-panel.test.mjs"
---

## Goal

The viewer gets a "waiting on you" panel: one place where a human sees
everything that hangs on a human decision, and can make it — which unblocks
further agent work. The panel is a pure view computed from existing data
(Law 2), and the action in the panel writes only through existing write
paths, so attribution and history come for free.

## Context

Grew out of the human/agent analysis (2026-09-01); decisions in
[docs/backlog-human-agent-decisions.md](../../docs/backlog-human-agent-decisions.md) §4.

The panel consists of three queries, none of which requires new data:

1. **Tasks waiting on a human** — open, unblocked (all `blocked_by` closed),
   with `executor: human` (TL-113); alongside them, tasks with a role that
   has no entry in the agent map (the same signal the `run` report from
   TL-98 shows in the CLI).
2. **Open questions** — `openQuestions` from TL-114: the question, who asked,
   how long it has been pending.
3. **What the decision unblocks** — transitive `blocks` per item; "unblocks N
   tasks" is the panel's priority unit and its default sort.

Decisions:
- **The panel computes from live `tasks/*.md` and history, never from
  generated views** (rule from TL-108 — views are a snapshot of the last
  build).
- **The "make a decision" action = `__decision__` (TL-114) plus an optional
  field change** (status out of `blocked`, handoff back to the executor
  role) — through the same endpoints as field editing; no second write path
  (lesson from §5 of docs/backlog-field-editing-history.md).
- **The "on ME" filter works on the actor declaration** (a viewer toggle, by
  role/owner). Hard identity is a planned step
  (docs/backlog-field-editing-history.md §7 item 2) and does NOT block the
  MVP.
- **`file://` mode: panel visible, actions disabled** — like field editing;
  a single file sent to someone is meant to show what's pending, without
  pretending decisions can be made from it.
- **Panel state (filters) in the URL** — consistent with the existing view
  state mechanism, so "your decision queue" can be linked.

## Pre-flight reading

- [docs/backlog-human-agent-decisions.md](../../docs/backlog-human-agent-decisions.md)
  §4 — the three queries and the semantics of the action.
- `backlog/tasks/TL-113-…` and `backlog/tasks/TL-114-…` — the fields and
  events the panel computes from.
- `scripts/build-viewer.mjs` — how a new view is wired in; the backslash
  trap in the template literal (docs/backlog-field-editing-history.md §8).
- `scripts/serve-backlog.mjs` — the existing write endpoints, to reuse.

## Steps

1. A module that computes the panel items (the three queries plus transitive
   `blocks`), runnable in Node and pasted as source into the viewer (the
   `task-fields.mjs` pattern) — one definition for both tests and the
   browser.
2. Panel view: a list of items with context (question/reason, who, since
   when, what it unblocks), sorted by number unblocked, with a role/owner
   filter.
3. Actions: recording the decision (with `resolves`), status change,
   handoff — through the existing endpoints; optimistic with rollback on
   server refusal (as with field editing).
4. A panel item count visible from the dashboard (an entry point into the
   panel).
5. Tests for the computing module against a fixture: an unblocked
   `executor: human` task is included, a blocked one is not; an open
   question is included, a resolved one disappears; the unblock count is
   computed transitively (positive controls).

## Acceptance criteria

- [ ] The panel shows all three classes of item and nothing more
      (tests of the computing module, with positive controls).
- [ ] Making a decision in the panel records a `__decision__` with an actor
      and closes the question (`openQuestions` stops returning it).
- [ ] The panel computes from live files — a task's status change is visible
      without rebuilding the views.
- [ ] In `file://` mode the panel is visible, actions are inactive.
- [ ] The panel's filter state is in the URL.

## Log

Append-only. Format: `YYYY-MM-DD status — who — note`.

- 2026-09-01 blocked — agent:claude — task created from the human/agent
  analysis; waiting on the executor field (TL-113) and the decision event
  (TL-114).
