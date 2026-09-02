#!/usr/bin/env node
/**
 * `audit` — the declarations, against the traces they left (TL-90).
 *
 * WHAT IT IS FOR, and how it differs from `check`. `check` judges STRUCTURAL
 * CONSISTENCY — collisions, boards, dangling references — and fails a commit.
 * This judges the TRUSTWORTHINESS OF A DECLARATION, and it is a report somebody
 * reads. Different moment, different exit code, and they must not be merged:
 * a report that fails a commit gets switched off, and a gate that reports gets
 * ignored.
 *
 * The backlog stops being a set of claims taken on faith. Every `done` either
 * left a trace or is named. Nothing else in this class of tool can ask the
 * question at all, because none of them records transitions or attribution.
 *
 * THREE RULES WITHOUT WHICH THIS REPORT WOULD ITSELF BE LYING:
 *
 *   1. **No trace is a SUSPICION, not a verdict.** The history is a log of
 *      observations, not an audit log, and it has a day zero — the day it first
 *      recorded a STATUS TRANSITION, which is the evidence this looks for.
 *      Everything closed before then left no trace for a reason that is
 *      nobody's fault. Those are filtered out by date rather than reported in
 *      bulk as anomalies, and the report says how many it dropped.
 *   2. **A bucket below `min_report_n` says "not enough", never a rate.** A
 *      percentage over three closings reads exactly like one over three
 *      hundred. That rule is not invented here — it is the one the time
 *      reports already follow.
 *   3. **This is a tool for backlog hygiene, not for judging people.** The
 *      per-actor table exists to find a process that keeps producing rework,
 *      and the sentence appears in `--help` because a number about a named
 *      actor will be read as a number about a person unless it says otherwise.
 *
 * WHERE THE VOCABULARY COMES FROM. Nothing here names a status. "Closed" is
 * `archived_statuses`, "in progress" is `in_progress_status`, and "blocked" is
 * derived rather than invented: an ACTIVE status listed in
 * `reason_required_statuses` is precisely a status a project has declared you
 * may not enter without saying why, which is what "blocked" means in every
 * backlog that has one. A new configuration key would have been a second way to
 * say something the configuration already says.
 *
 * Exit: 0 = nothing found · 1 = divergences found · 2 = the invocation was wrong.
 *
 * Tests: `node --test scripts/tests/audit.test.mjs`
 */

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfigOrExit } from "./config.mjs";
import { outstandingVouches, readAllHistory } from "./history.mjs";
import { printJson } from "./json-envelope.mjs";
import { backlogPaths, resolveBacklogDir, takeDirFlag } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { readTaskRecords } from "./task-select.mjs";
import { MARK, color, failure, heading, table } from "./ui.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

const FLAGS = ["--since", "--json", "--dir"];

export const USAGE = [
  `${N} audit [--since <YYYY-MM-DD>] [--json] [--dir <path>]`,
  "",
  "  Cross-checks what the task files DECLARE against what the history log",
  "  actually recorded, and reports where the two disagree:",
  "",
  "    closed with no trace   a task in a closed status that no recorded",
  "                           transition ever put there",
  "    reopened after closing rework — counted per the actor who closed it",
  "    parked                 in progress, with no recorded change for",
  "                           `audit_stale_days` days",
  "    no premise             a status you may not enter without saying why,",
  "                           carrying an empty `blocked_by`",
  "    awaiting a vouch       open, with a closing run stopped at a `manual:`",
  "                           entry nobody has vouched for",
  "",
  "  --since <date>  the earliest closing date to judge. Defaults to the day the",
  "                  log first recorded a status transition: a task closed before",
  "                  that left no trace for a reason that is nobody's fault, and",
  "                  reporting those in bulk would bury the real ones",
  "  --json          the same findings for a program",
  "",
  "  THIS IS A TOOL FOR BACKLOG HYGIENE, NOT FOR JUDGING PEOPLE. The per-actor",
  "  table is there to find a process that keeps producing rework. A bucket with",
  "  fewer than `min_report_n` closings reports `not enough`, never a rate.",
  "",
  "  It is not `check`: that one judges structure and fails a commit, this one",
  "  judges declarations and is read by a person. exit: 0 clean · 1 findings · 2 usage.",
].join("\n");

// ──────────────────────────────────────────────────────────────────────────
// Arguments — PURE
// ──────────────────────────────────────────────────────────────────────────

