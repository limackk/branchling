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
 *   2. **This is a tool for backlog hygiene, not for judging people.** It
 *      reports task evidence and never aggregates a person's record.
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

import { collectAdvisories } from "./check-guards.mjs";
import { loadConfigOrExit } from "./config.mjs";
import { FIELD_VERIFIED, outstandingVouches, readAllHistory } from "./history.mjs";
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
  "    reopened after closing a closed task became open again",
  "    parked                 in progress, with no recorded change for",
  "                           `audit_stale_days` days",
  "    no premise             a status you may not enter without saying why,",
  "                           carrying an empty `blocked_by`",
  "    awaiting a vouch       open, with a closing run stopped at a `manual:`",
  "                           entry nobody has vouched for",
  "    handed back            an open task passed across the same pair of roles",
  "                           in BOTH directions, with what each hand said when",
  "                           it let go. Two correct hands can pass one task",
  "                           forever when the change needs both their charters",
  "    advisory guards        what `check` stopped reporting when it became a",
  "                           release gate (TL-383): real findings that cannot",
  "                           fail a publication. They are RUN here, not copied,",
  "                           so there is one definition and one reader more",
  "",
  "  --since <date>  the earliest closing date to judge. Defaults to the day the",
  "                  log first recorded a status transition: a task closed before",
  "                  that left no trace for a reason that is nobody's fault, and",
  "                  reporting those in bulk would bury the real ones",
  "  --json          the same findings for a program",
  "",
  "  THIS IS A TOOL FOR BACKLOG HYGIENE, NOT FOR JUDGING PEOPLE. It reports",
  "  evidence attached to tasks and does not score or rank actors.",
  "",
  "  It is not `check`: that one is the gate a release has to pass, this one is",
  "  read by a person — which is why the findings that cannot fail a release live",
  "  here. exit: 0 clean · 1 findings · 2 usage.",
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
    if (a.startsWith("-")) throw new Error("unknown flag: " + a + "\navailable: " + FLAGS.join(" "));
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

  for (const id of Object.keys(history || {}).sort()) {
    const entries = (history[id] || [])
      .filter((e) => e.field === "status")
      .slice()
      .sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
    let closer = null;
    for (const e of entries) {
      if (closed.has(e.to)) {
        closer = e.actor || "unknown";
        continue;
      }
      if (closer && closed.has(e.from)) {
        found.push({ task: id, from: e.from, to: e.to, closedBy: closer, reopenedBy: e.actor || "unknown", ts: e.ts });
        closer = null;
      }
    }
  }
  return { found };
}

/**
 * An OPEN task handed back across the boundary it was just handed over — the
 * same two roles, in both directions (TL-277).
 *
 * WHY THIS IS A FINDING AND NOT A STATISTIC. A pipeline of roles is supposed to
 * move a task FORWARD: each hand finishes its stage and hands on. A return
 * crossing says the receiving hand could not finish inside its own charter, and
 * a second one says the first return did not settle why. Measured over TL-151:
 * four agent runs, 5624 seconds, three crossings of `spec`↔`dev`, every hand
 * correct at every step — and nothing in the tool said anything was wrong. The
 * queue reported `held elsewhere`, which is what it also says about a task
 * waiting for a role nobody serves.
 *
 * WHAT IT DOES NOT CLAIM. This does not know whose charter is at fault and does
 * not try to: it names the pair, counts the crossings and quotes what each hand
 * said when it let go. The reasons are the evidence a person needs to decide
 * whether the boundary or the task is wrong, and deciding that is `decide`.
 *
 * CLOSED TASKS ARE OUT. A task that crossed twice and then shipped is history,
 * not a thing to act on, and a report that keeps naming it is a report people
 * stop reading. The pair is UNORDERED — `spec`→`dev` and `dev`→`spec` are one
 * boundary seen from two sides, which is the whole point of the finding.
 */
