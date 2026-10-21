/**
 * Agent time per estimate bucket, computed from the task ledger (TL-480).
 *
 * WHAT THIS ANSWERS. An estimate here is written in the frame of "how long would
 * this take a person", and most of the work is done by agents. The question is
 * what an estimate is worth for THAT executor: tasks estimated at 2h land
 * between 3 and 13 minutes of agent time, median 7, n=209. One task says
 * nothing; the distribution is the only thing that can change the next
 * estimate.
 *
 * WHERE THE NUMBER COMES FROM, AND WHY THAT MATTERS. TL-378 removed a subsystem
 * that COLLECTED working time (heartbeats, sessions, rollups) and that stays
 * removed. This module collects nothing: it reads the status records that
 * `backlog/history/` already keeps, because every claim and every closing is a
 * change of state that has to travel with its reason. The decision and its
 * limits are written down in docs/backlog-time-tracking.md, "Agent time from
 * the task ledger".
 *
 * WHAT IS MEASURED. The sum of the segments a task spent in the in-progress
 * status, each from its `-> in_progress` record to the next status record. A
 * handoff adds a segment instead of erasing the first; `blocked` and
 * `awaiting_vouch` are outside every segment because there the task waits on
 * something other than the agent. A segment over `capHours` cannot be told
 * apart from a claim left open overnight, so the task becomes an OUTLIER —
 * named, and kept out of every bucket rather than averaged in.
 *
 * WHO IS MEASURED. Only segments claimed by an actor in the `agent:` namespace.
 * A task with any segment claimed by somebody else is `mixed`: timing its agent
 * half alone would understate it, and timing the person would turn this into
 * the per-actor measurement TL-378 removed. The unit is the task, never the
 * actor — there is deliberately no breakdown by owner.
 *
 * THE REPORT RULES ARE TL-29's, ALL THE SAME RULE: do not pretend to know what
 * is not known. Below `minN` a bucket is `insufficient` and carries no number;
 * a bucket is a p20–p80 range with its median, never a ratio to the estimate
 * (measured medians moved about 2x across a 16x range of estimates, so a
 * multiplier would be false); what could not be measured is counted beside the
 * table; and a correlation verdict says whether the buckets separate at all.
 *
 * PURE, AND NO IMPORT BUT `estimate.mjs`: the arithmetic is testable without a
 * directory, and the disk read lives with the commands that print.
 *
 * Tests: `node --test scripts/tests/agent-time.test.mjs`
 */

import { estimateHours } from "./estimate.mjs";

/** The fallbacks a caller with no configuration gets; the values in force come
 *  from `agent_time_min_n` and `agent_time_segment_cap` in config.yaml. */
export const DEFAULT_MIN_N = 8;
export const DEFAULT_SEGMENT_CAP = "8h";

const AGENT_NAMESPACE = "agent:";

/** Sorted ascending; `p` in 0..100, linear interpolation between neighbours. */
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
 * A bucket's name, derived from its hours. Keyed by hours rather than by the
 * frontmatter string, because `2h` and `120m` are one estimate written twice
 * and splitting them would halve both samples.
 */
export function bucketLabel(hours) {
  if (!(hours > 0)) return "—";
  if (hours < 1) return trim(hours * 60) + "m";
  if (hours < 8) return trim(hours) + "h";
  if (hours < 40) return trim(hours / 8) + "d";
  return trim(hours / 40) + "w";
}

function trim(n) {
  return String(Math.round(n * 100) / 100);
}

/** Minutes the way a range is read: `7m`, `1h 05m`. */
export function minutesLabel(minutes) {
  if (minutes == null || !isFinite(minutes)) return "—";
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return m + "m";
  return h + "h" + (m ? " " + String(m).padStart(2, "0") + "m" : "");
}

/**
 * The in-progress segments of one task's ledger, in time order.
 *
 * `open` is true when the last segment has no record ending it: the task is
 * still being worked, or its ledger disagrees with its file — either way there
 * is no interval to report.
 */
export function agentSegments(records, opts) {
  const inProgress = opts.inProgressStatus;
  const changes = (records || [])
    .filter((r) => r && r.field === "status" && typeof r.ts === "string" && isFinite(Date.parse(r.ts)))
    .slice()
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const segments = [];
  let current = null;
  for (const r of changes) {
    if (current) {
      const end = Date.parse(r.ts);
      segments.push({ start: current.ts, end: r.ts, actor: current.actor, minutes: (end - Date.parse(current.ts)) / 60_000 });
      current = null;
    }
    if (r.to === inProgress) current = { ts: r.ts, actor: String(r.actor || "") };
  }
  return { segments, open: current !== null };
}

/**
 * One task's reading: `measured` with its minutes, or the reason it is not.
 *
 *   unestimated  no countable estimate — it cannot be bucketed at all
 *   unmeasured   no agent segment, or a segment still open
 *   mixed        at least one segment claimed outside the `agent:` namespace
 *   outlier      a segment longer than the cap
 *   skipped      not closed into the measured status (not counted anywhere)
 */
