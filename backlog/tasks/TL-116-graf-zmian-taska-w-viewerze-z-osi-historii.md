---
id: TL-116
title: "Task change graph in the viewer, built from the history axis"
type: task
labels: []
board: main
epic: "Agent-facing distinctives"
priority: P2
status: done
owner: agent:claude
estimate: 1d
created: 2026-09-01
updated: 2026-09-02
blocked_by: [TL-114]
blocks: []
related_docs:
  - docs/backlog-human-agent-decisions.md
  - docs/backlog-field-editing-history.md
verification:
  - bash: "node --test scripts/tests/task-graph.test.mjs"
---

## Goal

The task detail view in the viewer gets a change graph: a timeline with nodes
— creation, status transitions, handoffs (`role`/`owner` changes with a
reason), questions and decisions — colored to distinguish an `agent:` actor
from a human. The user opens a task and sees, at a glance, where the task
went, who handed it off, who asked what, and who decided.

The graph is a pure derivative of `history/TL-NNNN.jsonl` (Law 2): no new
data, no new writes. It also works in `file://` mode (history is embedded in
the build), so the graph can be sent to someone as a single file.

## Context

Came out of the human/agent analysis (2026-09-01); decisions in
[docs/backlog-human-agent-decisions.md](../../docs/backlog-human-agent-decisions.md) §5.

The task detail view already has a history axis as a LIST
(docs/backlog-field-editing-history.md §5). The graph is a second rendering of
the same events, not a new mechanism — the list stays (it is denser
information-wise), the graph is a flow view.

Decisions:
- **Shared engine with TL-91** — the per-task history fold (`stateAt`) planned
  for the board time-lapse is the same fold; if TL-91 lands first, reuse its
  module, if this one does, expose the fold so TL-91 can reuse it. Two folds
  would drift apart in their definitions.
- **Human/agent color from the actor's namespace** — the same convention as
  TL-91; `unknown`/`legacy` entries get their own, explicit "unknown" color,
  not a stand-in for human.
- **A node is a significant event, not every entry** — `status` transitions,
  `role`/`owner` changes, `__created__`/`__deleted__`, `__comment__`,
  `__decision__`. Other field changes (priority, estimate…) are collapsed into
  dots between nodes, expandable — otherwise the graph of a task with a long
  history is unreadable.
- **A question→decision pair is connected by an edge** (`resolves` from
  TL-114); an open question is visually marked as open.
- **Data boundaries are shown, not hidden** — history starts on 2026-08-30
  (rule from TL-91): the start of the axis is labeled "history since …", not
  pretending to be the task's full life story.

## Pre-flight reading

- [docs/backlog-human-agent-decisions.md](../../docs/backlog-human-agent-decisions.md)
  §5 — node scope and relation to TL-91.
- [docs/backlog-field-editing-history.md](../../docs/backlog-field-editing-history.md)
  §2 and §5 — entry format, dedup, existing axis rendering.
- `backlog/tasks/TL-91-time-lapse-boardu-odtwarzany-z-logu-zdarzen.md`
  — shared fold and color convention.
- `scripts/build-viewer.mjs` — how history reaches the build; the backslash
  trap in the template literal.

## Steps

1. Fold task events into a sequence of graph nodes (classify
   significant/collapsed, pair up `resolves`) as a pure function — runnable in
   Node, pasted as source into the viewer.
2. Render the graph in the task detail view (SVG, scrollable horizontally
   inside its container, not stretching the page); color by actor namespace;
   clicking a node narrows the history list to that event (existing per-field
   filter mechanism).
3. Fold tests on a fixture: ordering, a task deleted and re-created, a
   question→decision pair, an open question, `legacy` entries (positive
   controls for each node kind).

## Acceptance criteria

- [ ] The fold is a pure function with tests outside the browser.
- [ ] The graph performs no writes and works in `file://` mode.
- [ ] `agent:` changes are visually distinguishable from human ones, and
      `unknown` from both.
- [ ] An open question and a question→decision pair are distinguishable on the
      graph.
- [ ] The start of the history is explicitly labeled, not appearing as the
      task's start.

## Log

Append-only. Format: `YYYY-MM-DD status — who — note`.

- 2026-09-01 blocked — agent:claude — task created from the human/agent
  analysis; waiting on the decision event (TL-114). Shares the fold with
  TL-91.
