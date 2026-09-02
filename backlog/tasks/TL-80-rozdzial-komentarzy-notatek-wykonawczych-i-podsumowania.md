---
id: TL-80
title: "Separating comments, implementation notes, and the final summary"
type: code
labels: [post-launch]
board: main
epic: "History and attribution"
priority: P3
status: pending
owner: unassigned
estimate: 4h
confidence: low
created: 2026-08-31
updated: 2026-08-31
blocked_by: []
blocks: []
related_docs:
  - docs/backlog-field-editing-history.md
verification:
  - bash: "node --test scripts/tests/task-sections.test.mjs"
---

## Goal

Three different kinds of text in a task get three different places, because
each is read by someone different: discussion (a comment with an author),
execution progress (a note), and a summary for the pull request.

## Context

Today everything lands in `## Log` (append-only, format `date status — who —
note`) plus field history in `history/*.jsonl`. `## Log` answers the question
"what happened to this task", but in doing so mixes three audiences: the
reviewer ("why this way and not another"), the executor ("where did I leave
off"), and the PR author ("what do I put in the description"). Backlog.md
splits this into `comments` with an author, `implementation notes`, and
`final summary`.

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
   If not — close the task as `cancelled` with this finding in the log.
2. If yes: define the sections and their semantics in `_template.md`.
3. A callable entry point for each of them (Law 4), with the actor in its
   namespace.
4. Expose them in `query --json` (the envelope from TL-72) and in the detail
   view in the viewer.
5. Decide the relationship with `history/*.jsonl` — one source, not two logs.
6. `scripts/tests/task-sections.test.mjs` — appending preserves earlier
   entries; an actor without a namespace is rejected.

## Acceptance criteria

- [ ] The "do it / don't do it" decision is recorded in this task's log along
      with the data it was based on.
- [ ] If doing it: each section has a callable entry point and namespaced
      attribution.
- [ ] The relationship with `history/*.jsonl` is unambiguous — one source per
      event.
- [ ] Appending never deletes an earlier entry.

## Log

2026-08-31 pending — agent:claude — opened from an analysis of Backlog.md
(github.com/MrLesk/Backlog.md), point 9. Closing as `cancelled` is
deliberately allowed — see `## Context`.