export function measureTask(task, records, opts) {
  if (!task || task.status !== opts.closedStatus) return { kind: "skipped" };
  const hours = estimateHours(task.estimate);
  if (hours == null || !(hours > 0)) return { kind: "unestimated" };
  const { segments, open } = agentSegments(records, opts);
  if (open || !segments.length) return { kind: "unmeasured", hours };
  const byAgent = segments.filter((s) => s.actor.startsWith(AGENT_NAMESPACE)).length;
  // No agent segment at all is a task this report never saw, not a mixed one.
  if (!byAgent) return { kind: "unmeasured", hours };
  if (byAgent < segments.length) return { kind: "mixed", hours };
  const capMinutes = opts.capHours * 60;
  if (segments.some((s) => s.minutes > capMinutes)) return { kind: "outlier", hours };
  const minutes = segments.reduce((sum, s) => sum + s.minutes, 0);
  // A zero-length interval is a claim and a closing in the same write — a
  // record of a status, not of work — and averaging it in would drag every
  // bucket towards the speed of the tool rather than of the agent.
  if (!(minutes > 0)) return { kind: "unmeasured", hours };
  return { kind: "measured", hours, minutes };
}

/**
 * STEP 0 of TL-29, unchanged in shape: is the spread WITHIN a bucket smaller
 * than the difference BETWEEN buckets? Fewer than two buckets over the
 * threshold is the third answer, `insufficient` — the gate has not been run,
 * not failed.
 */
function correlate(solid, minN) {
  if (solid.length < 2) {
    return {
      verdict: "insufficient", within: null, between: null, ratio: null, monotonic: null,
      reason: "fewer than two buckets reach n=" + minN + " — the gate cannot be answered yet",
    };
  }
  const within = solid.reduce((sum, b) => sum + (b.p80 - b.p20), 0) / solid.length;
  const medians = solid.map((b) => b.median);
  const between = Math.max(...medians) - Math.min(...medians);
  const ratio = within > 0 ? between / within : Infinity;
  let monotonic = true;
  for (let i = 1; i < medians.length; i++) if (medians[i] < medians[i - 1]) monotonic = false;
  return {
    verdict: ratio >= 1 ? "correlated" : "uncorrelated",
    within, between, ratio: isFinite(ratio) ? ratio : null, monotonic,
    reason: ratio >= 1
      ? "the difference between buckets exceeds the spread inside them — the estimate predicts agent time"
      : "the spread inside a bucket outweighs the difference between buckets — not fit for planning",
  };
}

/**
 * The whole report.
 *
 * @param {Array<{id: string, status: string, estimate?: string}>} tasks
 * @param {Record<string, Array<object>>} historyByTask  ledger records per task id
 * @param {{inProgressStatus: string, closedStatus: string, minN?: number, capHours?: number}} opts
 */
export function agentTime(tasks, historyByTask, opts) {
  const minN = opts.minN > 0 ? opts.minN : DEFAULT_MIN_N;
  const capHours = opts.capHours > 0 ? opts.capHours : estimateHours(DEFAULT_SEGMENT_CAP);
  const o = { ...opts, minN, capHours };
  const history = historyByTask || {};

  const byHours = new Map();
  let unestimated = 0;
  let unmeasured = 0;
  let mixed = 0;
  const outliers = [];

  for (const t of tasks || []) {
    const m = measureTask(t, history[t.id] || [], o);
    if (m.kind === "skipped") continue;
    if (m.kind === "unestimated") unestimated++;
    else if (m.kind === "unmeasured") unmeasured++;
    else if (m.kind === "mixed") mixed++;
    else if (m.kind === "outlier") outliers.push(t.id);
    else {
      if (!byHours.has(m.hours)) byHours.set(m.hours, []);
      byHours.get(m.hours).push(m.minutes);
    }
  }

  let measured = 0;
  const buckets = [...byHours.keys()].sort((a, b) => a - b).map((hours) => {
    const values = byHours.get(hours).slice().sort((a, b) => a - b);
    const n = values.length;
    measured += n;
    if (n < minN) return { label: bucketLabel(hours), estimate_hours: hours, n, insufficient: true };
    return {
      label: bucketLabel(hours),
      estimate_hours: hours,
      n,
      insufficient: false,
      p20: percentile(values, 20),
      median: percentile(values, 50),
      p80: percentile(values, 80),
    };
  });

  return {
    minN,
    capHours,
    buckets,
    measured,
    unestimated,
    unmeasured,
    mixed,
    outliers: outliers.sort(),
    verdict: correlate(buckets.filter((b) => !b.insufficient), minN),
  };
}

/**
 * The bucket one estimate falls into, or `null` when it has nothing to say.
 * `null` below the threshold is the point: a hint printed from three samples
 * would be advice with the authority of a measurement.
 */
export function agentTimeHint(report, estimate) {
  const hours = estimateHours(estimate);
  if (hours == null || !report) return null;
  const b = (report.buckets || []).find((x) => x.estimate_hours === hours);
  return b && !b.insufficient ? b : null;
}

/** The one line `new` and `next` print for a bucket that met the threshold. */
export function hintLine(bucket) {
  return "agent time for " + bucket.label + " tasks: " + minutesLabel(bucket.p20) + "–" +
    minutesLabel(bucket.p80) + ", median " + minutesLabel(bucket.median) + " (n=" + bucket.n + ")";
}
