#!/usr/bin/env node
/**
 * The `stats` command — the state of the backlog in the terminal (BL-1412).
 *
 * The arithmetic does NOT live here, it lives in `stats.mjs`; this file is only
 * the disk read and the formatting. That way the number can be tested without
 * creating a directory, and the appearance can change without touching the
 * arithmetic.
 *
 * It reads `tasks/*.md` and NOT the generated views — those have been gitignored
 * since BL-1404, so a fresh clone does not have them, and besides, a report from
 * a tree that has just changed is meant to show today's state, not the state of
 * the last rebuild.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { calibrationSamples } from "./activity.mjs";
import { absentHere, crossBranchState, describeDivergence, divergences, scanNote } from "./branch-scan.mjs";
import { breakdown, calibrate, correlate, spanLabel } from "./calibration.mjs";
import { commandRunner, contextBudget, renderBudget } from "./context-budget.mjs";
import { loadConfigOrExit } from "./config.mjs";
import { backlogPaths, resolveBacklogDir, resolveBacklogDirOrExit, takeDirFlag } from "./paths.mjs";
import { ranked, summarize } from "./stats.mjs";
import { readTaskMetas } from "./task-io.mjs";
import { hoursLabel } from "./estimate.mjs";
import { printJson } from "./json-envelope.mjs";
import { heading, line, priorityPaint, statusPaint, table } from "./ui.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const cli = takeDirFlag(process.argv.slice(2));
const argv = cli.argv;

const KNOWN_FLAGS = ["--json", "--context", "--calibration", "--correlation-only"];
for (const a of argv) {
  if (KNOWN_FLAGS.indexOf(a) < 0) {
    console.error(`${N} stats: unknown flag: ` + a);
    console.error("  available: " + KNOWN_FLAGS.join(" ") + " --dir <path>");
    process.exit(2);
  }
}

const ROOT = resolveBacklogDirOrExit({ dir: cli.dir, moduleDir: __dirname }, N + " stats").root;
// A message instead of a stack trace (TL-60) — `stats` was one of the commands
// that failed correctly but looked like a crash of the tool while doing it.
const CONFIG = loadConfigOrExit(ROOT);
const TASKS_DIR = backlogPaths(ROOT).tasksDir;

// The same reader as in `doctor` (TL-62) — one answer to the question of which
// files are tasks.
const tasks = readTaskMetas(TASKS_DIR, CONFIG);

// The same question `query` asks, answered by the same module (TL-73): a
// summary of one checkout is a summary of one checkout, and until it says so it
// reads like a summary of the backlog.
const SCAN = crossBranchState(ROOT, CONFIG);
for (const t of tasks) t.elsewhere = divergences(t.status, SCAN.byId.get(t.id));
// Counted APART from every row `summarize` produces (TL-145). A task this tree
// does not have has no priority, no estimate and no board here, so folding it
// into `active` or into `work to be done` would be inventing the fields that
// make those numbers mean anything.
const ELSEWHERE_ONLY = absentHere(SCAN.byId, tasks.map((t) => t.id));

const s = summarize(tasks, CONFIG);

// WHAT AN ANSWER COSTS (TL-106). A separate report rather than a section of the
// ordinary one: it spawns the commands it measures, and a summary that took a
// second and a half to print is a summary people stop asking for.
if (argv.includes("--context")) {
  const budget = contextBudget({
    root: ROOT, config: CONFIG, run: commandRunner(join(__dirname, "cli.mjs"), ROOT),
  });
  if (argv.includes("--json")) {
    printJson("stats", { root: ROOT, context: budget });
    process.exit(0);
  }
  console.log(renderBudget(budget));
  process.exit(0);
}

// ESTIMATE CALIBRATION (TL-29). A separate report for the same reason
// `--context` is one: it reads `activity/rollup/`, which the ordinary summary
// has no business touching, and it answers a question about CLOSED work while
// every row above is about the queue.
if (argv.includes("--calibration") || argv.includes("--correlation-only")) {
  const rows = calibrationSamples(ROOT, tasks, CONFIG);
  const opts = { minN: CONFIG.minReportN };
  const gate = correlate(rows, opts);

  // STEP 0 FIRST, ALWAYS, AND IT CAN BE ASKED ALONE. The gate decides whether a
  // table of medians is a measurement or a formatted picture of noise (§14
  // point 1 of docs/backlog-time-tracking.md — a real path, product-name:
  // allow), so printing the table above it would be answering after acting.
  if (argv.includes("--correlation-only")) {
    if (argv.includes("--json")) {
      printJson("stats", { root: ROOT, calibration: { gate, samples: rows.length } });
      process.exit(0);
    }
    console.log(renderGate(gate));
    // EXIT 0 ON EVERY VERDICT, including `uncorrelated`. A negative measurement
    // is a result; making it a non-zero exit would turn the honest answer into
    // something a pipeline treats as a broken command.
    process.exit(0);
  }

  const cal = calibrate(rows, opts);
  if (argv.includes("--json")) {
    printJson("stats", {
      root: ROOT,
      calibration: {
        gate, ...cal,
        byBoard: breakdown(rows, "board", opts),
        byType: breakdown(rows, "type", opts),
        byOwner: breakdown(rows, "owner", opts),
      },
    });
    process.exit(0);
  }
  console.log(renderCalibration(cal, gate, rows, opts));
  process.exit(0);
}

if (argv.includes("--json")) {
  // The tallies stay under `stats` rather than at the root (TL-72): a tally
  // named like an envelope key would otherwise overwrite it.
  printJson("stats", {
    root: ROOT,
    stats: s,
    scan: { scanned: SCAN.scanned, reason: SCAN.reason, branches: SCAN.branches, trees: SCAN.trees.length },
    divergent: tasks
      .filter((t) => t.elsewhere.length)
      .map((t) => ({ id: t.id, status: t.status, elsewhere: t.elsewhere })),
    elsewhereOnly: ELSEWHERE_ONLY,
  });
  process.exit(0);
}

// Formatting and colour come from `ui.mjs` (TL-52) — the arithmetic still sits
// in `stats.mjs`. Three layers, each replaceable without touching the others.
const paintStatus = statusPaint(CONFIG);
const paintPriority = priorityPaint(CONFIG);

const out = [];
out.push(heading((CONFIG.projectName || CONFIG.project_name || "Backlog") + " — " + ROOT));
out.push("");
out.push(line("tasks in total", s.total));
out.push(line("active", s.active));
out.push(line("archived", s.archived));
out.push("");

out.push("status (all):");
for (const st of CONFIG.statuses || []) out.push(line("  " + paintStatus(st), s.byStatus[st] || 0, "", { labelWidth: 22 + (paintStatus(st).length - st.length) }));

const prio = ranked(s.byPriority);
if (prio.length) {
  out.push("");
  out.push("priority (active):");
  for (const [k, n] of prio) out.push(line("  " + paintPriority(k), n, "", { labelWidth: 22 + (paintPriority(k).length - k.length) }));
}

const boards = ranked(s.byBoard);
if (boards.length > 1) {
  out.push("");
  out.push("board (active):");
  for (const [k, n] of boards) out.push(line("  " + k, n));
}

const epics = ranked(s.byEpic, 5);
if (epics.length) {
  out.push("");
  out.push("largest epics (active, top 5):");
  for (const [k, n] of epics) out.push(line("  " + k.slice(0, 20), n));
}

out.push("");
// NOT "blocked": the status `blocked` is a separate, smaller number shown above.
// One name for two different things forces the reader to guess which one they
// are looking at.
out.push(line("waiting on other tasks", s.blocked, s.blocked ? "non-empty blocked_by" : ""));
// `unknown` is ALWAYS printed when it is non-zero: a sum without that number
// pretends to be complete, and an unparseable estimate is work we know nothing
// about.
out.push(
  line("work to be done", hoursLabel(s.openHours.hours),
    s.openHours.unknown ? s.openHours.unknown + " with no countable estimate" : "")
);

// THE DISAGREEMENT IS NAMED, NEVER RESOLVED (TL-73). One row per task, both
// statuses, and the branch each came from — a single "true" status picked here
// would be the one-checkout answer again, only harder to notice.
const divergent = tasks.filter((t) => t.elsewhere.length);
if (divergent.length) {
  out.push("");
  out.push("status differs on other branches:");
  for (const t of divergent) {
    out.push(line("  " + t.id, t.status, "here; " + t.elsewhere.map(describeDivergence).join(", ")));
  }
}

// EXISTENCE, on the same rule as state: named, and never mixed into the tallies
// above (TL-145).
if (ELSEWHERE_ONLY.length) {
  out.push("");
  out.push("only on another branch, not in this tree:");
  for (const t of ELSEWHERE_ONLY) {
    out.push(line("  " + t.id, "", t.elsewhere.map(describeDivergence).join(", ")));
  }
}

const note = scanNote(SCAN.reason);
if (note) {
  out.push("");
  out.push("  " + note);
}

console.log(out.join("\n"));


// ──────────────────────────────────────────────────────────────────────────
// Calibration (TL-29)
// ──────────────────────────────────────────────────────────────────────────

/** A function and not a `const` map: this file is a SCRIPT, its top level runs
 *  before the declarations below it, and a const read from there is in its
 *  temporal dead zone. A function declaration is hoisted, which is why every
 *  helper here is one. */
