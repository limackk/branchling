---
id: TL-7
title: "Sorting all dashboard lists and tables through one mechanism"
type: code
labels: [pre-launch]
epic: ""
board: main
priority: P2
status: done
owner: claude
estimate: 2h
confidence: high
created: 2026-08-26
updated: 2026-08-26
blocked_by: []
blocks: []
related_docs: []
verification:
  - bash: "node backlog/scripts/build-viewer.mjs"
  - manual: "Dashboard → 13 sort controls: tables (epics, age) via headers, lists and bars via the „sort:" bar; the „order" option reverts to the natural order"
  - manual: "Attention lists: after changing the sort, a different 12 items are visible, and the note says „Showing 12 of N""
---

## Goal

Only the epics table had sorting (TL-6). The founder asked for the same in
the remaining views.

## Context

Key decision: **one mechanism, not eight**. Instead of copying the epics
logic into every card, a column declares a label, a value accessor, and the
direction it opens in, and `dashSortItems` / `dashTableHead` / `dashSortBar`
handle all thirteen lists. Epics sorting was switched over to this same
mechanism — otherwise there would be a second definition of what "sort by
Blocked" means.

A column without `get` is the card's **natural order**: lifecycle for
statuses, P0→P3 for priorities, ascending buckets for age and lead time,
declared order for hours. Without this option there would be no way back to
the layout in which a card makes sense — sorting "by value" destroys the axis
these cards carry.

Along the way, a silent defect got fixed: attention lists were truncated to
12 items **before** sorting and said nothing about it. After sorting was
added this would have become a lie — the toggle would rearrange twelve rows
chosen by a different key. Now sorting happens first, truncation second, and
the note says "Showing 12 of 41".

The epics table got a **Open** column. The default sort was always "by open
descending", but the column did not exist, so after changing the sort there
was no way back to that layout.

## Acceptance criteria

- [x] Sorting in: epics, age of open items, 7 bar cards, 3 attention lists,
      day panel, hygiene.
- [x] One implementation; epics switched over to it.
- [x] The "order" option returns to the card's natural order.
- [x] Attention lists sort before truncating and declare how many items were
      left out.

## Verification

- In the browser: 13 registered controls; statuses natural → value → name →
  back to natural; age by P0 (16/7/4/2) and back to buckets; hygiene by
  priority; day panel by status (done, done, in_progress, pending);
  "in progress without movement" list by ID with the note "Showing 12 of 41".

## Log

- 2026-08-26: implemented and verified in the browser — claude.
