---
id: TL-442
title: "The viewer carries no remnants of the removed dashboard"
type: task
labels: []
board: main
epic: ""
priority: P3
status: pending
owner: unassigned
role: ""
executor: ""
estimate: 1h
confidence: high
created: 2026-09-22
updated: 2026-09-22
blocked_by: []
blocks: []
related_docs:
  - scripts/build-viewer.mjs
  - scripts/viewer-url.mjs
verification:
  - id: no-dashboard-remnants
    bash: "! grep -n -i 'dashboard\\|DASH_' scripts/build-viewer.mjs scripts/viewer-url.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

`scripts/build-viewer.mjs` no longer declares constants, comments or state
labels belonging to the analytics dashboard TL-379 removed. A reader of the
file learns which views the page has from the file itself, not from prose
about a view that no longer renders.

## Context

TL-379 reduced the viewer to three tabs — Tasks, Execution, Waiting on you —
and deleted the dashboard with its charts, ranges and aging table. The deletion
left behind, in `scripts/build-viewer.mjs`:

- four constants nothing reads: `DASH_PRESETS` (3073), `DASH_RANGE_STORE`
  (3079), `DASH_BURN_STORE` (3084), `AGING_COLUMNS` (3093) — each is declared
  once and referenced nowhere else in the file;
- section headers with no section under them: `─── Dashboard ───` (3063),
  `─── Chart hover ───` (3620), `─── Sorting, once, for every listing on the
  dashboard ───` (3086), `─── Dashboard state in the URL ───` (3165);
- comments naming `#dashboard` as a live hash (2278, 3171 in
  `build-viewer.mjs`; 25 and 89 in `scripts/viewer-url.mjs`) and the view-state
  comment at 1887 listing `"dashboard"` as a possible value of `state.view`.

This is not cosmetic. The comments assert a contract the page no longer keeps:
somebody reading them will look for the hash handler that reads `#dashboard`
and find none, and `DASH_RANGE_STORE` reserves a `localStorage` key for data
nothing writes. Line numbers are from `d7a5fd9` and will move.

## Pre-flight reading

1. `scripts/build-viewer.mjs` — the four declarations and the orphaned headers;
   check each identifier really has a single occurrence before deleting it.
2. `scripts/viewer-url.mjs` — the two comments that tell `#tasks` apart from
   `#dashboard`; they still need to say what the tasks prefix is told apart
   FROM, so rewrite them against the surviving views rather than deleting the
   sentence.
3. `git show fa8e177` — what TL-379 removed and why, so nothing here is read as
   an invitation to bring the dashboard back.
4. `scripts/tests/viewer-storage-keys.test.mjs` — it reads the storage keys out
   of the page; removing one key must keep its sample large enough to prove the
   namespace.

## Steps

1. Delete the four unused constants and the headers left without a body.
2. Rewrite the `#dashboard` comments and the `state.view` comment to name the
   views that exist: `tasks`, `execution`, `decisions`.
3. Run the suite.

## Acceptance criteria

- [ ] Neither `scripts/build-viewer.mjs` nor `scripts/viewer-url.mjs` contains
      the word "dashboard" or a `DASH_` identifier. [proof: no-dashboard-remnants]
- [ ] The whole suite is green. [proof: suite-green]
