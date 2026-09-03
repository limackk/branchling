#!/usr/bin/env node
/**
 * query.mjs — ask the backlog a question instead of reading a whole view.
 *
 * WHY. `INDEX.yaml` is thousands of tokens even after being slimmed down
 * (BL-1385), and `NOW.yaml` is smaller but still fixed: you pay the full price
 * whatever you are asking about. "What is blocked in Legal compliance" is three
 * rows — and that is what it ought to cost. Measure your own:
 * `wc -c backlog/INDEX.yaml`.
 *
 * IT READS `tasks/*.md`, NOT THE VIEWS. The views are generated; if they were
 * the source of the answer, a status changed a moment ago would be invisible
 * until the next rebuild and the query would be confirming that the change "did
 * not work". The price is one file read per task, tens of milliseconds — less
 * than a single glance at the result takes.
 *
 * Usage:
 *   query --status blocked --board main
 *   query --role analyst          (--role "" = the tasks open to anybody)
 *   query --executor human        (what an agent may not be handed)
 *   query --epic "Legal compliance" --priority P0,P1
 *   query --text sync --limit 10
 *   query --blocked-by TASK-003 --files | xargs code
 *   query --modified-file scripts/cli.mjs        (as part of what was it touched)
 *   query --modified-file scripts/               (the whole directory)
 *   query --status done --text audit --count
 *
 * Filters (AND between axes, OR inside an axis — comma-separated values):
 *   --status --priority --board --label --epic --owner --type --role --executor
 *   --blocked-by
 *   --modified-file  which task touched this file — COMPUTED from commit
 *                    messages naming the task id, so there is nothing to keep
 *                    up to date. Paths are relative to the REPOSITORY root; a
 *                    trailing `/` matches a whole directory
 *   --text
 * By default only ACTIVE ones (status not in archived_statuses); passing
 * --status explicitly lifts that restriction, so `--status done` searches the
 * closed ones.
 *
 * Output: one line per task (as in the INDEX). --json for machines, --files for
 * xargs, --count just the number. --limit N cuts the list, but SAYS how much it
 * cut off — in the text output as a note, in --json as `total`.
 *
 * Exit: 0 = the query ran (including when nothing matched), 2 = a usage error.
 */

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { absentHere, crossBranchState, describeDivergence, divergences, scanNote } from "./branch-scan.mjs";
import { DEFAULTS, loadConfigOrExit } from "./config.mjs";
import { printJson } from "./json-envelope.mjs";
import { explain as explainIndex, modifiedFiles, repoRoot, touches } from "./modified-files.mjs";
import { backlogPaths, resolveBacklogDir } from "./paths.mjs";
import { collectAllProjects, collectProject, unknownEverywhere } from "./cross-project.mjs";
import { SORT_KEYS, filterTasks, readTaskRecords, sortTasks, splitList, unknownFilterValues } from "./task-select.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const VALUE_FLAGS = new Set([
  "--status", "--priority", "--board", "--label", "--epic", "--owner", "--type",
  "--role", "--executor", "--blocked-by", "--text", "--limit", "--sort", "--tasks", "--dir",
  "--modified-file",
]);
const BOOL_FLAGS = new Set(["--json", "--files", "--count", "--all-projects", "--help", "-h"]);

// An unknown flag MUST fail. Zero results caused by a typo are indistinguishable
// from "there is no such thing" — and they read like an answer.
const opts = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith("--") && a !== "-h") {
    console.error(`✗ unexpected argument: ${a} (every criterion is given as a flag)`);
    process.exit(2);
  }
  if (BOOL_FLAGS.has(a)) {
    opts[a.replace(/^--?/, "")] = true;
  } else if (VALUE_FLAGS.has(a)) {
    const v = argv[++i];
    if (v === undefined) {
      console.error(`✗ the flag ${a} requires a value`);
      process.exit(2);
    }
    opts[a.replace(/^--/, "")] = v;
  } else {
    console.error(`✗ unknown flag: ${a}`);
    console.error(`  available: ${[...VALUE_FLAGS, ...BOOL_FLAGS].sort().join(" ")}`);
    process.exit(2);
  }
}

