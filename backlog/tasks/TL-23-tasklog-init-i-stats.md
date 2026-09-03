---
id: TL-23
title: "worktrail init and stats — creating a backlog and showing its state in the terminal"
type: code
labels: [pre-launch]
board: main
epic: "worktrail — the tool"
priority: P2
status: done
owner: claude
estimate: 4h
confidence: high
created: 2026-08-29
updated: 2026-08-29
blocked_by: []
blocks: []
related_docs:
  - docs/branchling-state-and-sync.md
verification:
  - bash: "./scripts/worktrail init --dir /tmp/x && ./scripts/worktrail build --dir /tmp/x && ./scripts/worktrail stats --dir /tmp/x"
  - bash: "./scripts/worktrail stats --json | python3 -c \"import json,sys; print(json.load(sys.stdin)['active'])\""
  - bash: "node --test backlog/scripts/tests/init-stats.test.mjs"
---

## Goal

Close out the two commands deferred in [TL-22](TL-22-tasklog-dispatcher-komend.md)
as "require extracting the dashboard core": `init` (creating a new backlog)
and `stats` (its state in the terminal).

## Context

`stats` was deferred because the dashboard's arithmetic lived inside
`build-viewer.mjs`, INSIDE the viewer's template literal. Checking before
writing changed the scope: **`computeStats` already existed and was
exported**, and out of everything else `stats` needed only the estimate-to-
hours conversion (`DASH_UNIT_HOURS`, `dashHours`, `dashSumHours`,
`dashHoursLabel`) — a dozen or so lines, not the 270-line `computeDashboard`.

Writing that a second time in the CLI would have meant that **the dashboard
and the terminal could someday give two different numbers for the same
question.** Instead, the math moved to `estimate.mjs`, pasted as SOURCE into
the viewer — the same pattern as `task-fields.mjs` and `viewer-url.mjs`. The
viewer lost its own copy; one implementation now serves both surfaces.

**Deliberately out of scope:** extracting `computeDashboard` (days, charts,
burndown, lead time). That is ~270 lines driving charts; pulling them out
alongside `stats` would be a refactor with real regression risk and no need
on the CLI side.

`init` carries the opposite risk from `stats`: **it writes into someone
else's directory, and the write cannot be undone.** Hence two decisions
that look like overkill:

1. **`--dir` is MANDATORY.** Every other command detects the backlog upward
   from cwd; here, detection would mean guessing WHERE to create the files.
2. **An existing file is SKIPPED and the skip is printed.** Silence about a
   skipped file reads like a write.

## Steps

1. `estimate.mjs` — estimate → hours, no imports, pasted into the viewer;
   remove the copy from `build-viewer.mjs`.
2. `stats.mjs` — a pure `summarize(tasks, config)`; active vs. archived
   according to configuration, not by status name.
3. `stats-report.mjs` — reads `tasks/*.md` (not the views — those are
   gitignored) and formats it; `--json`.
4. `init-backlog.mjs` — generic templates (`config.yaml`, `boards.yaml`,
   `_template.md`, `.gitignore`, `.gitattributes`) plus directories.
5. Register both in the `cli.mjs` command table.

## Acceptance criteria

- [x] `worktrail init --dir <empty>` produces a backlog on which `build`,
      `check`, and `stats` pass — checked both as a test and manually.
- [x] `init` does not overwrite an existing file, does not touch existing
      tasks, and running it twice in a row is a no-op.
- [x] `init` without `--dir` FAILS instead of guessing the directory.
- [x] Generic templates — the test passes on the origin project's vocabulary
      (`pre-launch`, `founder`, `data-gated`, `backlog-project`).
- [x] `stats` computes from configuration: an unused status shows ZERO
      instead of vanishing (a missing row reads as "I didn't check").
- [x] An unparsable estimate gives `null`, never zero, and the report shows
      HOW MANY tasks it could not count.
- [x] Numbers cross-checked against an independent source: `stats` 342/1013
      and `query --count` 342/1013; `blocked` 12 in both.
- [x] The viewer no longer has its own copy of estimate conversion; the
      regex was checked in the exact form it reaches the browser (run, not
      just grepped).
- [x] 19 tests in `init-stats.test.mjs`; full suite 169 green.

## Notes

**A naming fix after checking the result:** the first version of the report
had a row "blocked: 79" right under the `blocked: 12` status. Two different
things under one name force the reader to guess which one they're looking
at — the row is now named "waiting on other tasks (non-empty `blocked_by`)."

**Still out of scope:** extracting `computeDashboard`, per-command `--help`
built from the table's `usage`, `worktrail new` (creating a task from the
template plus a number from `next-id`).

## Log

- 2026-08-29 created — claude — closing out the commands deferred in TL-22
- 2026-08-29 done — claude — init + stats; the copy of estimate conversion
  removed from the viewer along the way
