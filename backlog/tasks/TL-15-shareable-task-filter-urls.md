---
id: TL-15
title: "Encode the task list filters in the viewer URL"
type: task
labels: [pre-launch]
board: main
epic: ""
priority: P2
status: done
owner: claude
estimate: 3h
confidence: high
created: 2026-08-29
updated: 2026-08-29
blocked_by: []
blocks: []
related_docs: []
verification:
  - bash: "node --test backlog/scripts/tests/viewer-url.test.mjs"
  - manual: "In the viewer select Status=blocked + Epic, paste the URL from the bar into a new window — same list, same count"
---

## Goal

The `Tasks` view loses whatever you set: filters, search, sorting and board
scope live in memory and in `localStorage`, so "look at these 12 blockers
from the Legal epic" has to be described in words instead of sent as a link.
The dashboard has had this since TL-13 (`#dashboard?range=…`); the task list
is to get the same contract.

## Context

- Founder request (2026-08-29): "when you add a filter and other parameters,
  a URL should be built that can be sent to someone and gets the same set of
  tasks."
- Precedent and pattern to copy: `dashEncodeHash()` / `dashApplyHash()` /
  `dashSyncHash()` in `build-viewer.mjs` — including the rule that a
  parameter which also has a source in `localStorage` is ALWAYS emitted
  (otherwise a recipient with their own saved scope would see a subset of
  the sender's, and the link would lie).
- State before the change: the hash carries only `#BL-NNN` (the selected
  task) or `#dashboard?…`. Board scope can be passed through the `?board=`
  query.
- Why the URL code moves to a separate `viewer-url.mjs` module: the whole
  viewer is one template literal in `build-viewer.mjs`, so nothing inside it
  can be run in a test — regex assertions on the HTML are a detector with no
  evidentiary force. The module is imported by the test and INLINED into the
  page at build time, so the browser and `node --test` run the same code,
  not two copies that can drift apart.

## Steps

1. `backlog/scripts/viewer-url.mjs` — pure `encodeTasksHash()` / `parseTasksHash()`.
2. `backlog/scripts/tests/viewer-url.test.mjs` — round-trip, a comma in an
   epic name, an omitted parameter falls back to the default, an unknown
   sort.
3. `build-viewer.mjs` — inject the module source into the page + wire it
   into `render()`, `selectTask()`, search, tabs, and `handleHash()`.
4. `backlog/README.md` §2.1 — the link format.

## Acceptance criteria

- [x] Every change to filter / search / sort / board / selection rewrites the URL.
- [x] Opening the URL reproduces exactly that set of tasks — even for someone
      with a different board in their `localStorage`.
- [x] A parameter absent from the link falls back to its default value (the
      link does not get narrowed by leftovers from the recipient's state).
- [x] Old `#BL-NNN` links still work.
- [x] `node --test backlog/scripts/tests/viewer-url.test.mjs` green.

## Verification

```bash
# URL module tests — expected: pass, 0 fail
node --test backlog/scripts/tests/viewer-url.test.mjs
# Board contract still green (same generator file) — expected: pass
node --test backlog/scripts/tests/boards.test.mjs
```

## Log

- 2026-08-29 created — claude — founder request: a link with filters to send
- 2026-08-29 in_progress — claude — starting implementation
- 2026-08-29 done — claude — `viewer-url.mjs` + 8 tests; verified in the browser through clicks, not through code: filter/search/sort/board/selection build the URL, and the same URL for a "recipient" with `localStorage=backlog-project` reproduced the sender's set (4/1349, same order, same selection) and did NOT overwrite their saved scope. Dashboard drill-down now gives a link instead of clearing the hash; old `#BL-NNN` links normalize to the full form.
- 2026-08-29 follow-up — claude — a "⧉ Copy link" button in the header at the founder's request. Three paths (clipboard API → execCommand → prompt), because `file://` is not a secure context. Verified by clicking: a "Link copied ✓" toast on both paths — the second checked with `navigator.clipboard` disabled, so as not to test only the one that would work anyway.
- 2026-08-29 renumber — claude — from BL-1389 to TL-15: `next-backlog-id.mjs` in the worktree only sees its own tree, and a parallel session had taken 1389 in the main checkout (`BL-1389-nazwa-aktywnego-dziecka-z-nieswiezej-listy.md`, still uncommitted at the time). I yielded the number, because that file was in someone else's stage and mine was sitting on its own branch.
</content>