if (opts.help || opts.h) {
  // Until TL-51 this printed the header of THIS FILE — shebang and the
  // paragraph about token costs included. The content is valuable, but it is a
  // note for a co-author, not help for a user. The list of flags is now DERIVED
  // from the same sets the input is validated against, so it cannot drift away
  // from them; `query --help` goes through the command table in cli.mjs.
  console.log("query — ask the backlog a question instead of reading a whole view\n");
  console.log("usage:");
  console.log("  query [criteria] [--json|--files|--count]\n");
  console.log("criteria (a value follows the flag):");
  console.log("  " + [...VALUE_FLAGS].sort().join(" "));
  console.log("\nswitches:");
  console.log("  " + [...BOOL_FLAGS].filter((f) => f !== "--help" && f !== "-h").sort().join(" "));
  console.log("\nexit code: 0 = the query ran (including on zero matches), 2 = a usage error.");
  process.exit(0);
}

// ACROSS EVERY REGISTERED BACKLOG (TL-36). It is a VIEW: the pass reads N
// directories and assembles the answer in memory. Deleting the registry takes
// this flag away and nothing else — every command inside a repository is found
// by walking upwards, and that answer must never be contradicted by a file.
const ALL_PROJECTS = Boolean(opts["all-projects"]);
if (ALL_PROJECTS && (opts.tasks || opts.dir)) {
  // Both name ONE backlog, so the combination has two answers and no way to
  // pick between them. Refused rather than silently letting one win.
  console.error("✗ --all-projects cannot be combined with " + (opts.tasks ? "--tasks" : "--dir"));
  console.error("  those name one backlog; --all-projects asks every registered one");
  process.exit(2);
}

// The data directory: --tasks (pointing straight at tasks/), otherwise the same
// backlog directory resolution as in every other script (BL-1399).
const ROOT = opts.tasks || ALL_PROJECTS ? null : resolveBacklogDir({ dir: opts.dir, moduleDir: __dirname }).root;
const TASKS_DIR = opts.tasks || (ROOT ? backlogPaths(ROOT).tasksDir : null);

// WHERE THE ANSWER COMES FROM. One project, or every registered one — and the
// per-project pipeline is the SAME function either way (`collectProject`), so
// asking five projects gives exactly the five answers asking each of them
// separately would. Two pipelines would be two definitions of what a row is.
//
// `--tasks <dir>` is the third case and stays apart: it points straight at a
// tasks directory, so there is no configuration to read and no branch scan to
// run. It is the only path where the vocabularies are unknown.
const FILE_QUERY = opts["modified-file"];
let COLLECTED = [];
let UNAVAILABLE = [];
let REGISTERED = 0;

if (opts.tasks) {
  if (FILE_QUERY !== undefined) {
    console.error("✗ --modified-file needs the configuration, which `--tasks <dir>` bypasses");
    console.error("  the task id prefix is what links a commit message to a task");
    process.exit(2);
  }
  let tasks;
  try {
    // Without a configuration we assume the default "prefix-number" shape
    // without knowing which prefix.
    tasks = readTaskRecords(TASKS_DIR, /^[A-Za-z][A-Za-z0-9._-]*-\d+.*\.md$/);
  } catch (e) {
    console.error(`✗ cannot read ${TASKS_DIR}: ${e.message}`);
    process.exit(2);
  }
  for (const t of tasks) { t.elsewhere = []; t.project = null; }
  COLLECTED = [{
    root: null, project: null, config: null, tasks,
    scan: { scanned: false, reason: "no-configuration", byId: new Map(), branches: [], trees: [] },
    elsewhereOnly: [], index: null, error: null,
  }];
} else if (ALL_PROJECTS) {
  const pass = collectAllProjects({ modifiedFile: FILE_QUERY });
  COLLECTED = pass.collected;
  UNAVAILABLE = pass.unavailable;
  REGISTERED = pass.registered;
} else {
  // STRICT (TL-60/TL-64): the configuration is loaded by the function that
  // refuses with the right message and the right exit code, and handed to the
  // pass. A typo in `archived_statuses` changes what "closed" means, so slipping
  // through quietly would change the ANSWER, not the appearance.
  const one = collectProject(ROOT, { modifiedFile: FILE_QUERY, config: loadConfigOrExit(ROOT) });
  if (one.error) {
    console.error(`✗ ${ROOT}: ${one.error}`);
    process.exit(2);
  }
  COLLECTED = [one];
}

