---
id: TL-3
title: "Interactive dashboard charts — a tooltip with data under the cursor"
type: task
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
  - manual: "Dashboard → hover over the cumulative, daily and focus burndown charts: crosshair/bar highlight + a tooltip with the date, all series and the context row"
  - manual: "Moving the cursor between charts turns off the crosshair on the previous one; scrolling hides the tooltip"
---

## Goal

The three dashboard charts (TL-1, TL-2) showed the shape but not the numbers.
Reading "exactly how many were open on August 13" required squinting or
opening `INDEX.yaml`. A hover with concrete values completes the chart: shape
at a glance, number on demand.

## Context

The charts are drawn as static SVG in the generator — pixel positions are
produced while the string is built. The tooltip could either compute them a
second time in the browser (scale, padding, min/max) or receive them
ready-made. **It receives them ready-made**: every `<svg>` carries `data-chart`
with the already-computed `x`/`y` and source values. A second computation of
the same scale is a second chance to drift from the first — and the drift
would not show up as an error, only as a tooltip confidently naming a point
the line does not pass through.

The native `<title>` on the bars (the only hover there was) was removed: it
showed one series at a time, after a one-second delay, with no date on the
line chart and no way to show the day's balance.

## Steps

1. `dashHoverLayer()` — crosshair, bar highlight and series dots as a hidden
   layer plus a transparent capture rectangle.
2. `data-chart` payload in the three drawing functions.
3. `dashHoverMove()` / `dashHoverHide()` + one listener on the container.
4. `.chart-tip` outside `#dashboardView` (the container is redrawn in full).
5. `backlog/README.md` §2.2.

## Acceptance criteria

- [x] Hovering over each of the three charts shows the date, all series and a
      context row (day's movement / balance / closed as of this day).
- [x] Line chart: crosshair + dots on the series. Bar chart: day highlight.
- [x] The tooltip does not go past the window edge (it flips to the other
      side of the cursor).
- [x] Moving the cursor away and scrolling hide the tooltip; switching to
      another chart turns off the crosshair on the previous one.

## Verification

- `node backlog/scripts/build-viewer.mjs` — green build.
- In the browser (dark + light), with a real cursor, not a synthetic event:
  all three charts, switching between them, tooltip positioning.

## Notes

A tooling trap, not a product one: the preview panel in this session reported
`window.innerWidth === 0`, so synthetic `PointerEvent`s from JS hit
`getBoundingClientRect().width === 0` and silently did nothing. Hover
verification must go through a real cursor (`computer hover`), otherwise
"doesn't work" and "can't be measured" look identical.

## Log

- 2026-08-26: implemented and verified in the browser — claude.
