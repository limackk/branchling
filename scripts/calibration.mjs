/**
 * Estimate calibration — the distribution of MEASURED time per estimate bucket
 * (TL-29).
 *
 * WHAT THIS IS FOR. `estimate: 2h` written by hand is unfalsifiable until
 * something says what a 2h task actually cost. The value is never in one
 * sentence ("TL-27 took 3 h") — one task says nothing — it is in the
 * distribution: *tasks estimated at 2h land between 1.4 and 4.1 h, median 2.6,
 * n=23*. Only that changes the next estimate.
 *
 * STEP 0 IS A GATE, NOT A FORMALITY (§14 point 1 of
 * docs/backlog-time-tracking.md — a real path, product-name: allow). The
 * estimates in this tree were written in the frame of "how long would this take
 * a human", and what is measured is an agent's clock. It is possible the two do
 * not correlate at all, in which case a table of medians is a nicely formatted
 * picture of noise. `correlate()` answers that BEFORE `calibrate()` is worth
 * printing, and a negative answer is a result, not a failure.
 *
 * THREE REPORT RULES, ALL THE SAME RULE: do not pretend to know what is not
 * known.
 *   1. Below `minN` a bucket says `insufficient`, never a number. A median of
 *      three observations is a number, not knowledge.
 *   2. Always a RANGE (p20–p80), never a bare point — "2h tasks take 2.6 h" is
 *      falsely precise.
 *   3. A breakdown (board, type, owner) exists only when EVERY cell meets the
 *      threshold; one thin cell disqualifies the whole breakdown, because a
 *      table with a hole in it is read as a table.
 *
 * PURE, AND NO IMPORT BUT `estimate.mjs`. The module is pasted BY SOURCE into
 * the viewer (the pattern of `task-fields.mjs`, `estimate.mjs`, `viewer-url.mjs`),
 * so the browser and the terminal cannot give two different numbers for the same
 * task. Anything reaching for the disk would stop that paste compiling.
 *
 * `percentile()` is written out here rather than imported from `time-report.mjs`
 * for exactly that reason: that module reads `activity/` and prints, and pulling
 * it in would drag `node:fs` into the page.
 *
 * Tests: `node --test scripts/tests/calibration.test.mjs`
 */

import { estimateHours } from "./estimate.mjs";

/**
 * How many samples a bucket needs before it is allowed to state a number.
 *
 * The value in force comes from `min_report_n` in config.yaml; this constant is
 * only what a caller that has no configuration falls back to, so a unit test and
 * the tool agree on the shape of the rule when they disagree about the number.
 */
export const DEFAULT_MIN_N = 8;

/** Sorted ascending; `p` in 0..100. Linear interpolation between neighbours —
 *  with an `n` in the tens the difference from any other convention is far
 *  below the precision this report is allowed to claim. */
