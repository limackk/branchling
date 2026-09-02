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

import { absentHere, crossBranchState, describeDivergence, divergences, scanNote } from "./branch-scan.mjs";
import { commandRunner, contextBudget, renderBudget } from "./context-budget.mjs";
import { loadConfigOrExit } from "./config.mjs";
import { backlogPaths, resolveBacklogDir, takeDirFlag } from "./paths.mjs";
import { ranked, summarize } from "./stats.mjs";
import { readTaskMetas } from "./task-io.mjs";
import { hoursLabel } from "./estimate.mjs";
import { printJson } from "./json-envelope.mjs";
import { heading, line, priorityPaint, statusPaint } from "./ui.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const cli = takeDirFlag(process.argv.slice(2));
const argv = cli.argv;

const KNOWN_FLAGS = ["--json", "--context"];
for (const a of argv) {
  if (KNOWN_FLAGS.indexOf(a) < 0) {
    console.error(`${N} stats: unknown flag: ` + a);
    console.error("  available: " + KNOWN_FLAGS.join(" ") + " --dir <path>");
    process.exit(2);
  }
}

const ROOT = resolveBacklogDir({ dir: cli.dir, moduleDir: __dirname }).root;
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
  console.log(renderBudget(budget));
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
