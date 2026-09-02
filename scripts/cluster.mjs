/**
 * Heartbeats → minutes (TL-28).
 *
 * WE DO NOT RECORD TIME, WE DERIVE IT — the same way `INDEX.yaml` is derived
 * from the task files and `estimateHours()` from the estimate text. §6 of
 * docs/backlog-time-tracking.md (a real path — product-name: allow) states the
 * definition this file implements:
 *
 *   cluster  := the longest run of heartbeats in ONE session whose neighbours
 *               are no further apart than `idle_gap_minutes`
 *   minutes  := Σ (last(cluster) − first(cluster))
 *
 * THREE RULES, EACH OF WHICH IS A PLACE A COUNTER OF THIS KIND QUIETLY LIES:
 *
 *   1. A ONE-HEARTBEAT CLUSTER IS ZERO MINUTES, counted separately rather than
 *      rounded up to a "nominal five minutes". A nominal figure is invention
 *      proportional to how fine-grained the work was, so the finest-grained
 *      sessions would be the most inflated ones. The count is reported so the
 *      throttling threshold can later be settled with data (§14 point 4).
 *   2. A GAP EXACTLY AT THE THRESHOLD CONTINUES THE CLUSTER — `<=`, decided
 *      here and pinned by a test rather than left to whichever comparison
 *      somebody typed. Either answer is defensible; an undecided one is not.
 *   3. PARALLEL SESSIONS SUM. Two agents for half an hour each is sixty minutes
 *      of effort and thirty minutes of calendar time, and those answer two
 *      different questions, so the report carries both. Clustering is therefore
 *      per SESSION: merging the rows of two sessions into one run would count
 *      the pair once and call it half.
 *
 * WHY AN INTERVAL IS ATTRIBUTED BY THE ROW THAT CLOSES IT. Minutes belong to
 * clusters, attributions belong to rows, and a cluster may hold rows the chain
 * settled differently. Splitting the cluster's minutes proportionally would be
 * invention; crediting the whole cluster to one row's attribution would be a
 * guess about the others. Each gap between two consecutive heartbeats is
 * credited to the LATER of the two — the row that is evidence the interval was
 * worked — and the parts then sum exactly to the cluster.
 *
 * PURE, and deliberately so: no disk access and no imports outside this module,
 * the same constraint `estimate.mjs` holds to, so it can be pasted into the
 * viewer by source when the dashboard needs the same arithmetic.
 *
 * Tests: `node --test scripts/tests/cluster.test.mjs`
 */

/** The default from §6, and the least justified number in the design (§14
 *  point 3): it comes from WakaTime practice, not from a measurement on this
 *  data. `idle_gap_minutes` in config.yaml is what a project actually sets. */
export const DEFAULT_IDLE_GAP_MINUTES = 10;

/** `unknown` is not a leg of the chain that failed, it is the answer the chain
 *  gives when no leg fired (§8.2). Named here because the ratio computed below
 *  is the whole point of reporting it. */
const UNKNOWN = "unknown";

function millis(row) {
  const t = Date.parse((row && row.ts) || "");
  return Number.isNaN(t) ? null : t;
}

/**
 * Rows in the order they happened, with the undatable ones dropped.
 *
 * OUT-OF-ORDER INPUT IS NORMAL, not corruption: the log is append-only across
 * parallel sessions and a reader may concatenate two files. Sorting here is why
 * shuffled input gives the same answer as sorted input — the property the
 * acceptance criteria pin, because a clusterer that trusted file order would
 * silently split one run into many.
 */
function chronological(rows) {
  return (rows || [])
    .map((row) => ({ row, at: millis(row) }))
    .filter((r) => r.at !== null)
    .sort((a, b) => a.at - b.at)
    .map((r) => ({ ...r.row, at: r.at }));
}

/**
 * The clusters, one list per session, oldest first.
 *
 * @param {Array<{ts: string, session?: string, attribution?: string}>} rows
 * @param {{idleGapMinutes?: number}} opts
 * @returns {Array<{session: string, from: string, to: string, count: number,
 *                  minutes: number, single: boolean,
 *                  minutesByAttribution: Record<string, number>}>}
 */
export function clusterHeartbeats(rows, opts = {}) {
  const gapMs =
    (opts.idleGapMinutes === undefined ? DEFAULT_IDLE_GAP_MINUTES : opts.idleGapMinutes) * 60000;

  const bySession = new Map();
  for (const row of chronological(rows)) {
    // A row with no session is its own scope, not everybody's. Folding the
    // sessionless rows together would merge two hosts that never met.
    const key = String(row.session || "");
    if (!bySession.has(key)) bySession.set(key, []);
    bySession.get(key).push(row);
  }

  const clusters = [];
  for (const [session, rowsOfSession] of bySession) {
    let current = null;
    for (const row of rowsOfSession) {
      // Rule 2: `<=`, so a gap exactly at the threshold continues the cluster.
      if (current && row.at - current.last <= gapMs) {
        current.count++;
        // The interval is credited to the row that CLOSES it — see the header.
        const key = String(row.attribution || UNKNOWN);
        current.minutesByAttribution[key] =
          (current.minutesByAttribution[key] || 0) + (row.at - current.last) / 60000;
        current.last = row.at;
        continue;
      }
      if (current) clusters.push(current);
      current = { session, first: row.at, last: row.at, count: 1, minutesByAttribution: {} };
    }
    if (current) clusters.push(current);
  }

  return clusters
    .sort((a, b) => a.first - b.first || a.session.localeCompare(b.session))
    .map((c) => ({
      session: c.session,
      from: new Date(c.first).toISOString(),
      to: new Date(c.last).toISOString(),
      count: c.count,
      // Rule 1: a single heartbeat spans nothing, so it is zero — which falls
      // out of the arithmetic rather than being special-cased, and `single`
      // carries the fact to the report.
      minutes: (c.last - c.first) / 60000,
      single: c.count === 1,
      minutesByAttribution: c.minutesByAttribution,
    }));
}

