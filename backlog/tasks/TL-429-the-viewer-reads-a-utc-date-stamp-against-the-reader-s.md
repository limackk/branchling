---
id: TL-429
title: "the viewer reads a UTC date stamp against the reader's local day"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P3                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 30m                      # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-21
updated: 2026-09-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: the-relative-day-is-computed-in-one-calendar
    bash: "! grep -Fn 'today.getFullYear(), today.getMonth(), today.getDate()' scripts/build-viewer.mjs"
  - id: suite
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

The viewer's relative dates ("today", "yesterday", "3 days ago") are computed
in the same calendar the dates themselves are written in, so a reader in a
timezone far from UTC is not told that something which happened an hour ago
happened yesterday.

## Context

TL-246 settled that every date a task file carries is the UTC day, and put the
one implementation in `scripts/today.mjs`. That decision covers the WRITERS. It
does not cover the one READER that turns a stamp back into a day.

`histAgo()` in `scripts/build-viewer.mjs` (around line 2954, inside the code
that ships into the generated page and therefore runs in the reader's browser)
does this:

    const today = new Date();
    const t0 = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());

`getFullYear`/`getMonth`/`getDate` are the reader's LOCAL day; `t1` comes from
the `YYYY-MM-DD` of a history entry, which is UTC. The two are subtracted. In a
timezone ahead of UTC, in the hours after local midnight, `t0` is one day ahead
of the UTC day, so an event recorded minutes ago is rendered "yesterday"; in a
timezone behind UTC, late in the evening, the reverse gives "today" a stretch
of nearly a full extra day. Nothing fails and no guard notices — the string is
plausible either way, which is what makes it worth fixing rather than leaving.

This was found while TL-246 was open and was deliberately left out of it: that
task's thesis is the one shape every WRITER stamps, and its guard scans
`scripts/*.mjs` for a stamp being BUILT. `histAgo` does not build a stamp, it
reads one, and it is browser code that cannot import `scripts/today.mjs`.
Widening TL-246 to cover it would have blurred a task already in flight.

## Pre-flight reading

1. `scripts/today.mjs` — the decision TL-246 recorded, and why it is UTC.
2. `scripts/build-viewer.mjs` — `histDay`/`histAgo` and the block of page code
   they belong to; nothing there may import from `scripts/`.
3. `backlog/history/TL-246.jsonl` — the decision record, if the reasoning for
   UTC needs to be reopened rather than followed.

## Steps

1. Decide what the reader should be told. Two defensible answers: compute the
   relative day in UTC, so it agrees with the stamp; or keep the reader's local
   day and accept that "today" means their today. They differ only at the
   boundary, and the boundary is exactly where the current code is wrong,
   because it mixes them.
2. Make `histAgo` use ONE calendar for both sides of the subtraction.
3. A test that drives the page function with a fixed instant and at least two
   timezones — `TZ` is read per child process, and two zones 25 hours apart
   never share a local date, so the assertion does not depend on when the suite
   runs. `scripts/tests/today-stamp.test.mjs` is the pattern to copy.

## Acceptance criteria

- [ ] The viewer's relative day does not mix the reader's local calendar with a
      UTC stamp. [proof: the-relative-day-is-computed-in-one-calendar]
- [ ] The suite is green. [proof: suite]