export function parseAuditArgs(args) {
  let since = null;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--json") { json = true; continue; }
    if (a === "--since") {
      since = args[++i];
      if (!since) throw new Error("`--since` with no date");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) {
        throw new Error("`--since " + since + "` is not a date\nthe shape is YYYY-MM-DD, the same one `created:` uses");
      }
      continue;
    }
    if (a.startsWith("-")) throw new Error("unknown flag: " + a + "\nknown flags: " + FLAGS.join(" "));
    throw new Error("unexpected argument: " + a + "\nevery criterion is a flag");
  }
  return { since, json };
}

// ──────────────────────────────────────────────────────────────────────────
// The detectors — PURE, one shared read
// ──────────────────────────────────────────────────────────────────────────

/**
 * The first day a STATUS TRANSITION was recorded — day zero for this report.
 *
 * NOT the first entry of any kind, and the difference is not academic: in this
 * repository the log begins on 2026-08-29 and the first status transition lands
 * on 2026-08-30, so a day zero taken from "any entry" accuses every task closed
 * in between of leaving no trace, when the mechanism that leaves the trace was
 * not running yet. Day zero has to be the day the EVIDENCE this detector looks
 * for started existing.
 *
 * Everything before it is a hole rather than a finding, and the hole is COUNTED
 * rather than hidden: a report that quietly dropped those tasks would be as
 * misleading as one that accused them.
 */
export function historyDayZero(history) {
  let first = null;
  for (const entries of Object.values(history || {})) {
    for (const e of entries || []) {
      if (e.field !== "status") continue;
      const ts = String(e.ts || "").slice(0, 10);
      if (!ts) continue;
      if (!first || ts < first) first = ts;
    }
  }
  return first;
}

/** The day a task's file says it last moved. `updated:` has a day's resolution,
 *  which is enough for every threshold here and is said so on the report. */
const day = (s) => String(s || "").slice(0, 10);

/**
 * A task standing in a closed status that no recorded transition ever put
 * there.
 *
 * `since` is the whole honesty of this detector — see `historyDayZero`.
 */
export function closedWithoutTrace(tasks, history, { archived, since }) {
  const closed = new Set(archived);
  const found = [];
  let skipped = 0;
  for (const t of tasks) {
    if (!closed.has(t.status)) continue;
    const when = day(t.updated) || day(t.created);
    if (since && when && when < since) { skipped++; continue; }
    const entries = history[t.id] || [];
    const traced = entries.some((e) => e.field === "status" && closed.has(e.to));
    if (!traced) found.push({ task: t.id, title: t.title, status: t.status, updated: when });
  }
  return { found, skipped };
}

/**
 * A transition OUT of a closed status back into an open one — rework.
 *
 * The blame goes to whoever CLOSED it, not to whoever reopened it: the question
 * the number answers is "how often does work closed this way come back", and
 * the reopener is the person who noticed, not the one who caused it.
 */
export function reopenedAfterClosing(history, { archived }) {
  const closed = new Set(archived);
  const found = [];
  const byActor = new Map();

  for (const id of Object.keys(history || {}).sort()) {
    const entries = (history[id] || [])
      .filter((e) => e.field === "status")
      .slice()
      .sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
    let closer = null;
    for (const e of entries) {
      if (closed.has(e.to)) {
        closer = e.actor || "unknown";
        bump(byActor, closer, "closings");
        continue;
      }
      if (closer && closed.has(e.from)) {
        found.push({ task: id, from: e.from, to: e.to, closedBy: closer, reopenedBy: e.actor || "unknown", ts: e.ts });
        bump(byActor, closer, "reopens");
        closer = null;
      }
    }
  }
  return { found, byActor };
}

function bump(map, key, field) {
  if (!map.has(key)) map.set(key, { actor: key, closings: 0, reopens: 0 });
  map.get(key)[field]++;
}

/**
 * The rework table, with the rule that keeps it honest: below `min_report_n`
 * closings a bucket says how many it has, and no rate at all.
 */
export function reworkRates(byActor, minN) {
  return [...byActor.values()]
    .sort((a, b) => b.closings - a.closings)
    .map((row) => ({
      ...row,
      // `null`, not `0`: "too few to say" and "never comes back" are different
      // answers, and a zero would be read as the second.
      rate: row.closings >= minN ? Math.round((row.reopens / row.closings) * 1000) / 1000 : null,
      enough: row.closings >= minN,
    }));
}

