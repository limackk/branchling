/**
 * Calibration, and the four ways a report of it becomes a picture of noise
 * (TL-29).
 *
 * ON FIXTURES, NEVER ON THIS BACKLOG'S DATA, and that is the whole reason this
 * file builds its samples by hand. An assertion about the production tree
 * changes its own verdict as data arrives: "the 2h bucket is above the
 * threshold" is true next week and false today, and a suite that goes red
 * because somebody closed a task has stopped measuring the code.
 *
 * WHAT EACH GROUP RULES OUT.
 *   1. A NUMBER FROM TOO LITTLE DATA. Below `minN` a bucket must refuse to say
 *      anything — and the paired case is the same bucket one sample later,
 *      which must speak. A threshold tested only from below passes against code
 *      that has no threshold at all.
 *   2. A POINT PRETENDING TO BE KNOWLEDGE. A median with no range around it is
 *      the shape of a fact and the content of a guess.
 *   3. A TABLE WITH A HOLE IN IT. One thin cell disqualifies a whole breakdown,
 *      because a reader compares the rows of a table whether or not each one
 *      earned its place.
 *   4. A GATE THAT ALWAYS SAYS YES. The correlation verdict is asserted in BOTH
 *      directions on data built to produce each — a gate that cannot return
 *      `uncorrelated` is a formality, and §14 point 1 asked for a measurement.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { breakdown, bucketFor, bucketLabel, calibrate, correlate, percentile, spanLabel } from "../calibration.mjs";

import { isolateHome } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). Nothing here touches the
// disk — the module under test cannot — but the rule is about the FILE, and an
// exception argued case by case is how a guard stops holding.
isolateHome("calibration");

/** `n` samples in one bucket, each `minutes` long. */
function samples(estimate, minutes, n, extra = {}) {
  return Array.from({ length: n }, () => ({ estimate, actual_minutes: minutes, ...extra }));
}

/** A bucket whose samples spread from `lo` to `hi` minutes, evenly. */
function spread(estimate, lo, hi, n, extra = {}) {
  return Array.from({ length: n }, (_, i) => ({
    estimate,
    actual_minutes: lo + ((hi - lo) * i) / (n - 1),
    ...extra,
  }));
}

// ── the threshold ─────────────────────────────────────────────────────────

test("below the threshold a bucket reports insufficient, not a number", () => {
  const cal = calibrate(samples("2h", 150, 7), { minN: 8 });
  assert.equal(cal.buckets.length, 1);
  assert.equal(cal.buckets[0].n, 7);
  assert.equal(cal.buckets[0].insufficient, true);
  assert.equal(cal.buckets[0].median, undefined);
  assert.equal(cal.buckets[0].p80, undefined);
  assert.equal(cal.buckets[0].bias, undefined);
});

test("one sample more and the same bucket speaks", () => {
  const cal = calibrate(samples("2h", 150, 8), { minN: 8 });
  assert.equal(cal.buckets[0].insufficient, false);
  assert.equal(cal.buckets[0].median, 2.5);
});

test("the threshold comes from the caller, not from a constant in the module", () => {
  const cal = calibrate(samples("2h", 150, 3), { minN: 3 });
  assert.equal(cal.buckets[0].insufficient, false);
});

// ── the range ─────────────────────────────────────────────────────────────

test("a bucket that speaks gives a range, not only a median", () => {
  const cal = calibrate(spread("2h", 60, 300, 9), { minN: 8 });
  const b = cal.buckets[0];
  assert.ok(b.p20 < b.median && b.median < b.p80,
    "p20 < median < p80 — a bucket that reports only a point is falsely precise");
  assert.equal(Math.round(b.bias * 100) / 100, Math.round((b.median / 2) * 100) / 100);
});

test("percentiles interpolate and a single sample is its own percentile", () => {
  assert.equal(percentile([1, 2, 3, 4, 5], 50), 3);
  assert.equal(percentile([0, 10], 20), 2);
  assert.equal(percentile([7], 80), 7);
  assert.equal(percentile([], 50), null);
});

