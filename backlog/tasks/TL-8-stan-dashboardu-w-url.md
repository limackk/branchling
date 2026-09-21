---
id: TL-8
title: "Dashboard state in the URL — a view can be shared"
type: task
labels: [pre-launch]
epic: ""
board: main
priority: P2
status: done
owner: claude
estimate: 1h
confidence: high
created: 2026-08-26
updated: 2026-08-26
blocked_by: []
blocks: []
related_docs: []
verification:
  - bash: "node backlog/scripts/build-viewer.mjs"
  - manual: "Dashboard → change the range, the burndown range, pin a day, sort the table; the URL reflects each of these"
  - manual: "Open this URL in a new tab (or after changing localStorage) — the view reconstructs exactly; plain #dashboard leaves the session state untouched"
---

## Goal

The dashboard had one address (`#dashboard`) for all of its states. A view
could not be shared — not with another person, not with an agent, not with
yourself tomorrow.

## Context

Chosen by the founder from a list of proposals for "what shows that the
dashboard is also built for AI agents" (rejected this round: a
human/agent work-split card, an agent-readiness contract for tasks, a machine
JSON output, splitting the daily bars into agent and human).

Three decisions:

1. **The date range and burndown range are always emitted**, the pinned day
   and sorting only when set. This keeps the link exact: a recipient with a
   different range in `localStorage` sees the sender's range, not their own.
2. **The URL wins over `localStorage`, but does not overwrite it.** Opening
   someone else's link must not erase your setting — only your own change in
   the UI overwrites it.
3. **Plain `#dashboard` deliberately carries no state** and leaves the
   current one untouched. This is what the tab button produces; if it meant
   "default", clicking the tab would erase the range chosen a minute earlier.

Synchronization goes through `history.replaceState`, not through assigning to
`location.hash` — an assignment fires `hashchange`, which would loop back into
`handleHash` and apply the state that was just set.

## Acceptance criteria

- [x] Range, burndown range, pinned day, and sorting are in the hash.
- [x] A link reconstructs the view and wins over `localStorage` without
      overwriting it.
- [x] `#dashboard` with no parameters leaves the session state.
- [x] Deep-linking to a task (`#BL-NNN`) works as before.

## Verification

- In the browser: the hash grows with every state change; opening
  `#dashboard?range=30&burn=label:pre-launch&day=2026-08-13:daily&sort=epics:p0:desc,barsStatus:value:desc`
  with `localStorage` set to 90 days yields 30 days, the pre-launch burndown,
  the panel for 2026-08-13, epics sorted by P0, statuses sorted by value —
  while `localStorage` stays at 90. Garbage data in `day=` is rejected (the
  panel does not appear, the hash straightens itself out). Switching to the
  Tasks tab and back preserves the state; `#BL-1030` still opens the task.

## Log

- 2026-08-26: implemented and verified in the browser — claude.
