# Design source for the Execution tab redesign

**Status:** PROJECT (2026-09-05) — mockups, not an implementation
([TL-278](../../backlog/tasks/TL-278-the-execution-tab-spends-its-space-on-finished-waves-and.md))

Five artboards showing the viewer's **Execution** tab redesigned to the brief in
[`docs/viewer-redesign-brief.md`](../viewer-redesign-brief.md) §7. They are
static mockups: no control works, and nothing here is wired to the page in
`scripts/build-viewer.mjs`. Implementing them is TL-278.

| Artboard | What it shows |
| --- | --- |
| `Main` | The default state: the summary and the wave rail, `Now`, the critical path as a chain, `Ahead`, `Behind you` collapsed, and unplanned work as a share |
| `Focus` | A card selected, its chain lit, everything else receded — and one closed wave opened because the chain is in it |
| `Empty` | No `plan.yaml`, and a `plan.yaml` that does not parse |
| `States` | Every wave closed, a `together` group, work running in another worktree, an id with no task in this tree, a blocker the plan does not schedule, a card that just moved, snapshot mode |
| `Light` | `Main` again, in the light theme |

## The three moves

1. **The order of the page is reversed.** Progress and running work come first;
   finished waves collapse to one row each and go last. Today nine closed waves
   are drawn at full size before anything a reader can act on.
2. **Unplanned work is stated as a share, not printed as a list** — the figure
   is the health of the plan, and the tasks are reachable underneath it, grouped
   and expandable. This is [TL-253](../../backlog/tasks/TL-253-plan-reports-the-open-work-outside-every-wave-as-a-share.md)
   asked of the view rather than of the terminal.
3. **The drawn dependency edges are dropped rather than redrawn.** The relation
   moves onto the card ("waiting on TL-90 — not in the plan", "unblocks
   TL-198") and the critical path becomes an explicit chain; the focus
   interaction replaces following a line by eye.

## Where the values come from

Colours, type sizes, badge shapes and the header chrome are lifted from
`scripts/build-viewer.mjs` — both theme token sets, and the status and priority
palette **as it is generated** from the vocabularies in
[`backlog/config.yaml`](../../backlog/config.yaml). Every wave name, task id,
title, estimate and count is real, taken from `branchling plan` and
`backlog/plan.yaml` on 2026-09-05.

Two deliberate departures from the current code, both defended in the brief:

- Badges are 11px and are no longer uppercased. `text-transform: uppercase` on a
  10px badge renders the estimate `~30m` as `~30M`, which reads as a different
  unit.
- Badge text in the dark theme is lightened. The generated hue is used for both
  themes today, and `rgb(220,38,38)` on a dark ground does not carry.

The only invented content is in `States`: this backlog has no `together` group
and no plan entry without a task file, so those two cards demonstrate a
treatment rather than report a fact.

## Rebuilding

```
cd docs/design && node build.mjs
```

That assembles `<Name>.dc.html` from the sources here: `_base.css` (app chrome
and shared tokens), `_exec.css` (the redesigned view), `_chrome.html` (the
header, shared by every artboard) and one `body-*.html` per artboard.
`canvas.json` places the artboards and carries the sticky notes.

To look at one in a browser without the canvas runtime:

```
cd docs/design && node preview.mjs
```

then open `http://127.0.0.1:4848/Main.dc.html`. This strips the `<x-dc>`
wrapper and renders the body directly — good enough for checking layout and
measuring heights, and it is not what the canvas shows.

**What is not committed here** (law 2 — what is computed may be deleted): the
assembled `*.dc.html`, and the seeded canvas page, which is a copy of the design
tool's editor with these files embedded in it. Both are regenerated, the second
by the tool that published them.
