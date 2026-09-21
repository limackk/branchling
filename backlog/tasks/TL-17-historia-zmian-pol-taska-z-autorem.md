---
id: TL-17
title: Show the change history of a task's fields, with the author
type: task
labels: [pre-launch]
board: main
epic: "Backlog viewer"
priority: P2
status: done
owner: claude
estimate: 4h
confidence: medium
created: 2026-08-29
updated: 2026-08-29
blocked_by: [TL-16]
blocks: []
related_docs:
  - docs/backlog-field-editing-history.md
  - origin#qa/backlog-field-editing-history.yaml
verification:
  - bash: "node --test backlog/scripts/tests/history.test.mjs"
  - manual: "Change a field in the viewer — a marker „founder · today\" appears next to the label, and in the Change history section a row old → new"
---

## Goal

A task file says WHAT the state is, but not WHO set it. `## Log` is manual
and irregular, and `git blame` does not answer "who changed this task's
priority" — a commit covers a dozen files and several fields at once, and an
agent commits as the founder. After this task, every field change gets an
entry with an author, and the field itself shows who last changed it.

## Context

Full analysis (data model, rejected alternatives, trust boundaries, path to
multiple users): [`docs/architecture/backlog-field-editing-history.md`](../../docs/backlog-field-editing-history.md).

The core of the problem is not the write, it is **attribution**: not every
change goes through the viewer. An agent writes the `.md` via Edit/Write, a
human through an editor, `git checkout` rewrites hundreds of files at once.
Hence three paths and one rule — the author is given by whoever knows it,
and everything else is explicitly `unknown`, never guessed.

## Steps

1. `backlog/scripts/history.mjs` — a JSONL file per task
   (`backlog/history/BL-NNNN.jsonl`), a reference snapshot, `recordEdit`
   (known "before/after") and `reconcile` (diff disk vs snapshot).
2. `serve-backlog.mjs` — an entry on every `POST /api/field`; `GET
   /api/history`; reconciliation at startup and 2.5s after a file change
   from outside the viewer (`unknown`).
3. `history-record.mjs` + the `regen-on-task-edit.sh` hook — agent changes
   signed `claude`, before reconciliation gets a chance to see them as
   anonymous.
4. Viewer — an "Editing as" switch, an `author · when` marker on every field,
   a "Change history" section with a timeline and a per-field filter.
5. Tests — `backlog/scripts/tests/history.test.mjs`.

## Acceptance criteria

- [x] A field change in the viewer writes an entry with `actor`, `field`, `from`, `to`, `ts`, `source`.
- [x] A file change by an agent (hook) is signed `claude`, not `unknown`.
- [x] A change from outside both paths lands in the history as `unknown` — it is not lost and does not lie.
- [x] The same change is not counted twice (server vs reconciliation).
- [x] The first run on an existing backlog does NOT produce fabricated entries.
- [x] A corrupted JSONL line does not take the rest of the history down with it.
- [x] History is visible in the task detail view; the field shows who last changed it.

## Verification

```bash
node --test backlog/scripts/tests/history.test.mjs   # 13 tests
```

Manual: `backlog` → change Status → expand "Change history" → a row
`founder · Status: pending → in_progress · viewer`. Then change the same
field via editor/agent — after ~3s a row appears with author `claude` (hook)
or `unknown` (no hook).

## Notes

Deliberately NOT done, reasoning in the doc §6–§7:
- backfilling history from git (a commit's author is always the founder — that would give a nice untruth),
- authenticating the actor (today a claim, not an identity),
- history of the task body (only the frontmatter),
- detecting a parallel-write conflict.

## Log

- 2026-08-29 done — claude — implementation + tests + analysis in docs/architecture/
</content>