/** In progress, with nothing recorded for `audit_stale_days`. */
export function parked(tasks, history, { inProgressStatus, staleDays, today }) {
  if (!inProgressStatus) return { found: [], reason: "this backlog does not say which status means `in progress`" };
  const cutoff = new Date(Date.parse(today) - staleDays * 86400000).toISOString().slice(0, 10);
  const found = [];
  for (const t of tasks) {
    if (t.status !== inProgressStatus) continue;
    const entries = history[t.id] || [];
    const last = entries.reduce((acc, e) => {
      const d = day(e.ts);
      return d > acc ? d : acc;
    }, day(t.updated) || "");
    if (last && last < cutoff) {
      found.push({ task: t.id, title: t.title, owner: t.owner || "", lastChange: last, days: daysBetween(last, today) });
    }
  }
  return { found, reason: null };
}

function daysBetween(from, to) {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
}

/**
 * A status a project says you may not enter without a reason, standing there
 * with an empty `blocked_by`.
 *
 * The set is DERIVED — the active members of `reason_required_statuses` —
 * because that is already the project's declaration that this status carries a
 * premise. A `blocked_status:` key would be a second way of saying it, and two
 * ways of saying one thing is one of them being wrong later.
 */
export function withoutPremise(tasks, { reasonRequired, archived }) {
  const closed = new Set(archived);
  const watched = new Set((reasonRequired || []).filter((s) => !closed.has(s)));
  if (!watched.size) {
    return { found: [], reason: "no ACTIVE status in this backlog requires a stated reason, so none can lack a premise" };
  }
  const found = [];
  for (const t of tasks) {
    if (!watched.has(t.status)) continue;
    if ((t.blocked_by || []).length) continue;
    found.push({ task: t.id, title: t.title, status: t.status });
  }
  return { found, reason: null };
}

/**
 * An OPEN task whose closing run was stopped by a `manual:` entry nobody
 * vouched for (TL-170).
 *
 * WHY IT IS NOT LEFT TO `parked`. A task waiting on a vouch does eventually
 * show up there, but only after `audit_stale_days` — and it shows up as a task
 * nobody has touched, which is the one thing it is not. The tool knows exactly
 * what this is waiting for, so reporting it as an unexplained silence would be
 * throwing away an answer it already holds. This finding has no staleness
 * threshold for the same reason: the fact is complete the moment the run
 * refused.
 *
 * The refusal code travels with the finding, because "there was nobody to ask"
 * and "a person was asked and said no" call for different next moves.
 */
export function awaitingVouch(tasks, history, { archived }) {
  const closed = new Set(archived || []);
  const found = [];
  for (const t of tasks) {
    if (closed.has(t.status)) continue;
    for (const e of outstandingVouches(history[t.id] || [])) {
      found.push({
        task: t.id, title: t.title, status: t.status, owner: t.owner || "",
        refusal: e.refusal || "", actor: e.actor || "", since: day(e.ts), manual: e.to || "",
      });
    }
  }
  return { found, reason: null };
}

