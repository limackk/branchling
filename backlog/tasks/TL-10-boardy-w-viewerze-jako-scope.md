---
id: TL-10
title: "Boards in the viewer as scope — lists, filters, and the dashboard in one scope"
type: code
labels: [post-launch]
board: main
epic: ""
priority: P2
status: done
owner: claude
estimate: 4h
confidence: high
created: 2026-08-29
updated: 2026-08-29
blocked_by: []
blocks: []
related_docs:
  - backlog/boards.yaml
verification:
  - bash: "node --test backlog/scripts/tests/boards.test.mjs"
  - bash: "node backlog/scripts/build-viewer.mjs"
  - manual: "Open the viewer → switch the board in the header → lists, counters, and the dashboard show ONLY that board; #BL-NNN from another board switches the scope instead of showing emptiness"
---

## Goal

Boards exist in the data (TL-9), but the viewer does not know about
them — and that is the surface the founder actually works on. Board should
act there as **scope**, not as another dropdown next to Epic.

## Context

The difference is measurable, not aesthetic. A filter narrows the card list,
but `computeDashboard()` computes from `TASKS`; if board were a filter, the
dashboard would still show pace, queue, and burndown mixed from both boards,
labeled with a header suggesting one. Scope narrows the source, so every
number in the UI talks about the same set.

Implementation: `ALL_TASKS` (the full set) + `TASKS` (the in-scope view) and
one `applyScope()` function. Every place reading `TASKS` — filters, cards,
statistics, dashboard — narrows without any knowledge of boards of its own.

Adjacent states to cover:

- `#BL-NNN` from another board (a link from chat, a bookmark) — has to switch the scope, not show emptiness;
- live mode (File System Access) has its OWN frontmatter parser on the client — without `board`, refreshing from disk would zero out assignments;
- a task with a board outside the registry injected at build time (added after the build) — the selector appends such a board instead of swallowing it.

## Acceptance criteria

- [x] A board selector in the header; the choice persists across reload (localStorage) and can be passed along in the URL.
- [x] Lists, counters, and the dashboard respect the scope.
- [x] `#BL-NNN` from outside the scope switches the scope to that task's board.
- [x] The client-side live-mode parser reads `board`.
- [x] Module tests green.

## Verification

```bash
node --test backlog/scripts/tests/boards.test.mjs
node backlog/scripts/build-viewer.mjs
```

## Log

- 2026-08-29 in_progress — claude — start; scope instead of a filter, reasoning in ## Context
- 2026-08-29 done — claude — scope in the header + dashboard; checked live in the browser on the running viewer (switching scope, recalculated counters, `#TL-1` from another board switches the scope). Along the way: the client-side live-mode parser was also dropping `focus` — added, same class of issue (two parsers of one schema)
