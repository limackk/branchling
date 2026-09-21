---
id: TL-14
title: "query.mjs — a question to the backlog instead of reading a whole view"
type: task
labels: [post-launch, ops-hardening]
board: main
epic: ""
priority: P2
status: done
owner: claude
estimate: 2h
confidence: high
created: 2026-08-29
updated: 2026-08-29
blocked_by: []
blocks: []
related_docs: []
verification:
  - bash: "node --test backlog/scripts/tests/boards.test.mjs"
  - bash: "node backlog/scripts/query.mjs --status blocked --epic Legal"
---

## Goal

Third step in the series after TL-12 (INDEX slimming) and TL-13 (NOW.yaml):
replace a **fixed** read cost with a cost matched to the question.

## Context

`INDEX.yaml` is today ~17k tokens, `NOW.yaml` ~3k — and the full cost is
paid regardless of what is being asked. "What is blocked in Legal
compliance" is one line; measured: **193 B of response (~48 tokens) in
58 ms** instead of 17k tokens.

Two decisions came up while writing this:

**It reads `tasks/*.md`, not the views.** The views are generated; if they
were the source of the answer, a freshly changed status would be invisible
until regeneration, and the query would falsely confirm that the change
"didn't work". The cost is about 1350 file reads — 58 ms, less than it takes
to look at the result. A test guards this property directly (a file change
without regeneration must be visible).

**A typo in a flag fails (exit 2).** `--prioryty P0` returning zero results
is indistinguishable from "there is nothing like that" — and reads like an
answer. This is the same class as a measurement without a positive control.
For the same reason `--limit` **states** how much it cut (`# showing 5 of
12 matching`), instead of silently handing back a slice as if it were the
whole set.

Without an explicit `--status`, the question applies only to active tasks:
1009 of 1346 tasks are closed and would flood every answer. `--status done`
enters the archive deliberately.

## Acceptance criteria

- [x] Filters `--status --priority --board --label --epic --owner --type
      --blocked-by --text`; AND across axes, OR via commas within an axis.
- [x] Outputs: one line per task (as in INDEX), `--json`, `--files` (for
      `xargs`), `--count`; `--sort priority|id|id-desc`.
- [x] Unknown flag → exit 2 with its name; `--limit` reports the truncation.
- [x] Reads tasks, not views — a fresh change is visible without
      regeneration.
- [x] README §2/§3.3/§7 + workspace `CLAUDE.md`; tests 33/33 green (7 new
      cases).

## Verification

```bash
node --test backlog/scripts/tests/boards.test.mjs
node backlog/scripts/query.mjs --status pending --priority P0 --limit 5
node backlog/scripts/query.mjs --blocked-by BL-002        # positive control: BL-003
```

Positive control run 2026-08-29: `--blocked-by BL-003` returned 0 —
verified with an independent grep that this was a genuine zero, not a
silent filter bug (`--blocked-by BL-002` returns BL-003, matching
`grep -l "blocked_by:.*BL-002"`).

## Notes

Balance sheet for the TL-12 → TL-14 series: the default read dropped from
14 KB of declared focus to 12 KB of computed NOW, the index from 149 KB to
69 KB, and point queries cost tens of tokens instead of thousands.

Deliberately out of scope: `query.mjs` cannot sort by `updated`/`created` or
filter by date range — "what hasn't moved in 90 days" is served by the
viewer's dashboard (Age / Hygiene section) instead.

## Log

- 2026-08-29 done — claude — filters + three output formats; hard failure on
  a flag typo and explicit reporting of truncation
