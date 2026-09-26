---
id: TL-451
title: "The dashboard answers flow, backlog health and human attention"
type: task
labels: []
board: main
epic: "Backlog viewer"
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-26
updated: 2026-09-26
blocked_by: [TL-448]               # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: dashboard-data
    bash: "node --test scripts/tests/viewer-dashboard.test.mjs scripts/tests/viewer-plan.test.mjs scripts/tests/viewer-history.test.mjs scripts/tests/viewer-url.test.mjs"
  - id: visual-dashboard
    manual: "Open snapshot and live dashboards in light and dark mode at desktop and narrow widths; verify every KPI and chart can be read, every drill-down opens the represented tasks, and no panel attributes productivity to an individual."
---

## Goal

The viewer dashboard lets a project owner understand within five seconds whether work is moving, accumulating, blocked or waiting for a person, and then drill from every aggregate into the exact tasks behind it.

## Context

TL-379 removed the historical dashboard and TL-442 removed its remnants. The owner now wants a more capable dashboard restored. The redesign brief already names three audiences and useful measures, but old charts must not return as decoration or productivity surveillance. Metrics describe task flow and backlog state, never individual performance. Current-state cards and time-window flow must remain visibly different, and every number must be reproducible from task files and history.

## Steps

1. Restore a Dashboard tab with current open, in-progress, blocked, waiting-on-human, urgent and unscheduled counts.
2. Add date-range flow metrics for created, closed, net backlog movement, throughput and median lead time, with unknown or insufficient samples stated rather than converted to zero.
3. Render cumulative backlog, day-by-day movement, plan-wave progress and epic health using dependency-free SVG or HTML.
4. Make each KPI, chart point, wave and epic open the corresponding task set using the shared URL filter state.
5. Keep board scope and project vocabularies dynamic, and ensure colour is never the only carrier of meaning.
6. Put reusable calculations in testable modules that are inlined into the self-contained viewer rather than duplicating them inside the template.

## Acceptance criteria

- [ ] Dashboard metrics, ranges, drill-down links and unknown-sample behavior are computed from the same task and history data the viewer displays. [proof: dashboard-data]
- [ ] The dashboard is useful and legible for a real project owner rather than only structurally present. [proof: visual-dashboard]