/**
 * The union of a set of intervals, in minutes. PURE.
 *
 * WHY CALENDAR TIME IS A UNION AND NOT `last − first`. Two sessions half an hour
 * each, an hour apart, span ninety minutes end to end — but nobody worked for
 * ninety minutes and nothing was happening in the middle. `last − first` would
 * quietly readmit the idle gaps that clustering exists to remove. The union
 * answers the question that was actually asked: how much wall-clock time had
 * work happening in it.
 */
export function unionMinutes(intervals) {
  const sorted = (intervals || []).slice().sort((a, b) => a[0] - b[0]);
  let total = 0;
  let start = null;
  let end = null;
  for (const [from, to] of sorted) {
    if (start === null) { start = from; end = to; continue; }
    if (from <= end) { end = Math.max(end, to); continue; }
    total += end - start;
    start = from;
    end = to;
  }
  if (start !== null) total += end - start;
  return total / 60000;
}

const round = (n) => Math.round(n * 10) / 10;

/**
 * Engaged time for ONE task's rows. PURE.
 *
 * `unknownRatio` IS ALWAYS PRESENT, INCLUDING WHEN IT IS ZERO (§8.2). A sum
 * printed without it is a metric asserting its own trustworthiness; the same
 * principle as `sumHours()` returning `{hours, unknown}` rather than a number
 * that has quietly dropped what it could not count. With no minutes measured
 * the ratio is 0 and not `null`: nothing was attributed wrongly, because
 * nothing was attributed at all.
 *
 * @returns {{minutes: number, calendarMinutes: number, sessions: number,
 *            clusters: number, singles: number, first: string|null,
 *            last: string|null, minutesByAttribution: Record<string, number>,
 *            unknownMinutes: number, unknownRatio: number}}
 */
export function engagedTime(rows, opts = {}) {
  const clusters = clusterHeartbeats(rows, opts);
  const byAttribution = {};
  let minutes = 0;
  for (const c of clusters) {
    minutes += c.minutes;
    for (const [key, value] of Object.entries(c.minutesByAttribution)) {
      byAttribution[key] = (byAttribution[key] || 0) + value;
    }
  }
  const unknownMinutes = byAttribution[UNKNOWN] || 0;
  const sessions = new Set(clusters.map((c) => c.session));
  const spans = clusters.map((c) => [Date.parse(c.from), Date.parse(c.to)]);

  return {
    // Effort: the sum over clusters, so two parallel sessions add up (rule 3).
    minutes: round(minutes),
    // Calendar: the union of the same intervals, so they do not.
    calendarMinutes: round(unionMinutes(spans)),
    sessions: sessions.size,
    clusters: clusters.length,
    singles: clusters.filter((c) => c.single).length,
    first: clusters.length ? clusters[0].from : null,
    last: clusters.length ? clusters.reduce((a, c) => (c.to > a ? c.to : a), clusters[0].to) : null,
    minutesByAttribution: Object.fromEntries(
      Object.entries(byAttribution).map(([k, v]) => [k, round(v)])
    ),
    unknownMinutes: round(unknownMinutes),
    unknownRatio: minutes > 0 ? Math.round((unknownMinutes / minutes) * 1000) / 1000 : 0,
  };
}

/**
 * Engaged time across many tasks, plus the totals a report leads with. PURE —
 * it is handed a map of task id → rows, so nothing here reads the disk.
 *
 * THE TOTAL RATIO IS COMPUTED FROM MINUTES, NOT AVERAGED OVER TASKS. A mean of
 * per-task ratios gives a one-minute task the same weight as a one-week task,
 * which is how a project with one badly attributed scratch task ends up
 * reporting that most of its time is unattributed.
 */
export function engagedReport(rowsByTask, opts = {}) {
  const tasks = [];
  let minutes = 0;
  let unknownMinutes = 0;
  let singles = 0;
  const spans = [];

  for (const id of Object.keys(rowsByTask || {}).sort()) {
    const stats = engagedTime(rowsByTask[id], opts);
    if (!stats.clusters) continue;
    tasks.push({ task: id, ...stats });
    minutes += stats.minutes;
    unknownMinutes += stats.unknownMinutes;
    singles += stats.singles;
    for (const c of clusterHeartbeats(rowsByTask[id], opts)) {
      spans.push([Date.parse(c.from), Date.parse(c.to)]);
    }
  }

  return {
    tasks: tasks.sort((a, b) => b.minutes - a.minutes),
    minutes: round(minutes),
    calendarMinutes: round(unionMinutes(spans)),
    singles,
    unknownMinutes: round(unknownMinutes),
    unknownRatio: minutes > 0 ? Math.round((unknownMinutes / minutes) * 1000) / 1000 : 0,
  };
}