/** Every detector, over one read. PURE. */
export function auditBacklog({ tasks, history, config, since, today }) {
  const archived = config.archivedStatuses || [];
  const dayZero = historyDayZero(history);
  const from = since || dayZero;

  const trace = closedWithoutTrace(tasks, history, { archived, since: from });
  const reopen = reopenedAfterClosing(history, { archived });
  const stale = parked(tasks, history, {
    inProgressStatus: config.inProgressStatus, staleDays: config.auditStaleDays, today,
  });
  const premise = withoutPremise(tasks, { reasonRequired: config.reasonRequiredStatuses, archived });
  const vouch = awaitingVouch(tasks, history, { archived });

  const findings = trace.found.length + reopen.found.length + stale.found.length +
    premise.found.length + vouch.found.length;
  return {
    since: from,
    dayZero,
    tasks: tasks.length,
    findings,
    closedWithoutTrace: trace,
    reopened: { found: reopen.found, rework: reworkRates(reopen.byActor, config.minReportN) },
    parked: stale,
    withoutPremise: premise,
    awaitingVouch: vouch,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Reporting
// ──────────────────────────────────────────────────────────────────────────

function section(out, title, rows, note) {
  out.push("");
  out.push(heading("  " + title + "  (" + rows.length + ")"));
  if (note) out.push("  " + color.dim(note));
  if (!rows.length) return;
  out.push(table(rows.map((r) => ["   ", ...r])));
}

export function render(report, config) {
  const out = [heading(N + " audit — " + report.tasks + " task(s), judged from " + report.since)];
  if (report.dayZero && report.since === report.dayZero) {
    out.push("  " + color.dim("that is the day the log first recorded a status transition; nothing before it could leave the trace this looks for"));
  }

  section(out,
    "closed with no trace",
    report.closedWithoutTrace.found.map((f) => [f.task, f.status, f.updated || "—", f.title]),
    report.closedWithoutTrace.skipped
      ? report.closedWithoutTrace.skipped + " closed before " + report.since + " — no trace expected, so not counted"
      : null);

  section(out,
    "reopened after closing",
    report.reopened.found.map((f) => [f.task, f.from + " → " + f.to, "closed by " + f.closedBy, "reopened by " + f.reopenedBy]));

  if (report.reopened.rework.length) {
    out.push("");
    out.push("  " + color.dim("rework, by the actor who CLOSED the task — a property of the process, not of a person:"));
    out.push(table(report.reopened.rework.map((r) => [
      "   ", r.actor, r.closings + " closed", r.reopens + " came back",
      r.enough ? (r.rate * 100).toFixed(0) + "%" : color.dim("not enough (needs " + config.minReportN + ")"),
    ])));
  }

  section(out,
    "parked",
    report.parked.found.map((f) => [f.task, f.owner || "(nobody)", f.days + "d since " + f.lastChange, f.title]),
    report.parked.reason || "no recorded change for " + config.auditStaleDays + " day(s); `updated:` has a day's resolution");

  section(out,
    "no premise",
    report.withoutPremise.found.map((f) => [f.task, f.status, f.title]),
    report.withoutPremise.reason || "a status that may not be entered without saying why, and an empty `blocked_by`");

  section(out,
    "awaiting a vouch",
    report.awaitingVouch.found.map((f) => [f.task, f.refusal || "—", "since " + f.since, f.manual]),
    "a closing run stopped at a `manual:` entry; the automatic ones passed and nobody has vouched for this");

  out.push("");
  out.push(report.findings
    ? "  " + color.warn(MARK.warn) + " " + report.findings + " finding(s). This is a REPORT: nothing was changed, and nothing failed."
    : "  " + color.ok(MARK.ok) + " nothing to report — every declaration has the trace it should have.");
  out.push("  " + color.dim("Backlog hygiene, not a judgement of anybody's work."));
  return out.join("\n");
}

// ──────────────────────────────────────────────────────────────────────────
// The run
// ──────────────────────────────────────────────────────────────────────────

export function main(argv, today = new Date().toISOString().slice(0, 10)) {
  const cli = takeDirFlag(argv);
  let opts;
  try {
    opts = parseAuditArgs(cli.argv);
  } catch (e) {
    const [head, ...rest] = e.message.split("\n");
    console.error(failure(N + " audit", head, rest, [`${N} audit --help`]));
    return 2;
  }

  let root;
  try {
    root = resolveBacklogDir({ dir: cli.dir, moduleDir: HERE }).root;
  } catch (e) {
    console.error(failure(N + " audit", e.message, [], [`${N} audit --dir <path>`]));
    return 2;
  }
  const config = loadConfigOrExit(root);
  const tasks = readTaskRecords(backlogPaths(root).tasksDir, config.taskId.file);
  const history = readAllHistory(root);
  const report = auditBacklog({ tasks, history, config, since: opts.since, today });

  if (opts.json) {
    printJson("audit", {
      since: report.since,
      dayZero: report.dayZero,
      tasks: report.tasks,
      findings: report.findings,
      closedWithoutTrace: report.closedWithoutTrace.found,
      skippedBeforeSince: report.closedWithoutTrace.skipped,
      reopened: report.reopened.found,
      rework: report.reopened.rework,
      parked: report.parked.found,
      withoutPremise: report.withoutPremise.found,
      awaitingVouch: report.awaitingVouch.found,
    });
    return report.findings ? 1 : 0;
  }
  console.log(render(report, config));
  return report.findings ? 1 : 0;
}

if (process.argv[1] && process.argv[1].endsWith("audit.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
