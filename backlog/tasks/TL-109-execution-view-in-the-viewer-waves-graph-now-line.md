---
id: TL-109
title: "Execution view in the viewer: waves, graph, now-line"
type: task
labels: []
board: main
epic: "Execution plan"
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:session
estimate: 1d
created: 2026-09-01
updated: 2026-09-01
blocked_by: [TL-107]
blocks: [TL-110]
related_docs: []
verification:                      # HOW to check the task is really done
  - bash: "node --test scripts/tests/viewer-plan.test.mjs"
  - bash: "node --test scripts/tests/ui.test.mjs"
---

## Goal

The viewer gets an "Execution" tab: the plan from `backlog/plan.yaml` drawn as
a vertical pipeline of waves with task cards, `blocked_by` dependency edges,
and a "now-line" separating done from the rest. The view updates live over
the existing SSE — a status change in a file moves a card without a reload.
The effect should be VISUALLY DISTINCT from the rest of the viewer's tables
and charts: this is a flow view, not a list.

## Context

Part of the "Execution plan" epic (decisions in the Context of TL-107). This
task depends on TL-107 (format + parser + state logic in `scripts/plan.mjs` —
the "active wave / next up" function is shared with the command from TL-108,
so the CLI and the view don't drift apart in their definitions). It does NOT
depend on TL-108.

What already exists and should NOT be rebuilt:

- **SSE already works.** `serve-backlog.mjs` watches `tasks/` via `fs.watch`
  and pushes events to open tabs; the Execution view only needs to add a
  redraw after an event. A watch on `plan.yaml` itself needs to be added (it
  lives outside `tasks/`), so editing the plan also refreshes the view.
- **History knows timestamps.** `history.mjs` has the moment of transition
  into `in_progress`, and a task has an `estimate` — a card for a task in
  progress shows a live "elapsed / estimate" bar (e.g. "45m / 2h"), computed
  in the browser.
- **The viewer is self-contained.** One HTML file, zero libraries — the graph
  is drawn with our own SVG. The layout is simple, because the waves from the
  plan ARE layers: Y position from the wave index, X from the index within
  the wave, `blocked_by` edges as curves between layers. This is not a
  general DAG-drawing problem.
- **Palette and dark mode** come from the config — use the existing status
  color tokens, don't introduce new constants.

View elements (scope of this task; animations and the critical path are
TL-110):

1. Waves as horizontal bands with a name and a done/total counter; `together`
   groups visually bound (shared frame).
2. Task card: ID (link to the task in the existing view), title, status by
   COLOR AND WORD (TL-52: color is emphasis), owner, estimate; for
   `in_progress` — an elapsed/estimate bar.
3. SVG edges from `blocked_by` between plan cards; a dependency on a task
   outside the plan — a small badge on the card instead of an edge.
4. "Now-line" above the active wave; closed waves dimmed.
5. Explicit "Unplanned (N)" section — open tasks outside the plan; the plan
   must not pretend to be complete.
6. No `plan.yaml` = a tab with instructions on how to set up a plan, not an
   error.
7. The view also works in file:// mode (no SSE — no live updates, with data
   from the build); tab state in the URL like the other views
   (`viewer-url.mjs`).

## Pre-flight reading

1. Context of TL-107 — plan format, "the plan is advisory, status is truth".
2. `scripts/plan.mjs` (from TL-107/TL-108) — parser and state logic to reuse.
3. `scripts/build-viewer.mjs` — how a tab is added, color tokens, dark mode,
   rendering conventions.
4. `scripts/serve-backlog.mjs` — SSE mechanics and suppressUntil (not echoing
   our own writes); this is where the watch on `plan.yaml` will be added.
5. `scripts/viewer-url.mjs` — view state in the URL.
6. `scripts/history.mjs` — where to get the time of entering `in_progress`.
7. `.claude/skills/branchling-viewer/SKILL.md` — conventions for working on
   the viewer.

## Steps

1. Pass plan data to the viewer (build: output of `scripts/plan.mjs` in the
   page data; serve: endpoint/refresh over SSE).
2. Add a watch on `plan.yaml` in `serve-backlog.mjs` and an SSE event.
3. Implement the render for the Execution tab (elements 1–7 from Context).
4. Wire up the redraw after SSE; verify that editing status from within the
   viewer also refreshes the view.
5. Tests in `scripts/tests/viewer-plan.test.mjs`: HTML contains waves and
   cards from a plan fixture; no plan renders the instructions; an unplanned
   task is listed. Own fixture — do not assert values from this repository's
   own backlog (rule from CLAUDE.md).

## Acceptance criteria

- [ ] `node --test scripts/tests/viewer-plan.test.mjs` green; `ui.test.mjs`
      shows no regression.
- [ ] The Execution tab renders waves, cards, `blocked_by` edges, the
      now-line, and the Unplanned section from the fixture.
- [ ] Changing a task's status in the file while `worktrail serve` is running
      moves the card without a page reload (SSE).
- [ ] Editing `plan.yaml` while the server is running refreshes the view.
- [ ] An `in_progress` card shows elapsed/estimate from history.
- [ ] The view respects dark mode and the palette from config; status is
      always also shown as a word.
- [ ] No `plan.yaml`: a tab with instructions, zero console errors.
- [ ] Viewer chrome in English; `worktrail check --language` green.

## Log

Append-only. Format: `YYYY-MM-DD status — who — note`.

2026-09-01 pending — agent:claude — task created from the "execution plan"
analysis; waiting on data and parser from TL-107. Animations and the
critical path split out to TL-110.
