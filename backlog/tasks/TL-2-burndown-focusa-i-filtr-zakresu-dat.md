---
id: TL-2
title: "Focus burndown and date-range filter on the backlog dashboard"
type: code
labels: [pre-launch]
epic: ""
board: main
priority: P2
status: done
owner: claude
estimate: 3h
confidence: high
created: 2026-08-26
updated: 2026-08-26
blocked_by: []
blocks: []
related_docs: []
verification:
  - bash: "node backlog/scripts/build-viewer.mjs"
  - manual: "Dashboard → \"Date range\" bar: presets 30/60/90/whole history + custom dates; charts, pace, balance, and lead time follow the range, while open/epics/distributions do not"
  - manual: "\"Focus burndown\" card — solid line (remaining) and dashed line (focus scope), pace text, note about the focus flag"
---

## Goal

The dashboard (TL-1) showed the state of the whole history and could not
answer "how is the current focus going" or "what happened in the last 30
days". Two missing pieces: a burndown of the focus set and a date-range
filter.

## Context

Both hit the same limitation of the source — **frontmatter has no history**,
only the current state plus `created`/`updated`:

- **Focus burndown** had to be built on `focus: true` as TODAY's flag. Nothing
  records when a task entered the focus or when it left, so the chart
  reconstructs the past of today's set: a task added yesterday is drawn as if
  it had been in the focus since its creation date, and a task removed from
  the focus does not exist on the chart at all. That is why, besides the
  "remaining" line, there is a second, dashed one — "how many tasks of this
  set existed at that point". Without it, a rising line would look like a
  regression, when it is really the scope growing. The alternative (reading
  history from git) is out: the viewer is a page with no access to the repo,
  and server-mode would have to run `git log` over 1266 files on every render.
- **The date range governs flow, not state.** If it also filtered "open",
  epics, and distributions, the same screen would mean "the state of the
  backlog" one moment and "the state of what was created in July" the next —
  with nothing on screen to tell them apart. The bar states this split
  explicitly.

## Steps

1. `computeDashboard(tasks, range)` — range clamping, flow metrics within the
   range, `focusSeries`.
2. `dashFocusChart()` + the burndown card.
3. Range bar: presets, two `date` fields, persistence in `localStorage`.
4. The cumulative and daily charts read `rangeSeries`; shared X-axis labels.
5. `backlog/README.md` §2.2.

## Acceptance criteria

- [x] Presets 30/60/90/whole history + a custom range; the choice survives a reload.
- [x] The range changes: burn-up, day by day, focus burndown, pace, balance,
      the lead-time sample, the forecast. It does not change: open, epics,
      distributions, lists.
- [x] The burndown shows "remaining" and "focus scope" + burn pace.
- [x] A note about `focus` as a point-in-time flag, in the UI and in the README.

## Verification

- `node backlog/scripts/build-viewer.mjs` — build green, 1266 tasks.
- In the browser (dark + light): presets, custom range, persistence after
  reload, and four edge cases without an exception — an inverted range
  (swapped ends), a range outside the data (clamped), a single day, a future
  date.

## Notes

Three things that only surfaced on render:

- The cumulative chart had its axis pinned to zero. On a range starting from
  800 created, the entire selected week compressed into a thin band at the top
  of the chart — meaning the range hid exactly the movement it was chosen to
  show. The axis now starts from `min(cumDone)` within the range.
- An X-axis labeled by month is useless on a 30-day window
  ("2026-07 / 2026-08"). A shared `dashTimeTicks()`: ≤ 70 days → daily labels.
- A range entirely outside the data rendered the label "2026-05-23 →
  2026-02-01" (start clamped upward, end left as-is) over empty charts. Both
  ends are now clamped to the data interval.

## Log

- 2026-08-26: implemented and verified in the browser — claude.