export function handedBackAcross(tasks, history, { archived }) {
  const closed = new Set(archived || []);
  const byId = new Map((tasks || []).map((t) => [t.id, t]));
  const found = [];

  for (const id of Object.keys(history || {}).sort()) {
    const task = byId.get(id);
    if (!task || closed.has(task.status)) continue;

    const moves = (history[id] || [])
      .filter((e) => e.field === "role" && e.from && e.to && e.from !== e.to)
      .slice()
      .sort((a, b) => String(a.ts).localeCompare(String(b.ts)));

    const boundaries = new Map();
    for (const e of moves) {
      const key = [e.from, e.to].slice().sort().join("\u0000");
      if (!boundaries.has(key)) boundaries.set(key, []);
      boundaries.get(key).push(e);
    }

    for (const [key, legs] of boundaries) {
      const directions = new Set(legs.map((e) => e.from + "\u0000" + e.to));
      // One direction, however many times, is not a hand-back: a task can pass
      // `spec`→`dev` in two attempts without anybody refusing it.
      if (directions.size < 2) continue;
      found.push({
        task: id,
        title: task.title || "",
        status: task.status,
        roles: key.split("\u0000"),
        crossings: legs.length,
        legs: legs.map((e) => ({
          from: e.from,
          to: e.to,
          ts: e.ts,
          actor: e.actor || "unknown",
          reason: e.reason && e.reason !== "unknown" ? e.reason : "",
        })),
      });
    }
  }
  return { found };
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

/**
 * The `manual:` entries that were vouched for. These are individual task
 * records, not a scorecard grouped by actor.
 */
export function vouches(history) {
  const found = [];
  for (const id of Object.keys(history || {}).sort()) {
    for (const e of history[id] || []) {
      if (e.field !== FIELD_VERIFIED) continue;
      const actor = e.actor || "unknown";
      const how = e.vouch === "typed" || e.vouch === "flag" ? e.vouch : "unrecorded";
      found.push({ task: id, actor, how, when: day(e.ts), manual: e.to || "" });
    }
  }
  return { found };
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
  const handedBack = handedBackAcross(tasks, history, { archived });
  const given = vouches(history);

  const findings = trace.found.length + reopen.found.length + stale.found.length +
    premise.found.length + vouch.found.length + handedBack.found.length;
  return {
    since: from,
    dayZero,
    tasks: tasks.length,
    findings,
    closedWithoutTrace: trace,
    reopened: reopen,
    parked: stale,
    withoutPremise: premise,
    awaitingVouch: vouch,
    handedBack,
    // NOT added to `findings`: a vouch is a fact about how work was closed, not
    // a disagreement between a declaration and its trace.
    vouches: given,
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

  section(out,
    "handed back across the same boundary",
    report.handedBack.found.map((f) => [
      f.task,
      f.roles.join(" ↔ "),
      f.crossings + "×",
      f.legs.map((l) => l.from + "→" + l.to + ": " + (l.reason || "(no reason recorded)")).join("  ·  "),
    ]),
    "an open task each hand returned inside its own charter; the queue calls this `held elsewhere`, which is what it also calls a task nobody serves");

  out.push("");
  out.push(heading("  vouched `manual:` entries  (" + report.vouches.found.length + ")"));
  if (!report.vouches.found.length) {
    // An empty section and a missing one must not look alike. "nobody has ever
    // vouched here" is an answer; silence is the absence of one, and this whole
    // file exists because the two were being confused.
    out.push("  " + color.dim("no `manual:` entry in this backlog has been vouched for — nothing to report, not nothing to see"));
  } else {
    out.push(table(report.vouches.found.map((v) => [
      "   ", v.task, v.when || "—", v.manual || "—", v.how,
    ])));
  }

  // WHAT `check` NO LONGER SAYS (TL-383). These guards report and cannot fail,
  // so they were removed from the release verdict — and a finding dropped from
  // one command without arriving in another is a finding deleted. They are RUN
  // here, not reimplemented: one definition, one more reader.
  if (report.advisories && report.advisories.length) {
    out.push("");
    out.push(heading("  advisory guards  (" + report.advisories.length + ")"));
    out.push("  " + color.dim("`check` runs the gates that can fail a release; these report and never do"));
    for (const advisory of report.advisories) {
      for (const line of advisory.output.split("\n")) out.push(line ? "  " + line : "");
    }
  }

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
  // Attached after the analysis rather than computed inside it: `auditBacklog`
  // is pure over tasks and history, and spawning processes from it would make
  // every one of its unit tests spawn thirteen too.
  report.advisories = collectAdvisories(root, config);

  if (opts.json) {
    printJson("audit", {
      since: report.since,
      dayZero: report.dayZero,
      tasks: report.tasks,
      findings: report.findings,
      closedWithoutTrace: report.closedWithoutTrace.found,
      skippedBeforeSince: report.closedWithoutTrace.skipped,
      reopened: report.reopened.found,
      parked: report.parked.found,
      withoutPremise: report.withoutPremise.found,
      awaitingVouch: report.awaitingVouch.found,
      handedBack: report.handedBack.found,
      vouches: report.vouches.found,
      // `output` is text written for a person; `name` is the field a consumer
      // acts on, and the same string `check --json` puts in `failed`.
      advisories: report.advisories,
    });
    return report.findings ? 1 : 0;
  }
  console.log(render(report, config));
  return report.findings ? 1 : 0;
}

if (process.argv[1] && process.argv[1].endsWith("audit.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