function verdictNote(verdict) {
  if (verdict === "insufficient") return "not answered yet";
  if (verdict === "correlated") return "time is a usable axis";
  if (verdict === "uncorrelated") return "calibrating on time is not worth a report";
  return "";
}

function renderGate(gate) {
  const out = [heading("estimate calibration — step 0, the correlation gate")];
  out.push("");
  out.push(line("verdict", gate.verdict, verdictNote(gate.verdict)));
  out.push(line("measured samples", gate.samples));
  out.push(line("buckets at n>=" + gate.minN, gate.buckets));
  if (gate.ratio != null) {
    out.push(line("spread within a bucket", spanLabel(gate.within), "mean p20-p80"));
    out.push(line("difference between buckets", spanLabel(gate.between), "median to median"));
    out.push(line("ratio", (Math.round(gate.ratio * 100) / 100) + "x", gate.ratio >= 1 ? "between > within" : "within > between"));
    out.push(line("medians rise with the estimate", gate.monotonic ? "yes" : "no"));
  }
  out.push("");
  out.push("  " + gate.reason);
  return out.join("\n");
}

function renderCalibration(cal, gate, rows, opts) {
  const out = [renderGate(gate), ""];

  if (gate.verdict === "uncorrelated") {
    // THE TABLE IS STILL PRINTED, with the verdict standing above it. Hiding it
    // would leave nothing for a reader to check the verdict against, and the
    // gate is a judgement about the data, not a permission to see it.
    out.push("  the table below is printed for inspection, not for planning:");
    out.push("");
  }

  out.push(heading("per estimate bucket"));
  out.push("");
  const body = cal.buckets.map((b) => b.insufficient
    ? ["  " + b.label, String(b.n), "not enough data", "", ""]
    : ["  " + b.label, String(b.n), spanLabel(b.median),
       spanLabel(b.p20) + " - " + spanLabel(b.p80),
       "x" + (Math.round(b.bias * 10) / 10)]);
  if (body.length) out.push(table([["  estimate", "n", "median", "p20-p80", "bias"], ...body]));
  else out.push("  no closed task carries both an estimate and measured time");

  out.push("");
  out.push(line("closed and measured", cal.measured));
  // ALWAYS PRINTED, ZERO INCLUDED. A calibration built from 9 of 141 closed
  // tasks and one built from 130 look identical once the medians are on screen.
  out.push(line("closed, never measured", cal.unmeasured));
  out.push(line("closed with no countable estimate", cal.unestimated));
  out.push(line("threshold", "n>=" + cal.minN, "min_report_n in config.yaml"));

  for (const [key, label] of [["board", "board"], ["type", "type"], ["owner", "owner"]]) {
    const rowsFor = breakdown(rows, key, opts);
    if (!rowsFor) continue;
    out.push("");
    out.push("by " + label + ":");
    for (const r of rowsFor) {
      for (const b of r.buckets) {
        out.push(line("  " + r.value + " / " + b.label, spanLabel(b.median),
          spanLabel(b.p20) + " - " + spanLabel(b.p80) + ", n=" + b.n));
      }
    }
  }
  return out.join("\n");
}