// A FILTER VALUE OUTSIDE THE VOCABULARY FAILS, exactly as an unknown flag does
// (TL-161). Zero matches caused by a typo are indistinguishable from "there is
// nothing like that", and they read like an answer — an agent asking for
// `--status in-progress` is told there is no work in progress and stops.
// `--tasks <dir>` has no configuration and therefore nothing to check against;
// it passes through untouched rather than refusing every value.
//
// ACROSS PROJECTS the rule is the INTERSECTION: a value is refused only if
// EVERY project refuses it. Judging against one project's vocabulary would
// refuse a query that is perfectly meaningful in the second.
const f = {
  status: splitList(opts.status),
  priority: splitList(opts.priority),
  board: splitList(opts.board),
  label: splitList(opts.label),
  epic: splitList(opts.epic),
  owner: splitList(opts.owner),
  type: splitList(opts.type),
  // `--role ""` is a QUESTION — "what is open to anybody" — and `splitList`
  // cannot express it: it returns null for an empty value, which everywhere else
  // rightly means "this axis is not filtered". Here the empty string is one of
  // the values a task can carry, so the flag being PRESENT is what decides.
  role: opts.role === undefined ? null : (splitList(opts.role) || [""]),
  executor: opts.executor === undefined ? null : (splitList(opts.executor) || [""]),
  blockedBy: splitList(opts["blocked-by"]),
  text: opts.text,
};

const withConfig = COLLECTED.filter((c) => c.config);
const unknownValues = ALL_PROJECTS
  ? unknownEverywhere(withConfig, f, unknownFilterValues)
  : unknownFilterValues(f, withConfig.length ? withConfig[0].config : null);
if (unknownValues.length) {
  for (const p of unknownValues) {
    console.error("✗ `" + p.value + "` is not an allowed value for the field `" + p.axis + "`");
    console.error("  allowed: " + p.allowed.join(" | ") + "   (" + p.where + ")");
  }
  // Said because the refusal would otherwise look like the archive being closed
  // off: `--status` is the flag that LIFTS the active-only default, so it is
  // also how anybody searches closed work.
  if (unknownValues.some((p) => p.axis === "status")) {
    console.error("  `--status` is also how you search the archive — with a value from that list.");
  }
  process.exit(2);
}

// FILTERED PER PROJECT, THEN CONCATENATED. Which status counts as closed is a
// project's own decision (`archived_statuses`), so one shared set would apply
// somebody else's definition of "done" to a project that never agreed to it.
//
// With no explicit --status we are asking about work to be done, not about the
// archive: in a backlog of any age most tasks are closed and would flood every
// answer. Measure your own: `query --status done --count`.
let hits = [];
for (const one of COLLECTED) {
  const archived = new Set(one.config ? one.config.archivedStatuses : ["done", "cancelled"]);
  let some = filterTasks(one.tasks, f, archived);
  // APPLIED AFTER the shared filters, and deliberately not inside `filterTasks`:
  // that module is the one `next` also uses to choose work, and a criterion that
  // needs a git process has no business in the dispatcher's hot path.
  if (one.index) some = some.filter((t) => touches(one.index.byTask.get(t.id) || new Set(), FILE_QUERY));
  hits = hits.concat(some);
}

