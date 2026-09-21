---
id: TL-1
title: "Backlog dashboard in the viewer — status, epics, day-by-day pace"
type: task
labels: [pre-launch]
epic: ""
board: main
priority: P2
status: done
owner: claude
estimate: 4h
confidence: high
created: 2026-08-26
updated: 2026-08-26
blocked_by: []
blocks: []
related_docs: []
verification:
  - bash: "node backlog/scripts/build-viewer.mjs"
  - manual: "backlog → \"Dashboard\" tab (or viewer.html#dashboard): KPIs, cumulative chart, day-by-day, epic table, distributions, attention lists, forecast"
  - manual: "Clicking an epic name goes to the task list with the Epic filter set; clicking a task title opens its detail"
---

## Goal

The viewer showed a list of tasks and a bar of aggregate numbers, but did not
answer "how is the backlog doing as a whole", "which epics are stalled", and
"am I closing faster than I'm adding". These answers had to be assembled by
hand from `INDEX.yaml`. The dashboard computes them from the same frontmatter
the list reads.

## Context

Requested by the founder: backlog statistics, epic status, day-by-day
progress. Two things had to be settled before drawing anything:

1. **There is no close date.** The frontmatter schema (README §3) has
   `created` and `updated`, no `closed`. "Day-by-day progress" had to rely on
   `status: done` + `updated`, i.e. the last time the file was touched. This
   is a proxy, not a measurement — the dashboard says so explicitly, on the
   chart card and in the README, instead of faking precision. A consequence
   visible in the data: 645 of 930 closed tasks have `created == updated`, so
   the median lead time comes out to 0 days. Verified against the files, not
   assumed.
2. **The dashboard must not inherit the list's filters.** If it did, the same
   screen would sometimes mean "state of the backlog" and sometimes "state of
   my filter", with no signal which version is on screen. It always computes
   over the full `TASKS`; drill-down goes the other way — clicking an
   epic/status/label SETS the filter and switches to the list.

Rejected alternative: a separate `dashboard.html` file. The viewer already
holds the full set of tasks in memory and has live-mode (SSE + File System
API); a second page would mean a second read and a second definition of the
same numbers.

## Steps

1. `backlog/scripts/build-viewer.mjs` — CSS for the tabs and dashboard cards.
2. `Tasks` / `Dashboard` tabs in the header + `<section id="dashboardView">`.
3. `computeDashboard()` + renderers (SVG with no libraries — the file must
   work offline).
4. Wire into `render()` (so live-mode also refreshes the dashboard) and into
   hash routing.
5. `backlog/README.md` §2.2 — what the dashboard shows and what it does NOT
   know.

## Acceptance criteria

- [x] `Dashboard` tab + deep link `#dashboard`.
- [x] KPIs, cumulative chart, day-by-day chart, epic table, distributions,
      attention lists (stale / blocked / oldest P0-P1), forecast.
- [x] Drill-down: epic, status, priority, type, label → task list filter;
      task title → detail.
- [x] The dashboard survives live-refresh (`render()` redraws it when active).
- [x] The warning that `updated` stands in for the close date is visible in
      the UI and in the README.

## Verification

- `node backlog/scripts/build-viewer.mjs` — build passes, 1265 tasks.
- Verified in the browser (localhost:3020) in dark and light mode: all 13
  cards render, 137 epics in the table, both charts, clicking an epic (57
  cards = that epic's `total`), clicking a task (detail for `BL-061`),
  switching tabs back and forth.

## Notes

Two bugs caught only at render time, not in the code:

- `.bar-track` / `.bar-fill` are `<span>` elements — an inline element ignores
  `width` and `height`, so **every** bar rendered empty. Fixed with
  `display: block`.
- The day-by-day chart initially had a separate scale for each half (38 up,
  75 down). It looked fine and lied: 5 closed tasks drew as tall as 40 new
  ones. One shared scale for both halves, with axis height computed from the
  `maxUp : maxDown` ratio.

## Log

- 2026-08-26: implemented and verified in the browser — claude.
