---
id: TL-55
title: "Viewer export to a single file for sending"
type: task
labels: [post-launch]
board: main
epic: "Backlog viewer"
priority: P3
status: cancelled
owner: unassigned
executor: ""
estimate: 4h
confidence: low
created: 2026-08-31
updated: 2026-09-08
blocked_by: []
blocks: []
related_docs:
  - .claude/skills/branchling-viewer/SKILL.md
verification:
  - bash: "d=$(mktemp -d) && node scripts/cli.mjs export --out \"$d/backlog.html\" >/dev/null && test -s \"$d/backlog.html\" && echo 'export is produced — OK'"
  - bash: "d=$(mktemp -d) && node scripts/cli.mjs export --out \"$d/backlog.html\" >/dev/null && grep -q 'localhost\\|127.0.0.1\\|EventSource' \"$d/backlog.html\" && { echo 'export references a server'; exit 1; }; echo 'export is self-contained — OK'"
  - manual: "File sent to someone with no terminal: opens with a double-click, filtering and search work, editing is clearly unavailable."
---

## Goal

Give a non-technical recipient the backlog **without a terminal**: a single
file that can be sent, opened with a double-click, and filtered.

## Context

The viewer is already self-contained — `build-viewer.mjs` embeds all data in
a single HTML file, fetching nothing at runtime, so it works over `file://`.
What is missing is **a way to get it to someone without a terminal**:
`backlog/viewer.html` is gitignored (rightly so — it is an aggregate of every
task, so versioning it would conflict on disjoint changes), and the only
entry point is `worktrail serve`, which is a shell command.

The consequence is that an analyst or a manager has to ask someone to start
the server. That is exactly the role the browser view was built for in the
first place.

**What needs to be settled before this can be built — hence `confidence:
low`:**

1. **Whether the export is read-only.** The viewer can edit fields and writes
   history with an actor. A file sent by email has nowhere to write to;
   buttons that do nothing are worse than not having them. The export is
   probably a read-only mode, visibly marked as such, and that is a product
   decision, not a technical one.
2. **A timestamp.** The file is a snapshot of a state at a specific moment,
   and after a week it lies. The build date must be visible in the document
   itself, not in the filename, because the filename will not survive being
   forwarded.
3. **What ends up in it.** Sending the whole backlog is sometimes unwanted.
   The export should accept the same filters as `query`, so a slice can be
   sent instead of everything.

An alternative worth considering instead of a manual export: publishing to
GitHub Pages via CI. It does not rule out this task — both paths use the same
generator — but it has a different price (the backlog becomes public), and so
it is a separate decision, not a step here.

## Pre-flight reading

1. `scripts/build-viewer.mjs` — `buildHtml()`; the page is already
   self-contained.
2. `scripts/serve-backlog.mjs` — what the server adds (SSE, writes) and what
   must disappear in the export.
3. `.claude/skills/branchling-viewer/SKILL.md` — one renderer; the export must
   not be a second copy of the template.
4. `scripts/query.mjs` — the filter contract to reuse.

## Steps

1. `worktrail export --out <file>` on the same generator as `viewer` and
   `serve`. Not a second rendering path.
2. Read-only mode: no field editors, no SSE, no references to `127.0.0.1`.
   Visible notice that this is a snapshot.
3. Build date and time in the document header.
4. `query` filters as an optional narrowing of the export.
5. Test: the export is produced, contains no server references, contains the
   build date.
6. README: one sentence on how to send the backlog to someone who does not
   open a terminal.

## Acceptance criteria

- [ ] `worktrail export --out <file>` produces a single self-contained HTML
      file.
- [ ] The file does not reference a server or show inactive editors.
- [ ] The build date is visible in the document.
- [ ] The export accepts `query` filters.
- [ ] The same generator as `viewer` and `serve`.

## Log

Append-only. Format: `YYYY-MM-DD status — who — note`.

- 2026-08-31 created — agent:claude — from the audit of the path for
  non-technical roles
