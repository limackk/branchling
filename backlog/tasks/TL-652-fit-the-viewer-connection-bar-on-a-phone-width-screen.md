---
id: TL-652
title: "Fit the viewer connection bar on a phone-width screen"
type: task
labels: []
board: main
epic: "Viewer"
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: [viewer]  # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1h
confidence: medium                 # how much you trust the estimate
created: 2026-11-08
updated: 2026-11-08
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: mobile-connection-bar
    manual: "Open the viewer built by `node scripts/cli.mjs viewer` at a 375 px wide viewport in light and dark mode and confirm that the connection bar's hint runs at full width and the bar is no taller than about a third of the first screen. Evidence: a screenshot at 375 px, not a description."
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

At a 375 px viewport the viewer's connection bar (the 'Snapshot mode' banner under the title row) reads as a banner: its hint text runs at a readable line length instead of a column a few words wide, and the Connect button stays inside the bar.

## Context

Observed on 2026-11-08 while verifying TL-473, which made the title row wrap on a phone. In `scripts/build-viewer.mjs` the `.connection-bar` is a single flex row and `.connection-hint` has `flex: 1`; at 375 px the status label, the hint and the 'Connect to the backlog folder' button share one row, so the hint is squeezed into a column of roughly two words per line and the banner grows to about 290 px tall, pushing the board selector and the task list below the first screen. TL-473 deliberately left this alone: its thesis is the title row only. The live-mode variant of the bar (`.connection-bar.live`, with its edit context and Refresh/Disconnect buttons) has to be checked too. Use the branchling-viewer skill; every colour reads a token and both themes must be checked.

## Steps

1. Below a phone breakpoint, let the bar wrap so the hint takes its own full-width line and the buttons follow it, keeping the status label first.
2. Check snapshot and live mode, light and dark, at 375 px and at desktop width.

## Acceptance criteria

- [ ] The connection bar reads as a banner at 375 px in both themes. [proof: mobile-connection-bar]
- [ ] The suite stays green after the layout change. [proof: suite-green]
