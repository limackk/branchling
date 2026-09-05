---
id: TL-278
title: "The Execution tab spends its space on finished waves and hides now"
type: task
labels: []
board: main
epic: "Backlog viewer"
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-09-05
updated: 2026-09-05
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs:
  - docs/viewer-redesign-brief.md
  - docs/design/README.md
verification:
  - id: summary-first
    bash: "node --test scripts/tests/viewer-plan.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
  - id: guards-green
    bash: "node scripts/cli.mjs check"
---

## Goal

The Execution tab opens on what is happening NOW. A reader who has never seen
the page can answer, without scrolling: which wave is active, what is running,
what is next, and how much of the open work the plan does not schedule at all.

Concretely, `renderExecution()` produces, in this order: a summary line stating
progress in words and figures ("wave 10 of 14 - 31 of 36 planned tasks done -
1 running - critical path ~40 h"), the active wave and anything in flight at
full size, closed waves collapsed to one row each, and the unplanned region
led by a SHARE rather than by a list of every id.

## Context

The view was built by TL-109 and TL-110 and its MODEL is sound: waves,
`together` groups, dependency edges, the critical path, work running in another
worktree, the "now" line. Nothing in `planViewModel()` is wrong. What is wrong
is how the page prices that model in vertical space.

Measured on this repository on 2026-09-05, with `branchling plan`:

- 14 waves, of which 9 are 100% closed. They are drawn first, at full size, so
  the "now" line and the active wave sit at roughly 65% of the scroll height.
  The tab opens on finished history.
- A closed wave occupies exactly as much space as the active one. The only
  difference is `opacity: .55`, which at that value still reads as legible body
  text rather than as "behind you".
- No progress figure exists anywhere on the tab. "Wave 10 of 14" has to be
  counted off the bands.
- The unplanned region prints one chip per task - 64 of them, single-line and
  ellipsised - which is 93% of the open work presented as noise at the bottom
  of the page. TL-253 asks the terminal report for the same thing this asks the
  view for: lead with the share.
- The dependency edges are 1.5px, 45% opacity, dashed, drawn behind opaque
  cards that wrap onto several rows, so the one structure worth seeing is the
  least visible thing on the screen.
- The critical-path total - the single number a reader might act on - is an
  11px inline label beside the "now" line, in the middle of the page.

The full brief, written for a designer and covering the whole viewer rather
than this tab alone, is `docs/viewer-redesign-brief.md` section 7. Read it
before deciding what the new layout is; this task is the implementation of
that section, not a fresh design exercise.

This is deliberately NOT a task about the visual language of the whole page.
The header, the connection bar and the Tasks detail panel have their own
problems, listed in the same brief; folding them in here would blur both.

## Pre-flight reading

1. `docs/viewer-redesign-brief.md` - section 7 states what the tab is for, how
   it fails and what the redesign must preserve.
2. `docs/design/` - five artboards drawn to that section, and the sources they
   are built from. Run `node build.mjs` there first; the assembled files are
   not committed.
3. `scripts/viewer-plan.mjs` - `planViewModel()` (the model, unchanged by this
   task) and `renderExecution()` / `renderCard()` / `renderWaveCards()` (the
   markup, which this task rewrites).
4. `scripts/build-viewer.mjs` - the `Execution` CSS block, and
   `renderExecution_()` / `drawPlanEdges()` in the page script, which measure
   the cards after layout and fill in the edge geometry.
5. `scripts/tests/viewer-plan.test.mjs` - the file inlined by source into the
   page, so the browser and `node --test` run the same code.
6. `scripts/plan.mjs` - `planState()`, which owns the arithmetic. The view may
   not compute a second answer to "which wave is active".

## Steps

1. Add the summary the tab has no equivalent of, computed from what
   `planViewModel()` already returns: waves closed of total, planned tasks
   closed of total, tasks running, critical-path hours with the count of
   unestimated tasks appended.
2. Collapse a closed wave to a single row - name, count, an expander - and keep
   the active wave and any running card at full size and full contrast.
3. Give the four wave states (closed, active, next, later) four treatments that
   differ by more than one opacity value, each carrying a word as well as a
   colour.
4. Lead the unplanned region with the share, in a sentence, and give the reader
   a way to get at the tasks - grouped or filtered - rather than every id at
   once.
5. Decide the dependency edges: either a layout in which an edge can be
   followed, or drop the drawn edges and state the relation on the card. Keep
   the critical path readable as an ordered chain either way.
6. Keep the focus interaction (clicking a card dims everything outside its
   chain) and an obvious way out of it.

## Acceptance criteria

- [ ] `renderExecution()` emits a summary element before the first wave, and
      it states the active wave's position in the plan, the count of planned
      tasks closed, and the critical-path total. [proof: summary-first]
- [ ] A wave the model marks `past` renders collapsed - its task cards are not
      in the initial markup - while the active wave renders its cards.
      [proof: summary-first]
- [ ] The unplanned region opens with the share of open tasks outside every
      wave, as a figure, before any task id appears. [proof: summary-first]
- [ ] Every state in the brief's section 7.5 that the model can produce is
      covered by a case in `scripts/tests/viewer-plan.test.mjs`: no plan, a
      plan that does not parse, every wave closed, a `together` group, a task
      absent from this backlog, a task running elsewhere, a task blocked by
      something the plan does not schedule. [proof: summary-first]
- [ ] The suite is green. [proof: suite-green]
- [ ] The guards are green. [proof: guards-green]
