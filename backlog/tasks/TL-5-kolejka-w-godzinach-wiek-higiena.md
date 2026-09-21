---
id: TL-5
title: "Dashboard: queue in hours, burndown per scope, age and hygiene"
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
  - manual: "Dashboard → the \"Queue in hours\" card (sum of estimate, manual vs code, comparison to the window), \"Age of open tasks\" (histogram × priority), \"Backlog hygiene\" (expandable rows)"
  - manual: "Burndown → scope switch focus / pre-launch / post-launch / epic; the choice survives a reload"
---

## Goal

The dashboard counted items. "328 open" does not say how much work that is,
how much of it is yours, how long the queue carries it, or where the
backlog contradicts itself. Three cards and one switch answer these four
questions.

## Context

Scope chosen by the founder from a list of proposals (rejected this round:
a daily state snapshot and a full blockers card).

Measured before implementation, so as not to build a card on data that does
not exist: `estimate` covers **100% of open tasks** (0 missing), so does
`confidence`, so the sum of hours is computable and the estimate's risk is
displayable. Measured at the time: 2511 h of open queue, 1280 h pre-launch,
496 h focus, 195 of 328 `unassigned`, 136 tasks older than 30 days.

Three decisions that shaped the cards:

1. **Hours are NOT divided into h/day.** The first version computed pace as
   `hours closed / days in scope` and got **60.4 h/day** with an ETA of 42
   days. The division is correct, the claim is false: the estimate is the
   task's planned effort, not the founder's clock-hours in a day, and most
   of the queue is executed by an agent — so the sum closed in a 60-day
   window can easily exceed the number of hours that existed in that
   window. What remained was a unitless comparison ("the queue is worth
   ≈ 0.7 of this window") plus a `manual` vs `code` breakdown, because that
   is what tells the founder how much of the work is theirs.
2. **An unparseable estimate cannot be zero.** `dashHours()` returns `null`,
   and the card shows a separate counter, "without a computable estimate".
   A silent zero would shrink the queue.
3. **The burndown scope predicate is a single one** (`dashInScope`), used
   by both the chart and the day panel below it — otherwise the panel would
   show a different set than the line above it counts.

## Steps

1. `dashHours()` / `dashSumHours()` + sums in `computeDashboard`.
2. `dashInScope()` + the burndown scope bar + persistence in `localStorage`.
3. Cards: queue in hours, age of open tasks, backlog hygiene.
4. `backlog/README.md` §2.2.

## Acceptance criteria

- [x] Queue in hours with a breakdown and a counter of unparseable
      estimates.
- [x] Burndown switchable: focus / pre-launch / post-launch / epic.
- [x] Histogram of open-task age × priority, computed from `created`.
- [x] Hygiene card: 8 violation classes, each expandable to a list of
      tasks.
- [x] Clicking a task from the hygiene list opens it in the list view.

## Verification

- `node backlog/scripts/build-viewer.mjs` — build green.
- In the browser (dark + light): 2516 h in the queue (1017 h manual / 1499 h
  code), burndown pre-launch 198 of 794, switching to epic and back to
  focus, the scope choice survives a reload, clicking BL-1185 from hygiene
  opens the task.

## Notes

Three generator traps, all from the fact that client code lives inside a
template literal:

- `\s`/`\d` in a regex has to be written as `\\s`/`\\d` — otherwise the
  template literal eats the backslash and `/^\s*(\d+)/` becomes
  `/^s*(d+)/`. Symptom: **all** estimates unparseable, a 0 h queue, and
  build and lint both green.
- `\"` in an HTML string must be `\\"` for the same reason; otherwise the
  generated script fails to parse.
- A backtick in a comment closes the literal. Guard: `node --check` on the
  script extracted from `viewer.html`, not only on the generator.

Separately, a CSS defect: `.dash-table th` had `position: sticky`, which,
for a table that scrolls with the page (rather than inside `.dash-scroll`),
detached the header and dropped it into the middle of its own rows. Sticky
narrowed to the scrolling container.

## Log

- 2026-08-26: implemented and verified in the browser — claude.