export function percentile(sorted, p) {
  if (!sorted || !sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const pos = ((sorted.length - 1) * p) / 100;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * A bucket's name: the estimate it stands for, written the short way.
 *
 * The bucket is keyed by HOURS, not by the string in the frontmatter, because
 * `2h` and `120m` are the same estimate written twice and splitting them would
 * halve both samples. The label is therefore derived, not remembered.
 */
export function bucketLabel(hours) {
  if (!(hours > 0)) return "—";
  if (hours < 1) return Math.round(hours * 60) + "m";
  if (hours < 8) return trim(hours) + "h";
  if (hours < 40) return trim(hours / 8) + "d";
  return trim(hours / 40) + "w";
}

function trim(n) {
  return String(Math.round(n * 100) / 100);
}

/**
 * A sample enters a bucket only if BOTH numbers exist.
 *
 * `minutes: 0` is deliberately not a measurement of zero work: §6 rule 1 gives a
 * single-heartbeat cluster zero minutes, so a zero means "nothing lasted long
 * enough to be counted", and averaging that in would drag every bucket towards a
 * number produced by the throttling window rather than by the work.
 */
function usable(s) {
  const est = estimateHours(s && s.estimate);
  const min = s && s.actual_minutes;
  if (est == null || !(est > 0)) return null;
  if (typeof min !== "number" || !isFinite(min) || min <= 0) return null;
  return { hours: est, actual: min / 60 };
}

/**
 * The buckets, plus everything that did NOT make it into one.
 *
 * The two counts beside the table are not decoration. A calibration built from
 * 9 of 141 closed tasks and one built from 130 of 141 look identical once the
 * medians are printed, and they are worth entirely different amounts.
 *
 * @param {Array<{estimate?: string, actual_minutes?: number}>} samples
 * @param {{minN?: number}} opts
 */
export function calibrate(samples, opts = {}) {
  const minN = opts.minN > 0 ? opts.minN : DEFAULT_MIN_N;
  const all = Array.isArray(samples) ? samples : [];

  const byHours = new Map();
  let unestimated = 0;
  let unmeasured = 0;

  for (const s of all) {
    const u = usable(s);
    if (!u) {
      if (estimateHours(s && s.estimate) == null) unestimated++;
      else unmeasured++;
      continue;
    }
    if (!byHours.has(u.hours)) byHours.set(u.hours, []);
    byHours.get(u.hours).push(u.actual);
  }

  const buckets = [...byHours.keys()].sort((a, b) => a - b).map((hours) => {
    const values = byHours.get(hours).slice().sort((a, b) => a - b);
    const n = values.length;
    if (n < minN) return { label: bucketLabel(hours), estimate_hours: hours, n, insufficient: true };
    const med = percentile(values, 50);
    return {
      label: bucketLabel(hours),
      estimate_hours: hours,
      n,
      insufficient: false,
      median: med,
      p20: percentile(values, 20),
      p80: percentile(values, 80),
      // How far the median lands from what was estimated. A multiplier rather
      // than a difference, because that is the shape an estimate is corrected in.
      bias: med / hours,
    };
  });

  return {
    minN,
    buckets,
    measured: all.length - unestimated - unmeasured,
    // Counted apart, and both are reported: a task with no estimate cannot be
    // bucketed at all, a task with no measured time is one this mechanism never
    // saw. Folding them together would hide which of the two is the problem.
    unestimated,
    unmeasured,
  };
}

/**
 * STEP 0. Is the spread WITHIN a bucket smaller than the difference BETWEEN
 * buckets?
 *
 * If it is not, the buckets are one population wearing different labels and no
 * amount of formatting will make a median of them predictive. The measure is
 * deliberately coarse and robust — percentiles, not variance — because the
 * question is "is there a signal at all", and an F statistic over a dozen
 * right-skewed samples would answer a more precise question than the data can
 * support.
 *
 *   within   the mean p20–p80 span of the qualifying buckets
 *   between  the span of their medians
 *   ratio    between / within; at or above 1 the labels separate the data
 *
 * `monotonic` is reported beside it and is not part of the verdict: medians that
 * rise with the estimate are the shape calibration assumes, but a single
 * inversion between two adjacent buckets is well inside the noise an n in the
 * tens carries.
 *
 * `insufficient` — fewer than two buckets over the threshold — is the third
 * answer and the honest one at the start: it says the gate has not been run yet,
 * not that it failed.
 */
export function correlate(samples, opts = {}) {
  const cal = calibrate(samples, opts);
  const solid = cal.buckets.filter((b) => !b.insufficient);
  if (solid.length < 2) {
    return {
      verdict: "insufficient",
      minN: cal.minN,
      buckets: solid.length,
      samples: cal.measured,
      within: null, between: null, ratio: null, monotonic: null,
      reason: "fewer than two buckets reach n=" + cal.minN + " — the gate cannot be answered yet",
    };
  }
  const spans = solid.map((b) => b.p80 - b.p20);
  const within = spans.reduce((a, b) => a + b, 0) / spans.length;
  const medians = solid.map((b) => b.median);
  const between = Math.max(...medians) - Math.min(...medians);
  const ratio = within > 0 ? between / within : Infinity;
  let monotonic = true;
  for (let i = 1; i < medians.length; i++) if (medians[i] < medians[i - 1]) monotonic = false;
  return {
    verdict: ratio >= 1 ? "correlated" : "uncorrelated",
    minN: cal.minN,
    buckets: solid.length,
    samples: cal.measured,
    within, between, ratio, monotonic,
    reason: ratio >= 1
      ? "the difference between buckets exceeds the spread inside them — time is a usable axis"
      : "the spread inside a bucket dominates the difference between buckets — calibrating on time is not worth a report",
  };
}

/**
 * A breakdown by one field, or `null`.
 *
 * `null` and not a partial table: rule 3. A reader shown five solid rows and one
 * thin one compares all six, because a table is read as a table — so the whole
 * breakdown waits until every cell can stand on its own.
 */
export function breakdown(samples, key, opts = {}) {
  const all = Array.isArray(samples) ? samples : [];
  const groups = new Map();
  for (const s of all) {
    if (!usable(s)) continue;
    const k = (s && s[key]) || "—";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }
  if (!groups.size) return null;
  const rows = [];
  for (const k of [...groups.keys()].sort()) {
    const cal = calibrate(groups.get(k), opts);
    if (cal.buckets.some((b) => b.insufficient)) return null;
    rows.push({ value: k, ...cal });
  }
  return rows;
}

/**
 * What one estimate is worth, or `null` when that bucket has nothing to say.
 *
 * Used where an estimate is being WRITTEN (`new --estimate 2h`), which is the
 * only moment the number can still change a decision. `null` below the threshold
 * is the whole point: a hint printed from three samples would be advice with the
 * authority of a measurement.
 */
export function bucketFor(samples, estimate, opts = {}) {
  const hours = estimateHours(estimate);
  if (hours == null) return null;
  const cal = calibrate(samples, opts);
  const b = cal.buckets.find((x) => x.estimate_hours === hours);
  return b && !b.insufficient ? b : null;
}

/** Hours as `2h 36m` — the shape a range is read in. Not `hoursLabel()` from
 *  `estimate.mjs`: that one answers "how much work is queued" in working days,
 *  which is a different question with a different rounding. */
export function spanLabel(hours) {
  if (hours == null || !isFinite(hours)) return "—";
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return m + "m";
  return h + "h" + (m ? " " + String(m).padStart(2, "0") + "m" : "");
}