// The first project that answered decides the vocabularies the OUTPUT is shaped
// by — the scan note, the sort order and the JSON's `scan` key. Across projects
// those are per project and are reported per row; this is the single-project
// answer's shape kept intact.
const PRIMARY = COLLECTED[0] || { config: null, scan: { scanned: false, reason: "no-configuration", branches: [], trees: [] }, index: null };
const CFG = PRIMARY.config;
const SCAN = PRIMARY.scan;
const INDEX = PRIMARY.index;
const ELSEWHERE_ONLY = COLLECTED.flatMap((c) => c.elsewhereOnly);
const elsewhereOnlyLines = ELSEWHERE_ONLY.map(
  (t) => (t.project ? t.project + "/" : "") + t.id +
    " is not in this tree — elsewhere: [" + t.elsewhere.map(describeDivergence).join(", ") + "]"
);
const unavailableLines = UNAVAILABLE.map(
  (p) => "project " + p.project + " did not answer: " + p.why + " (" + p.root + ")"
).concat(ALL_PROJECTS && !COLLECTED.length
  ? ["no registered project could be read — `" + "project list" + "` shows what is registered"]
  : []);

// APPLIED AFTER the shared filters, and deliberately not inside `filterTasks`:
// that module is the one `next` also uses to choose work, and a criterion that
// needs a git process has no business in the dispatcher's hot path.
if (INDEX) {
  hits = hits.filter((t) => touches(INDEX.byTask.get(t.id) || new Set(), FILE_QUERY));
}

// The priority order comes from `config.yaml`; without a configuration
// (`--tasks <dir>` bypasses the root) it falls back to the generic default,
// which is what this file used to hardcode.
const sortKey = opts.sort || "priority";
if (SORT_KEYS.indexOf(sortKey) < 0) {
  console.error(`✗ unknown --sort ${sortKey} (available: ${SORT_KEYS.join(", ")})`);
  process.exit(2);
}
sortTasks(hits, sortKey, {
  priorities: CFG ? CFG.priorities : DEFAULTS.priorities,
  taskIdPrefix: CFG ? CFG.taskIdPrefix : "",
});

const total = hits.length;
const limit = opts.limit ? Number(opts.limit) : null;
if (limit !== null && (!Number.isInteger(limit) || limit < 1)) {
  console.error(`✗ --limit must be a positive integer, got: ${opts.limit}`);
  process.exit(2);
}
const shown = limit ? hits.slice(0, limit) : hits;

