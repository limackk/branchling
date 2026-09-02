#!/usr/bin/env node
/**
 * `time` — what the completion stamps can honestly answer (TL-27).
 *
 * WHAT IT REPORTS, and the boundary is the point: lead time and throughput,
 * both computable from a task's `created:` date and the instant it was closed.
 * NOT engaged time — nothing in this repository yet records how long anybody
 * actually worked, and a number derived from calendar spans would read exactly
 * like one that did. That measurement starts at the first heartbeat and is
 * TL-28's; everything before it is a hole, and this report counts the hole
 * rather than filling it.
 *
 * WHY THE UNSTAMPED COUNT IS MANDATORY. A median over the tasks that happen to
 * have data, printed without saying how many did not, is a sum pretending to be
 * complete. It is the same rule `sumHours()` follows for estimates: report what
 * could not be counted, in the same breath as what could.
 *
 * LEAD TIME'S START HAS A DAY'S RESOLUTION, because `created:` does. It is said
 * on the report rather than left for somebody to discover: a task created and
 * closed on the same day shows as zero, and 71% of this backlog's tasks were
 * (§2 of docs/backlog-time-tracking.md — a real path, product-name: allow).
 *
 * Exit: 0 = reported · 2 = the invocation was wrong.
 *
 * Tests: `node --test scripts/tests/activity.test.mjs`
 */

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { listActivityTasks, readActivity } from "./activity.mjs";
import { engagedReport } from "./cluster.mjs";
import { loadConfigOrExit } from "./config.mjs";
import { printJson } from "./json-envelope.mjs";
import { backlogPaths, resolveBacklogDir, takeDirFlag } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { readTaskRecords } from "./task-select.mjs";
import { MARK, color, failure, heading, table } from "./ui.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const KNOWN_FLAGS = ["--json", "--engaged", "--dir"];

/**
 * Which rows are evidence that somebody was AT THE KEYBOARD (TL-28).
 *
 * `commit` is excluded, and the reason is specific rather than tidy: almost
 * every `commit` row in existence was BACKFILLED out of git by
 * `backfill-completions`, which reconstructs an instant after the fact. A
 * reconstructed stamp is evidence about a file, not about a person's presence,
 * and admitting it would give every closed task a cluster of one — inflating
 * the count of single-heartbeat clusters, which is the number §14 point 4 wants
 * to settle the throttling threshold with.
 *
 * `reassign` is excluded because it is a CORRECTION to attribution (TL-31), not
 * activity: counting it would make fixing a mistake look like doing more work.
 */
export const HEARTBEAT_KINDS = ["tool", "prompt", "edit"];

/** The nearest-rank percentile, on a sorted array. PURE.
 *  Nearest-rank rather than interpolation: with a handful of tasks an
 *  interpolated p95 is a number no task actually took. */
export function percentile(sorted, p) {
  if (!sorted.length) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
}

/** The ISO week a date falls in, as `YYYY-Www`. PURE. */
export function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // Thursday decides the year, which is what makes the last days of December
  // belong to week 1 of the next year instead of week 53 of a year they end.
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - start) / 86400000 + 1) / 7);
  return d.getUTCFullYear() + "-W" + String(week).padStart(2, "0");
}

/**
 * The whole answer, as data. PURE — it is handed the tasks and their stamps.
 *
 * @param {Array<{id: string, status: string, created: string}>} tasks
 * @param {(id: string) => string|null} stampFor  the completion instant, or null
 * @param {{archivedStatuses: string[]}} config
 */
