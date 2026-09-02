---
id: TL-29
title: "Estimate calibration from real data"
type: code
labels: [post-launch]
board: main
epic: "Backlog — work time measurement"
priority: P3
status: done
owner: agent:claude
estimate: 4h
confidence: medium
created: 2026-08-30
updated: 2026-09-02
blocked_by: [TL-28]
blocks: [TL-88]
related_docs:
  - docs/backlog-time-tracking.md
verification:
  # The paths are `scripts/…`, not `backlog/scripts/…`. This task was written
  # before the extraction, when code and data were co-located; the contract
  # inherited that layout and would have failed on a path, not on the work.
  - id: calibration-fixtures
    bash: "node --test scripts/tests/calibration.test.mjs"
  - id: correlation-gate
    bash: "node scripts/cli.mjs stats --calibration --correlation-only"
  - id: rollup-merge
    bash: "node --test scripts/tests/rollup-merge.test.mjs"
  - id: one-source
    bash: "node scripts/build-viewer.mjs >/dev/null && grep -q 'function calibrate' backlog/viewer.html"
  - id: gate-recorded
    bash: "grep -q 'Result (2026-09-02, TL-29)' docs/backlog-time-tracking.md"
  - id: privacy-split
    bash: "git check-ignore -q backlog/activity/TL-29.jsonl && ! git check-ignore -q backlog/activity/rollup/TL-29.json"
---

## Goal

Turn the collected minutes into a number that actually improves estimation:
the distribution of real time **per estimate bucket**, with an explicit
reliability threshold — or a proven conclusion that such calibration is
worthless.

## Context

1019 closed tasks have an estimate and no verification. `confidence: medium`
today means "that's how it felt" and after a year it still means the same
thing.

The value is not in the sentence "TL-27 took 3 h" — a single task says
nothing. It is in the distribution: *tasks estimated at 2 h land between 1.4
and 4.1 h, median 2.6, n=23*. Only that changes the next estimate.

**Step 0 is a gate, not a formality.** Estimates were written in the frame of
"how long this would take a human", and we are measuring an AI agent's clock.
It is possible there is no correlation at all (§14 point 1 of the document).
The check is cheap — spread within a bucket versus difference between buckets
— and it must happen **before** building the report, so as not to build a
nice table over noise.

Three report rules from §11, all about the same thing: **do not pretend to
know what is not known.**

1. Below the `n` threshold (default 8, from `config.yaml`) the report writes
   "not enough data", not a number.
2. Always a range, never a point — "2h tasks take 2.6 h" is falsely precise.
3. Breakdowns (board, `type`, `owner`) only where EVERY cell meets the
   threshold.

The calendar helps: the distribution of estimates among closed tasks is
`1d`=259, `2h`=238, `4h`=201, `3h`=105, `1h`=62 at ~95 closures per week, so the
top five buckets will reach `n=8` **within a few days** of TL-28 going live.
The tail (`1w`, `2d`, `15m`) will never fill up and is meant to report "not
enough data" permanently.

## Pre-flight reading

1. `docs/architecture/backlog-time-tracking.md` — §11 (calibration, three
   rules), §11.1 (when the buckets will fill up), §14 point 1 (the assumption
   this task is to resolve).
2. `backlog/scripts/estimate.mjs` — `estimateHours()` and the contract "`null`,
   never zero". Buckets must use THIS function, not their own parser.
3. `backlog/scripts/stats.mjs` + `stats-report.mjs` — the separation of
   arithmetic from formatting. Calibration follows the same boundary.
4. `backlog/scripts/build-viewer.mjs` — the pattern of pasting a module as the
   SOURCE into the viewer (`task-fields.mjs`, `estimate.mjs`), so the dashboard
   and the terminal cannot give two different numbers.

## Steps

0. **Correlation gate.** `worktrail stats --calibration --correlation-only`:
   compute the spread within buckets versus the difference between bucket
   medians and print a verdict. If the internal spread dominates — **stop**,
   add the conclusion to §14 point 1 and do not build the rest. A negative
   measurement result is still a result.
1. `backlog/scripts/calibration.mjs` — a PURE function: a list of
   `{estimate, actual_minutes}` → buckets with `n`, median, p80, and a `bias`
   coefficient. No disk access, no imports outside `estimate.mjs`.