if (opts.count) {
  console.log(String(total));
  // On stderr, so a count stays a number for a script. Silence would make a
  // backlog with work on an unmerged branch indistinguishable from one without.
  for (const line of elsewhereOnlyLines) console.error("# " + line);
  for (const line of unavailableLines) console.error("# " + line);
  process.exit(0);
}
if (opts.json) {
  // `total` and `limit` travel WITH the array (TL-72). The text output has
  // always said how much `--limit` cut off; the JSON used to stay silent, so a
  // slice arrived looking exactly like a complete answer.
  //
  // `scan` travels with it for the same reason (TL-73): a consumer must be
  // able to tell "no task differs across branches" from "nobody looked".
  printJson("task-list", {
    tasks: shown,
    total,
    limit,
    scan: { scanned: SCAN.scanned, reason: SCAN.reason, branches: SCAN.branches, trees: SCAN.trees.length },
    // Beside `tasks`, never inside it: a consumer that treats these as ordinary
    // rows would be reporting work this checkout cannot open (TL-145).
    elsewhereOnly: ELSEWHERE_ONLY,
    // `null` unless asked for, and then it says whether the index could be
    // computed at all — zero matches and an unscanned repository are otherwise
    // the same empty `tasks` (TL-75). Present either way: the envelope's rule is
    // that a declared key never goes missing.
    modifiedFile: INDEX ? { query: FILE_QUERY, scanned: INDEX.scanned, reason: INDEX.reason } : null,
    // WHAT THE PASS COULD NOT REACH (TL-36). In the RESULT and not only on
    // stderr: a consumer reading this envelope would otherwise count an
    // incomplete set as complete, and "you moved the repository" would arrive
    // as "that project has no tasks". Always present, `[]` when everything
    // answered — the envelope's rule is that a declared key never goes missing.
    unavailable: UNAVAILABLE,
    projects: ALL_PROJECTS ? { registered: REGISTERED, answered: COLLECTED.length } : null,
  });
  process.exit(0);
}
if (opts.files) {
  for (const t of shown) console.log(t.file);
  if (limit && total > shown.length) {
    console.error(`# showing ${shown.length} of ${total} (limit ${limit})`);
  }
  // On stderr, so a path list stays a path list for `xargs`.
  for (const line of elsewhereOnlyLines) console.error("# " + line);
  for (const line of unavailableLines) console.error("# " + line);
  const note = scanNote(SCAN.reason);
  if (note) console.error("# " + note);
  if (INDEX) {
    const why = explainIndex(INDEX.reason);
    if (why) console.error("# " + why);
  }
  process.exit(0);
}

const q = (s) => `"${String(s ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
for (const t of shown) {
  // THE IDENTITY IS THE PAIR (project, id), NEVER THE ID (TL-36). Numbers are
  // unique within a project, so two backlogs both holding a TL-12 is the normal
  // case; a row that does not name its project is unusable.
  const cells = t.project ? [`project: ${t.project}`, `id: ${t.id}`] : [`id: ${t.id}`];
  cells.push(`priority: ${t.priority}`, `status: ${t.status}`, `board: ${t.board}`);
  if (t.labels.length) cells.push(`labels: [${t.labels.join(", ")}]`);
  if (t.blocked_by.length) cells.push(`blocked_by: [${t.blocked_by.join(", ")}]`);
  if (t.role) cells.push(`role: ${t.role}`);
  if (t.executor) cells.push(`executor: ${t.executor}`);
  if (t.epic) cells.push(`epic: ${q(t.epic)}`);
  // The disagreement is NEVER resolved into one status — both values stand, and
  // each is named with the branch it came from (TL-73).
  if (t.elsewhere.length) {
    cells.push(`elsewhere: [${t.elsewhere.map(describeDivergence).join(", ")}]`);
  }
  cells.push(`title: ${q(t.title)}`);
  console.log(`- {${cells.join(", ")}}`);
}

// The truncation MUST be stated. A list without this line reads as complete —
// the same class of defect as a silent cap in a report: the result looks like an
// answer while it is a slice.
if (limit && total > shown.length) {
  console.log(`# showing ${shown.length} of ${total} matching (limit ${limit})`);
} else if (total === 0) {
  console.log("# 0 matching tasks (check whether the filters exclude one another)");
}

// The tasks that exist only somewhere else, named one per line and kept out of
// the list above — they are not rows of this tree (TL-145).
for (const line of elsewhereOnlyLines) console.log("# " + line);

// AND THE PROJECTS THAT DID NOT ANSWER (TL-36). Never silent: a registry entry
// whose directory moved would otherwise turn into "that project has no tasks",
// and the answer would look complete.
for (const line of unavailableLines) console.log("# " + line);

// A scan that could not run has to SAY so. Silence here is indistinguishable
// from "every branch agrees", and that is the answer this whole mechanism exists
// to stop the tool from giving by accident.
{
  const note = scanNote(SCAN.reason);
  if (note) console.log("# " + note);
}

// The same rule for the file index: an empty answer has two causes and only one
// of them is an answer.
if (INDEX) {
  const why = explainIndex(INDEX.reason);
  if (why) console.log("# " + why);
}
