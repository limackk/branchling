---
id: TL-696
title: "Keep the live connection bar's hint readable at desktop width"
type: task
labels: []
board: main
epic: "Viewer"
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: awaiting_vouch  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-1
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1h
confidence: medium                 # how much you trust the estimate
created: 2026-11-10
updated: 2026-11-12
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: desktop-live-bar
    manual: "Serve a backlog whose path is longer than 80 characters with `node scripts/cli.mjs serve` and open it at a 1280 px viewport in light and dark mode: the hint runs on at most two lines and the status label and buttons stay on one line each. Evidence: a screenshot, not a description."
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

In live mode at desktop width (1280 px) the viewer's connection bar keeps its hint at a readable line length instead of squeezing it into a narrow column beside the edit context.

## Context

Observed on 2026-11-10 while verifying TL-652, which wrapped the connection bar below 640 px only. In `scripts/build-viewer.mjs` the `.connection-bar` is one flex row; `.connection-hint` has `flex: 1`, while `.edit-context` (the 'Writing to <path>' line, the 'Editing as' actor input and its note) does not shrink, because the path is a single unbroken monospace string. With a long backlog path at 1280 px the hint was measured at about 115 px wide, nine lines tall, and the 'Live (local server)' label and the Refresh button wrapped onto two lines each, making the bar about 185 px tall. Snapshot mode at desktop width is not affected. Use the branchling-viewer skill; every colour reads a token and both themes must be checked.

## Steps

1. Let the live bar wrap at every width (for instance give `.edit-context` its own full-width line, or let the path break with `overflow-wrap: anywhere`), keeping the status label first.
2. Check live and snapshot mode, light and dark, at 1280 px and 375 px, with a long backlog path.

## Acceptance criteria

- [ ] The live connection bar reads as a banner at desktop width with a long path. [proof: desktop-live-bar]
- [ ] The suite stays green after the layout change. [proof: suite-green]
