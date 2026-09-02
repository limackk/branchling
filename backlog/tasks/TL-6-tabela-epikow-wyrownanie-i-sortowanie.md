---
id: TL-6
title: "Epics table: header alignment, sorting, themed scrollbars"
type: code
labels: [pre-launch]
epic: ""
board: main
priority: P2
status: done
owner: claude
estimate: 1h
confidence: high
created: 2026-08-26
updated: 2026-08-26
blocked_by: []
blocks: []
related_docs:
  - backlog/README.md
verification:
  - bash: "node backlog/scripts/build-viewer.mjs"
  - manual: "Dashboard → Epics table: numbers sit under their headers; clicking a header sorts, clicking again reverses it; \"(no epic)\" stays at the bottom"
  - manual: "Scrollbars (epics table, day panel, hygiene lists, whole page) in theme colors, not the light system bar"
---

## Goal

Reported by the founder from a screenshot: in the epics table numbers did not
line up under their headers, the scrollbar clashed with the page, and the
table could not be sorted.

## Context

The misalignment was not a data error or a column-width issue: `th` had the
default `text-align: left`, and `td.num` had `right`. On a wide column, every
header hung over the cell's left edge, so the value read as belonging to the
next column. This was most visible on P0/P1, where a red "1" looked like it
sat under P1. The fix is one rule, `.dash-table th.num { text-align: right }`
— and the same rule straightens the task-age table, which had the same
defect.

Sorting: columns are declared in `EPIC_COLUMNS` together with a value
accessor, so the header, the sort, and the cell can never disagree about what
"Blocked" means. The starting direction depends on the column (numbers
descending, name A→Z), and ties are broken by name — without this, two epics
with the same count would swap places between renders for no visible reason.
The "(no epic)" row is appended after sorting and stays at the bottom, because
it is not an epic, only the remainder.

Scrollbars: `scrollbar-width: thin` + `scrollbar-color` from theme tokens, and
`::-webkit-scrollbar` equivalents. The default bar ignores the theme and in
dark mode was the brightest element on the page.

## Acceptance criteria

- [x] Numeric column headers aligned right, like their values.
- [x] Clicking a header sorts, clicking again reverses direction, the active
      column shows ▲/▼.
- [x] "(no epic)" is always at the bottom.
- [x] Scrollbars are themed in both modes.

## Verification

- In the browser (dark + light): sorting by P0 (descending 4,4,3,2…), toggle
  to ascending, alphabetical sorting both directions, sorting by last-moved
  date, "(no epic)" at the bottom in each of these arrangements.

## Log

- 2026-08-26: implemented and verified in the browser — claude.
