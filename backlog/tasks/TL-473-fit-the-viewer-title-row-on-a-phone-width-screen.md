---
id: TL-473
title: "Fit the viewer title row on a phone-width screen"
type: task
labels: []
board: main
epic: "Viewer"
priority: P3
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1h
confidence: medium                 # how much you trust the estimate
created: 2026-10-16
updated: 2026-10-16
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: mobile-header-fits
    manual: "Open the viewer built by `node scripts/cli.mjs viewer` at a 375 px wide viewport in light and dark mode and confirm that every control of the title row is visible without horizontal scrolling. Evidence: a screenshot at 375 px, not a description."
  - id: mobile-suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

At a 375 px viewport the viewer's title row fits the screen: the project name, the snapshot time, the view tabs (Tasks, Execution, Waiting on you), Copy link and the product mark are all reachable without horizontal scrolling of the page.

## Context

Observed on 2026-10-16 while verifying TL-471, by building the viewer with `node scripts/cli.mjs viewer` and opening it with a 375x812 mobile viewport. The `.app-title` row in `scripts/build-viewer.mjs` is a non-wrapping flex row (`display: flex; align-items: baseline; gap: 16px`) and `.view-tabs` has `margin-left: auto`; on a phone the build-meta text wraps into a narrow column and the tabs run off the right edge, so 'Waiting on you', Copy link and the product mark added by TL-471 are cut off. This predates TL-471; the mark only made one more element fall off the end.

The viewer is the surface non-technical readers use, and a forwarded link is often opened on a phone. Use the branchling-viewer skill; every colour reads a token and both themes must be checked.

## Steps

1. Let the title row wrap below a breakpoint, or move the tabs to their own row, keeping the project name first.
2. Check light and dark at 375 px and at desktop width.

## Acceptance criteria

- [ ] Open the viewer built by `node scripts/cli.mjs viewer` at a 375 px wide viewport in light and dark mode and confirm that every control of the title row is visible without horizontal scrolling. Evidence: a screenshot at 375 px, not a description. [proof: mobile-header-fits]
- [ ] The suite stays green after the layout change. [proof: mobile-suite-green]
