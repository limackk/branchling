---
id: TL-4
title: "Click on a chart point — panel with that day's tasks"
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
related_docs:
  - backlog/README.md
verification:
  - bash: "node backlog/scripts/build-viewer.mjs"
  - manual: "Dashboard → click on a point of each of the three charts: a panel below the chart with tasks created and closed that day; clicking a title opens the task"
  - manual: "Clicking the same point again closes the panel; ✕ closes it; a pinned day outside the date range disappears and comes back once the range widens"
---

## Goal

The charts (TL-1, TL-2) and tooltips (TL-3) said HOW MANY. They did not say
WHICH ONES. "2026-08-09: 41 new" is a signal, but without a list of tasks
there is nothing to do with it short of manually grepping by `created:`.

## Context

The panel counts the day's tasks from the same two definitions the charts are
drawn from: the creation day is `created`, and "closed that day" is
`status: done` + `updated` matching that date. This is not cosmetic — if the
panel had its own definition of "closed", the list under the bar would show a
different number than the bar itself, and the user would have no way to
decide which one is true. For the same reason, click and hover both go
through the shared `dashChartPointAt()`: two independent index computations
could open a different day than the one the tooltip under the cursor names.

The panel is anchored under the SPECIFIC chart that was clicked (`source` in
the payload), not in one fixed place — this way it does not lose context and,
on the burndown, can narrow the list to the focus exactly the way the chart
does.

Rejected: filtering the task list by date. It would require a new facet in
`FILTER_SPECS` (a date is not an enum, so also a new control type), and the
answer would be worse anyway — one list instead of the split into "created"
and "closed", which are two different series on the chart.

## Steps

1. `dashChartPointAt()` — shared point computation for hover and click.
2. `source` in each chart's payload.
3. `dashDayPanel()` / `dashDayPanelFor()` + `state.dashDay`.
4. Click and ✕ in the delegated handler, toggle on repeated click.
5. Panel CSS, `backlog/README.md` §2.2.

## Acceptance criteria

- [x] Clicking a point on each of the three charts opens a panel with that
      day's task list.
- [x] Split into created / closed, with status and priority.
- [x] Clicking a title opens the task in the list view.
- [x] Toggling the same point and ✕ close the panel.
- [x] The burndown panel shows only the focus; a panel outside the date range
      disappears.

## Verification

- `node backlog/scripts/build-viewer.mjs` — build green.
- In the browser with a real cursor: click on a daily chart point
  (2026-08-13 → 4 created / 4 closed) matches the tooltip's count for the
  same day (+4 new, 4 closed) — a consistency check between panel and chart.
  Clicking BL-1030 opened the task with `created`/`updated` 2026-08-13.
  Toggle, ✕, the focus panel, and behavior on range changes checked
  separately; dark + light.

## Log

- 2026-08-26: implemented and verified in the browser — claude.
