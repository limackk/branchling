---
id: TL-16
title: Edit every task field with a click in the viewer
type: code
labels: [pre-launch]
board: main
epic: "Backlog viewer"
priority: P2
status: done
owner: claude
estimate: 4h
confidence: high
created: 2026-08-29
updated: 2026-08-29
blocked_by: []
blocks: [TL-17]
related_docs:
  - docs/backlog-field-editing-history.md
verification:
  - bash: "node --test backlog/scripts/tests/task-fields.test.mjs"
  - manual: "In the viewer (backlog) click Owner in the task detail, type a value, Tab — field saved to .md, INDEX.yaml regenerated"
---

## Goal

The viewer could change exactly one field — `status`. Every other change
(priority, owner, estimate, labels, epic, board, blocked_by, related_docs,
title) required opening the `.md` file in an editor, i.e. leaving the tool in
which the task was just being looked at. After this task every frontmatter
field is editable with a click.

## Context

- Writing went through two paths: `fetch("api/status")` in server mode and the
  File System Access API in `file://` mode. Two implementations of one
  decision ("what to set on a status change") — a classic drift waiting for
  the first rule change.
- The status dictionary existed in three places: `serve-backlog.mjs`,
  `build-viewer.mjs`, README.
- Founder's decision (2026-08-29): editing **only through the local server**.
  In `file://` mode fields are read-only. Reason in
  [`docs/architecture/backlog-field-editing-history.md`](../../docs/backlog-field-editing-history.md) §5.

## Steps

1. `backlog/scripts/task-fields.mjs` — field schema (`EDITABLE_FIELDS`),
   dictionaries, validation (`normalizeValue`), frontmatter write
   (`setFrontmatterField`), diff (`diffMeta`). No imports: the source is
   pasted into the viewer, like `viewer-url.mjs` since TL-15.
2. `serve-backlog.mjs`: `POST /api/field` as the only write path; `POST
   /api/status` as its alias; `GET /api/fields`.
3. `build-viewer.mjs`: removal of the duplicated frontmatter parser on both
   sides, row rendering from `EDITABLE_FIELDS`, per-type editors (select /
   input+datalist / checkboxes / textarea), Esc = cancel, optimistic write
   with rollback.
4. Write-contract tests — `backlog/scripts/tests/task-fields.test.mjs`.

## Acceptance criteria

- [x] Every field from `EDITABLE_FIELDS` can be changed with a click in the
      task detail.
- [x] A value outside the dictionary is rejected with the same code on the
      server side and the UI side.
- [x] Writing a list field does not erase a neighboring frontmatter key
      (`verification:`).
- [x] A title with a colon is written quoted and comes back unquoted.
- [x] NOW/INDEX/archive are regenerated after a write.
- [x] `updated:` is set to today on every edit.
- [x] `file://` mode does not pretend it can save — read-only fields + a hint.

## Verification

```bash
node --test backlog/scripts/tests/task-fields.test.mjs   # 26 tests
```

Manually: `backlog` → select a task → click Owner → type `founder` → Tab. In
the server terminal, log `BL-NNN · owner → founder (founder) [views
regenerated]`.

## Log

- 2026-08-29 done — claude — implementation + tests; editing only through the server (founder's decision)