// ── what never reached a bucket ───────────────────────────────────────────

test("tasks without measured time are counted apart and stay visible", () => {
  const cal = calibrate([
    ...samples("2h", 150, 8),
    { estimate: "2h" },
    { estimate: "2h", actual_minutes: 0 },
    { estimate: "banana", actual_minutes: 120 },
  ], { minN: 8 });
  assert.equal(cal.measured, 8);
  assert.equal(cal.unmeasured, 2, "no rollup and a zero-minute rollup are both unmeasured");
  assert.equal(cal.unestimated, 1);
});

test("the same estimate written two ways lands in one bucket", () => {
  const cal = calibrate([...samples("2h", 150, 4), ...samples("120m", 150, 4)], { minN: 8 });
  assert.equal(cal.buckets.length, 1);
  assert.equal(cal.buckets[0].n, 8);
  assert.equal(cal.buckets[0].label, "2h");
});

test("bucket labels are derived from hours, in the unit the estimate was written in", () => {
  assert.equal(bucketLabel(0.5), "30m");
  assert.equal(bucketLabel(2), "2h");
  assert.equal(bucketLabel(8), "1d");
  assert.equal(bucketLabel(40), "1w");
});

// ── breakdowns ────────────────────────────────────────────────────────────

test("a breakdown appears only when every cell meets the threshold", () => {
  const thin = [
    ...samples("2h", 150, 8, { board: "main" }),
    ...samples("2h", 150, 3, { board: "side" }),
  ];
  assert.equal(breakdown(thin, "board", { minN: 8 }), null,
    "one thin cell disqualifies the whole table, not just its own row");
});

test("a breakdown whose cells all qualify is returned", () => {
  const solid = [
    ...samples("2h", 150, 8, { board: "main" }),
    ...samples("2h", 90, 8, { board: "side" }),
  ];
  const rows = breakdown(solid, "board", { minN: 8 });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.value), ["main", "side"]);
  assert.equal(rows[0].buckets[0].median, 2.5);
  assert.equal(rows[1].buckets[0].median, 1.5);
});

// ── the correlation gate ──────────────────────────────────────────────────

test("the gate answers `insufficient` while fewer than two buckets qualify", () => {
  const g = correlate(samples("2h", 150, 20), { minN: 8 });
  assert.equal(g.verdict, "insufficient");
  assert.equal(g.ratio, null);
  assert.match(g.reason, /fewer than two buckets/);
});

test("separated buckets with a tight spread are `correlated`", () => {
  const g = correlate([
    ...spread("1h", 55, 65, 9),
    ...spread("4h", 235, 245, 9),
  ], { minN: 8 });
  assert.equal(g.verdict, "correlated");
  assert.ok(g.between > g.within);
  assert.equal(g.monotonic, true);
});

test("buckets that overlap completely are `uncorrelated` — the negative result the gate exists for", () => {
  const g = correlate([
    ...spread("1h", 10, 600, 9),
    ...spread("4h", 10, 600, 9),
  ], { minN: 8 });
  assert.equal(g.verdict, "uncorrelated");
  assert.ok(g.ratio < 1);
  assert.match(g.reason, /not worth a report/);
});

// ── the hint at the moment an estimate is written ─────────────────────────

test("a hint is offered only from a bucket above the threshold", () => {
  const below = samples("2h", 150, 7);
  assert.equal(bucketFor(below, "2h", { minN: 8 }), null);
  const above = samples("2h", 150, 8);
  assert.equal(bucketFor(above, "2h", { minN: 8 }).median, 2.5);
  assert.equal(bucketFor(above, "1d", { minN: 8 }), null, "a bucket with no samples has nothing to say");
  assert.equal(bucketFor(above, "banana", { minN: 8 }), null);
});

test("a span is written in hours and minutes, not in working days", () => {
  assert.equal(spanLabel(2.6), "2h 36m");
  assert.equal(spanLabel(0.5), "30m");
  assert.equal(spanLabel(3), "3h");
  assert.equal(spanLabel(null), "—");
});
