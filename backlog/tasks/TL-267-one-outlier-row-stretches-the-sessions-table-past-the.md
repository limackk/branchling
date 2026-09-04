---
id: TL-267
title: "One outlier row stretches the sessions table past the terminal"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P3
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-04
updated: 2026-09-04
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: table-fits
    bash: "node --test scripts/tests/sessions-table-width.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

`branchling sessions` renders a table a terminal can read. Today one row
with 200 task ids in it sets the column width for all eight, and the last
column lands past character 600.

## Context

Measured on 2026-09-04. The backfill row carries every task the
`agent:backfill` pass touched:

    (no session id)  agent:backfill  2026-09-01 19:21 → 17:15  0 min
      TL-1, TL-10, TL-100, TL-101, … (200 ids) …  nothing moved

Because the task column is sized to its widest value, every other row is
padded to match:

    03b23977-…  agent:claude  2026-09-03 16:11 → 16:11  0 min  TL-172
    <~600 columns of spaces>                                   3 change(s)

Seven of the eight rows are short. The information in them — how long the
session ran and what moved — is separated from the row it belongs to by
half a screen of whitespace, and wraps unpredictably depending on terminal
width.

**The row is not the defect.** A session that touched 200 tasks is a real
session and the ids are real data. What is wrong is that an unbounded
column participates in the width calculation at all.

**Related but not the same as TL-236.** That task is about `check` printing
more warnings than anybody reads. This is one command's table geometry, and
the fix is local.

## Steps

1. Cap the task column and say how many were elided — `TL-1, TL-10, TL-100
   and 197 more` — the way the plan report already elides its unplanned
   list.
2. Decide whether the full list is still reachable, and how. `--json`
   already carries it, which may be the whole answer.
3. Check the other tabular commands for the same shape before closing:
   whichever of them sizes a column from unbounded data has the same defect
   waiting.

## Acceptance criteria

- [ ] No row of `sessions` exceeds a stated maximum width, proven by a test
      that fails against today's output. [proof: table-fits]
- [ ] `sessions --json` still carries every id. [proof: suite-green]