2. The `n` threshold from configuration; below the threshold a bucket returns
   `{n, insufficient: true}` — not `null` and not zero.
3. `activity/rollup/BL-NNNN.json` — a versioned aggregate **per task**
   (`minutes`, `sessions`, `first`, `last`, `unknown_ratio`), generated from
   the raw logs. This IS the consumer of the privacy trade-off from §9: raw
   timestamps stay local, calibration travels in the repo. **Never a single
   aggregate file** — an aggregate file would be a second `INDEX.yaml` and
   would bring back the conflict measured in TL-21 (§5.2).
4. `worktrail stats --calibration` — a table of buckets in the terminal.
5. An "actual" column in the viewer for `done` tasks, read from the rollup.
6. A hint when creating a task: `worktrail new --estimate 2h` prints that
   bucket's calibration, provided it is above the threshold.
7. `calibration.test.mjs` tests — red-first, test author ≠ code author. **On
   fixtures, not on the backlog's production data** (an assertion about real
   data changes its own verdict as more data arrives).

## Acceptance criteria

- [x] Step 0 carried out and its result recorded in §14 point 1 of the
      document — regardless of whether the outcome was positive. [proof: gate-recorded, correlation-gate]
- [x] A bucket with `n` below the threshold reports "not enough data", not a
      number — tested on a FIXTURE. [proof: calibration-fixtures]
- [x] The report gives a range (p20–p80 or min–max), not just the median. [proof: calibration-fixtures]
- [x] A breakdown per board/type/owner appears only when every cell meets the
      threshold. [proof: calibration-fixtures]
- [x] Tasks WITHOUT measured time are counted separately and visible in the
      report. [proof: calibration-fixtures]
- [x] The aggregate is per task (`rollup/TL-NNN.json`) and versioned; the raw
      `activity/*.jsonl` files still are not. [proof: privacy-split, rollup-merge]
- [x] Two branches touching DIFFERENT tasks do not produce a conflict in the
      rollup — there is a test for this (`git merge-tree`), because that is
      the whole point of the per-task split. [proof: rollup-merge]
- [x] The viewer and the terminal give the same number for the same task
      (module pasted as source, not a second implementation). [proof: one-source]
- [x] `worktrail new --estimate 2h` does not print calibration when the bucket
      is below the threshold. [proof: calibration-fixtures]
- [x] No gate in Verification asserts a property of the PRODUCTION data (it
      passes the same way on a sparse and on a rich backlog). [proof: correlation-gate]

## Verification

The runnable contract is `verification:` in the frontmatter; this is the same
list in prose. The paths lost their `backlog/` prefix: they were written while
code and data were co-located, and after the extraction the code lives in
`scripts/` (CLAUDE.md, "Before you change the code").

```bash
# 1. Calibration tests on fixtures — expected: pass, including a bucket below the threshold
node --test scripts/tests/calibration.test.mjs

# 2. Correlation gate — expected: a verdict (positive, negative or `insufficient`), exit code 0
node scripts/cli.mjs stats --calibration --correlation-only

# 3. The rollup does not conflict between branches touching different tasks — expected: no
#    conflict, AND the positive control (one shared file) conflicts
node --test scripts/tests/rollup-merge.test.mjs

# 4. A single source for the number — expected: the calibration module present in the built viewer
node scripts/build-viewer.mjs && grep -q 'function calibrate' backlog/viewer.html

# 5. Privacy preserved — expected: raw data outside git, aggregate in git
git check-ignore -q backlog/activity/TL-29.jsonl && ! git check-ignore -q backlog/activity/rollup/TL-29.json

# 6. Step 0's result is recorded in the document, not only in a terminal
grep -q 'Result (2026-09-02, TL-29)' docs/backlog-time-tracking.md
```

## Notes

- Regression/predictive modeling is deliberately OUT of scope — median and p80
  per bucket is all that an `n` in the tens can justify.
- If step 0 comes out negative, this task ends with a conclusion and a
  closing, and tokens (TL-30) become the axis of calibration. That is a
  foreseen ending, not a failure.

## Log

- 2026-08-30 created — claude — drafted from the time-tracking analysis (docs/architecture/backlog-time-tracking.md)
- 2026-08-30 revised — claude — after adversarial review: per-task aggregate instead of a single `rollup.json` (which would bring back the conflict measured in TL-21), correlation gate as step 0, tests on fixtures instead of assertions about production data
