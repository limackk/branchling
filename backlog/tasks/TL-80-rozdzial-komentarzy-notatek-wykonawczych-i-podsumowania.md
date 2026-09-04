---
id: TL-80
title: "Separating comments, implementation notes, and the final summary"
type: code
labels: [post-launch]
board: main
epic: "History and attribution"
priority: P3
status: cancelled
owner: agent:fleet
role: docs
estimate: 4h
confidence: low
created: 2026-08-31
updated: 2026-09-04
blocked_by: []
blocks: []
related_docs:
  - docs/backlog-field-editing-history.md
verification:
  - bash: "node -e \"const rows=require('fs').readFileSync('backlog/history/TL-80.jsonl','utf8').split(String.fromCharCode(10)).filter(Boolean).map(JSON.parse);const d=rows.filter(e=>e.field==='__decision__');if(!d.length){console.error('no __decision__ is recorded for TL-80');process.exit(1)}if(!d.some(e=>/104 of the 108/.test(e.to||''))){console.error('the decision does not carry the measurement it rests on');process.exit(1)}console.log(d[d.length-1].to)\""   # the deliverable of this task is the recorded finding, not a module
---

## Goal

Three different kinds of text in a task get three different places, because
each is read by someone different: discussion (a comment with an author),
execution progress (a note), and a summary for the pull request.

## Context

When this was written, everything landed in `## Log` (append-only, format
`date status — who — note`) plus field history in `history/*.jsonl`. `## Log`
answered the question "what happened to this task", but in doing so mixed
three audiences: the reviewer ("why this way and not another"), the executor
("where did I leave off"), and the PR author ("what do I put in the
description"). Backlog.md splits this into `comments` with an author,
`implementation notes`, and `final summary`.

**That premise is dead.** TL-105 removed `## Log` from `_template.md` and from
what `branchling done` writes, on exactly the reasoning this task's second
condition states below: a second copy of what the history already holds will
drift. No task above TL-117 carries the section — TL-156 is the single
exception — and of the 108 closed tasks that still carry one, 104 hold a
single dated line.

The three audiences did each get a place of their own, and none of them is a
section in the task file. The reviewer's "why" is a `__decision__` event
(`branchling decide`, TL-114); the executor's "where did I leave off" is
`branchling handoff` and the activity log; the PR author's summary is
`branchling pr-summary`. A comment with an author is the `__comment__` event —
36 are on disk, each with its actor in a namespace, written by `handoff`,
`ask` and `decide`.

Note, hence `confidence: low`: this is a change to the task's data MODEL, not
the addition of a command. Before writing anything, decide whether the split
earns its cost on OUR material — review `## Log` in a few dozen closed tasks
and check whether the entries actually fall into these three categories. If
90% of them are one line "done — commit abc", close this task as `cancelled`
with the justification. That is a legitimate way to end this task.

Second condition: whatever gets built has to agree with what history already
records in `history/*.jsonl`. Two independent logs of the same event will
drift apart.

## Pre-flight reading

1. `_template.md` — the `## Log` section and its declared format.
2. `scripts/history-record.mjs` and `scripts/history.mjs` — what we already
   record about changes and with what attribution.
3. `docs/backlog-field-editing-history.md` — attribution decisions; the actor
   namespace is mandatory and that stays.

## Steps

1. Review `## Log` in closed tasks and decide whether the split makes sense.
   If not — close the task as `cancelled`, with this finding recorded as a
   `__decision__` event in `history/TL-80.jsonl`.
2. If yes: define the sections and their semantics in `_template.md`.
3. A callable entry point for each of them (Law 4), with the actor in its
   namespace.
4. Expose them in `query --json` (the envelope from TL-72) and in the detail
   view in the viewer.
5. Decide the relationship with `history/*.jsonl` — one source, not two logs.
6. `scripts/tests/task-sections.test.mjs` — appending preserves earlier
   entries; an actor without a namespace is rejected.

## Acceptance criteria

- [x] The "do it / don't do it" decision is recorded as a `__decision__` event
      in `history/TL-80.jsonl`, along with the data it was based on.
- [ ] If doing it: each section has a callable entry point and namespaced
      attribution.
- [ ] The relationship with `history/*.jsonl` is unambiguous — one source per
      event.
- [ ] Appending never deletes an earlier entry.

## Log

2026-08-31 pending — agent:claude — opened from an analysis of Backlog.md
(github.com/MrLesk/Backlog.md), point 9. Closing as `cancelled` is
deliberately allowed — see `## Context`.