export function timeStats(tasks, stampFor, config) {
  const archived = new Set(config.archivedStatuses || []);
  const closed = tasks.filter((t) => archived.has(t.status));
  const leadDays = [];
  const perWeek = new Map();
  const unstamped = [];

  for (const task of closed) {
    const ts = stampFor(task.id);
    if (!ts) { unstamped.push(task.id); continue; }
    const finished = new Date(ts);
    const week = isoWeek(finished);
    perWeek.set(week, (perWeek.get(week) || 0) + 1);
    const created = Date.parse(task.created || "");
    if (Number.isNaN(created)) continue;
    leadDays.push(Math.max((finished.getTime() - created) / 86400000, 0));
  }

  const sorted = leadDays.slice().sort((a, b) => a - b);
  const weeks = [...perWeek.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return {
    closed: closed.length,
    completed: closed.length - unstamped.length,
    unstamped,
    leadTimeDays: {
      n: sorted.length,
      median: percentile(sorted, 50),
      p80: percentile(sorted, 80),
      p95: percentile(sorted, 95),
    },
    throughput: weeks.map(([week, count]) => ({ week, count })),
    perWeekMean: weeks.length
      ? weeks.reduce((sum, [, c]) => sum + c, 0) / weeks.length
      : null,
  };
}

const day = (v) => (v === null ? "—" : (Math.round(v * 10) / 10) + "d");

/** The text answer. PURE, so a test reads it without a terminal. */
export function renderTime(stats, config, opts = {}) {
  const paint = opts.color || color;
  const out = [];
  out.push(heading((config.projectName || "Backlog") + " — time", { color: paint }));
  out.push("");
  out.push(table([
    ["  closed tasks", String(stats.closed)],
    ["  with a completion stamp", String(stats.completed)],
    ["  without one", String(stats.unstamped.length)],
  ]));
  out.push("");
  out.push("  lead time, created → closed (the start has a DAY's resolution):");
  out.push(table([
    ["    median", day(stats.leadTimeDays.median)],
    ["    p80", day(stats.leadTimeDays.p80)],
    ["    p95", day(stats.leadTimeDays.p95)],
    ["    measured on", stats.leadTimeDays.n + " task(s)"],
  ]));
  out.push("");
  if (stats.throughput.length) {
    out.push("  throughput, tasks closed per week:");
    out.push(table(stats.throughput.slice(-8).map((w) => ["    " + w.week, String(w.count)])));
    out.push("  " + paint.dim("mean " + (Math.round(stats.perWeekMean * 10) / 10) + " per week over " +
      stats.throughput.length + " week(s)"));
  } else {
    out.push("  " + paint.dim("no completion stamps yet — run `" + N + " backfill-completions`"));
  }
  if (stats.unstamped.length) {
    out.push("");
    out.push("  " + paint.warn(MARK.warn) + " " + stats.unstamped.length +
      " closed task(s) have no stamp and are outside every number above");
  }
  out.push("");
  out.push("  " + paint.dim("This is calendar time, not time worked. `--engaged` reports the measured"));
  out.push("  " + paint.dim("time at the keyboard, from the heartbeats in `activity/`."));
  return out.join("\n");
}

const mins = (v) => (v >= 60 ? (Math.round((v / 60) * 10) / 10) + "h" : Math.round(v) + "m");

/**
 * The engaged-time section. PURE, so a test reads it without a terminal.
 *
 * THE UNATTRIBUTED SHARE IS PRINTED BEFORE THE TASK TABLE, not after it. §8.2
 * makes it a first-class number for a reason: a reader who sees the per-task
 * minutes first has already believed them by the time a footnote says 60% of
 * the time could not be placed. The order is the argument.
 *
 * SO IS THE COUNT OF SINGLE-HEARTBEAT CLUSTERS. Those are runs that measured
 * zero minutes by rule 1 of §6 — real work that fell below the resolution the
 * throttle allows. It is printed because §14 point 4 says the throttling window
 * has to be settled from this number rather than from an opinion, and a number
 * nobody prints is a number nobody will settle anything with.
 */
export function renderEngaged(engaged, opts = {}) {
  const paint = opts.color || color;
  const out = [];
  out.push("");
  out.push("  engaged time, measured from heartbeats:");
  if (!engaged.tasks.length) {
    out.push("  " + paint.dim("no heartbeats recorded yet — nothing has been measured."));
    out.push("  " + paint.dim("Rows arrive from `" + N + " activity record`, wired to whatever host you use."));
    return out.join("\n");
  }
  out.push(table([
    ["    effort (sessions summed)", mins(engaged.minutes)],
    ["    calendar (sessions merged)", mins(engaged.calendarMinutes)],
    ["    unattributed share", (engaged.unknownRatio * 100).toFixed(1) + "% (" + mins(engaged.unknownMinutes) + ")"],
    ["    runs too short to measure", String(engaged.singles)],
  ]));
  out.push("");
  out.push(table(engaged.tasks.slice(0, 12).map((t) => [
    "    " + t.task,
    mins(t.minutes) + "  " + t.sessions + " session(s)" +
      (t.unknownRatio > 0 ? "  " + (t.unknownRatio * 100).toFixed(0) + "% unattributed" : ""),
  ])));
  if (engaged.tasks.length > 12) {
    out.push("  " + paint.dim("… and " + (engaged.tasks.length - 12) + " more — `--json` for all of them"));
  }
  if (engaged.unknownRatio > 0.3) {
    out.push("");
    out.push("  " + paint.warn(MARK.warn) + " more than 30% of the measured time is unattributed —");
    out.push("    the attribution chain is at fault, not the data (§14 point 2). Check that");
    out.push("    `" + N + " take` is what claims tasks here, or set `" + N + " focus <ID>`.");
  }
  return out.join("\n");
}

export function main(argv) {
  const cli = takeDirFlag(argv);
  const rest = cli.argv;
  const asJson = rest.includes("--json");
  const wantEngaged = rest.includes("--engaged");
  const unknown = rest.filter((a) => !KNOWN_FLAGS.includes(a));
  if (unknown.length) {
    console.error(failure(N + " time", "unexpected argument: " + unknown.join(" "), [],
      [N + " time --help"]));
    return 2;
  }

  let root;
  try {
    root = resolveBacklogDir({ dir: cli.dir, moduleDir: __dirname }).root;
  } catch (e) {
    console.error(failure(N + " time", e.message, []));
    return 2;
  }
  const config = loadConfigOrExit(root);
  const tasks = readTaskRecords(backlogPaths(root).tasksDir, config.taskId.file);
  const stampFor = (id) => {
    const rows = readActivity(root, id).filter((e) => e && e.kind === "commit");
    return rows.length ? rows[rows.length - 1].ts : null;
  };
  const stats = timeStats(tasks, stampFor, config);

  // The engaged report is computed WHETHER OR NOT `--engaged` was passed, and
  // only the TEXT view is gated by the flag. `--json` is the extension surface
  // (law 4), and a key that appears only when a flag was passed is a contract a
  // consumer has to read the help to discover — the envelope's rule is that a
  // declared key is always there.
  const rowsByTask = {};
  for (const id of listActivityTasks(root)) {
    rowsByTask[id] = readActivity(root, id).filter((r) => r && HEARTBEAT_KINDS.indexOf(r.kind) >= 0);
  }
  const engaged = engagedReport(rowsByTask, { idleGapMinutes: config.idleGapMinutes });

  if (asJson) {
    printJson("time", { root, ...stats, engaged, unknown_ratio: engaged.unknownRatio });
    return 0;
  }
  console.log(renderTime(stats, config));
  if (wantEngaged) console.log(renderEngaged(engaged));
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("time-report.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
