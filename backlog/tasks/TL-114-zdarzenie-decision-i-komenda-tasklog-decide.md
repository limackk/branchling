---
id: TL-114
title: "The __decision__ event and the worktrail decide command"
type: task
labels: []
board: main
epic: "Agentic hallmarks"
priority: P1
status: done
owner: agent:session
estimate: 4h
created: 2026-09-01
updated: 2026-09-02
blocked_by: [TL-99]
blocks: [TL-115, TL-116]
related_docs:
  - docs/backlog-human-agent-decisions.md
  - docs/backlog-field-editing-history.md
verification:
  - bash: "node --test scripts/tests/decide.test.mjs scripts/tests/history.test.mjs"
---

## Goal

A decision becomes a first-class event in a task's history: a pseudo-field
`__decision__` (alongside `__created__`, `__deleted__`, `__body__`,
`__comment__`) carrying the decision's content, actor, a ULID, and an optional
`resolves` pointing at the ULID of a question event. The entry point is the
command `worktrail decide TL-NNNN --reason "…" [--resolves <ULID>] --actor
<a>` and — through the same write path — an action in the viewer.

After this task there is a machine-checkable definition of an "open question":
a question event (a comment from the TL-99 handoff) that no `__decision__`
points at. This is the entire state the decision panel (TL-115) and the task
graph (TL-116) need — computable from history, zero new state files (Law 2).

## Context

Arose from the human/agent analysis (2026-09-01); decisions in
[docs/backlog-human-agent-decisions.md](../../docs/backlog-human-agent-decisions.md) §3.

The handoff (TL-99) records a QUESTION as a `__comment__`. A comment and a
decision are, however, different things: the panel has to count "questions
without a decision", and the graph draws decisions as nodes. Hence a separate
event type, not a flag on a comment.

Decisions:
- **An agent's decision and a human's decision look identical** — only the
  actor namespace differs. Auditing "which decisions did the agent make" is
  one filter on `actor`, with no separate schema.
- **`--reason` is mandatory** — a decision without content is, to a reader,
  history without information; the same class as a handoff without a reason
  (TL-99).
- **`resolves` is optional** — a decision can exist without a prior question
  (someone decides on their own initiative); a question without a decision is
  "open". Pointing at a ULID that does not exist in the task's history fails
  before the write.
- **Deduped by `id` like ordinary events** — two identical decisions at
  different times are two events; the `__created__` dedup rule does NOT apply
  (analogous to `__comment__`, see the TL-99 steps).
- **A line in the task file's `## Log`** — a decision is also narrative; the
  history entry is machine-written, the log line is human-readable. Both from
  one invocation.
- **The panel's UI is OUT OF SCOPE** (TL-115); here only the event, the
  command, and rendering a decision row in the viewer's existing history
  timeline.

## Pre-flight reading

- [docs/backlog-human-agent-decisions.md](../../docs/backlog-human-agent-decisions.md)
  §3 — the event's format and the definition of an open question.
- [docs/backlog-field-editing-history.md](../../docs/backlog-field-editing-history.md)
  §2 — pseudo-fields, ULID, dedup rules.
- `backlog/tasks/TL-99-tasklog-handoff-przekazanie-taska-z-powodem-i-sladem.md`
  — the `__comment__` implementation this task extends with a
  question→decision pair.
- `scripts/task-fields.mjs` (`PSEUDO_FIELDS`), `scripts/history.mjs` — event
  read/write.

## Steps

1. `__decision__` in `PSEUDO_FIELDS`; written via `history.mjs` with fields
   `to` (content), `resolves` (optional), actor, ULID; validation of
   `resolves` against the task's existing entries.
2. Function `openQuestions(taskId)` in the history module: question events
   that no `__decision__` points at — one definition shared by the CLI, the
   panel, and the graph.
3. The `decide` command in `scripts/cli.mjs`: validation, event write, a
   `## Log` line, `build`; exit codes and messages as in `handoff`.
4. Render a decision row in the viewer's history timeline (a new row kind,
   with a visible link to the question when `resolves` is set).
5. Tests: event write/read/dedup, `resolves` pointing at a nonexistent ULID
   fails, `openQuestions` on a fixture with a resolved question→decision pair
   and an open question (positive control: an open question is detected).

## Acceptance criteria

- [ ] `worktrail decide` without `--reason` exits with code 2 and writes
      nothing.
- [ ] After `decide --resolves <id>` the question disappears from
      `openQuestions`; a question without a decision remains visible in it
      (positive control).
- [ ] `--resolves` with a ULID outside the task's history fails before the
      write.
- [ ] The decision row is visible in the viewer's history timeline.
- [ ] A line with the decision and the actor appears in the task's `## Log`.
- [ ] The entire new surface is in English; `worktrail check --language` is
      green.

## Log

Append-only. Format: `YYYY-MM-DD status — who — note`.

- 2026-09-01 blocked — agent:claude — task created from the human/agent
  analysis; waiting on the `__comment__` implementation from TL-99. Decisions
  in docs/backlog-human-agent-decisions.md.
