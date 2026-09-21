---
id: TL-110
title: "Critical path and animations for the Execution view"
type: task
labels: []
board: main
epic: "Execution plan"
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
estimate: 2h
created: 2026-09-01
updated: 2026-09-02
blocked_by: [TL-109]
blocks: []
related_docs: []
verification:                      # HOW to check the task is really done
  - bash: "node --test scripts/tests/viewer-plan.test.mjs"
---

## Goal

The "wow" layer over the Execution view from TL-109: a highlighted critical
path, interactive lighting-up of the dependency chain on clicking a task,
and animated card transitions on live status changes. Purely presentational
— no new data semantics.

## Context

Part of the "Execution plan" epic (decisions in the TL-107 Context). Split
out from TL-109 deliberately: that task delivers a working, testable view;
this one is polish that can be iterated freely without touching the data or
SSE.

Scope:

1. **Critical path** — the longest `blocked_by` chain among the OPEN tasks
   of the plan, weighted by estimates (estimate → hours; the mapping from
   `estimates` values in config.yaml to hours must be one function, not
   scattered literals). Edges and cards on the path highlighted; the sum of
   hours shown next to the now-line as "critical path: ~Nh". Tie in length —
   any of the longest, deterministically (a stable choice, not random).
2. **Clicking a card** — lights up everything that task unblocks
   (transitively over `blocks`/`blocked_by`), and dims the rest; a second
   click or Escape returns to the neutral state.
3. **Transition animations** — a card changing status on an SSE event
   transitions smoothly (transform/opacity, CSS transitions); a done card
   crosses the now-line with a brief highlight. A wave closed in full gets a
   moment of highlight before dimming.
4. **Accessibility** — `prefers-reduced-motion` disables animations;
   highlighting of the critical path and of the selection is never color
   alone (edge thickness/pattern + text on the card), consistent with TL-52.

Out of scope: predicting completion dates, ETA charts, dragging cards
(changing the plan from the viewer would be a possible separate task — it
needs the server to write `plan.yaml` and thought given to change history).

## Pre-flight reading

1. TL-109 and its implementation — the Execution render structure, the plan
   data format on the page, SSE event handling.
2. `scripts/build-viewer.mjs` — existing interaction conventions (clicking
   charts from TL-4) and color tokens.
3. `backlog/config.yaml` — the `estimates` dictionary; hour values computed
   from this data, not from literals in the code.

## Steps

1. Implement critical path computation (weight = estimate in hours) in the
   plan module, with a unit test on a fixture that has a tie.
2. Render the path highlight + the hour-sum label.
3. Click/Escape interaction with transitive chain highlighting.
4. Transition animations on SSE + `prefers-reduced-motion`.
5. Extend `scripts/tests/viewer-plan.test.mjs` with the critical path
   (presence of the highlight and the sum in the HTML from a fixture).

## Acceptance criteria

- [ ] `node --test scripts/tests/viewer-plan.test.mjs` green, including a
      critical-path test with a deterministic tie.
- [ ] The critical path is visually highlighted not by color alone; the
      hour sum is visible.
- [ ] Clicking a card lights up the transitive `blocks` chain; Escape
      returns.
- [ ] A status change via SSE animates the card; `prefers-reduced-motion`
      disables animations.
- [ ] The estimate→hours mapping reads the dictionary from config.yaml,
      with no project-value literals in the code.
- [ ] `worktrail check --language` green.

## Log

Append-only. Format: `YYYY-MM-DD status — who — note`.

2026-09-01 pending — agent:claude — split out of TL-109 as a polish layer;
waiting on a working Execution view.
</content>
