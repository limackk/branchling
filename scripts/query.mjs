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
import { SORT_KEYS, filterTasks, readTaskRecords, sortTasks, splitList } from "./task-select.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const VALUE_FLAGS = new Set([
  "--status", "--priority", "--board", "--label", "--epic", "--owner", "--type",
  "--role", "--executor", "--blocked-by", "--text", "--limit", "--sort", "--tasks", "--dir",
  "--modified-file",
]);
const BOOL_FLAGS = new Set(["--json", "--files", "--count", "--help", "-h"]);

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

// The data directory: --tasks (pointing straight at tasks/), otherwise the same
// backlog directory resolution as in every other script (BL-1399).
const ROOT = opts.tasks ? null : resolveBacklogDir({ dir: opts.dir, moduleDir: __dirname }).root;
const TASKS_DIR = opts.tasks || backlogPaths(ROOT).tasksDir;

// Which status means "closed" is stated by the project's configuration
// (BL-1400). STRICT (TL-60): a typo in `archived_statuses` changes what
// "closed" means, so slipping through quietly it would change the ANSWER, not
// just the appearance. Zero matches caused by a typo read like an answer.
const CFG = ROOT ? loadConfigOrExit(ROOT) : null;
const ARCHIVED = new Set(CFG ? CFG.archivedStatuses : ["done", "cancelled"]);
// `--tasks <dir>` bypasses the root, so there is no configuration — in that case
// we assume the default "prefix-number" shape without knowing which prefix.
const TASK_FILE = CFG ? CFG.taskId.file : /^[A-Za-z][A-Za-z0-9._-]*-\d+.*\.md$/;

// WHICH TASKS MATCH, AND IN WHAT ORDER, IS NOT DECIDED HERE (TL-87). The
// parser, the filters and the sort orders live in `task-select.mjs`, because
// `next` asks the same question and hands its answer straight to an agent — two
// copies could disagree, and the disagreement would surface as work done on the
// wrong task. This file keeps what is its own: the flags, the output shapes and
// the exit codes.

let tasks;
try {
  tasks = readTaskRecords(TASKS_DIR, TASK_FILE);
} catch (e) {
  console.error(`✗ cannot read ${TASKS_DIR}: ${e.message}`);
  process.exit(2);
}

// WHAT THE OTHER BRANCHES SAY (TL-73). A listing computed from this checkout
// alone reports a task as `pending` while another branch has it `in_progress` —
// the first law's one cost, and the reason this scan is on unless the project
// turns it off. It runs BEFORE the filters, because `--status in_progress` has
// to be able to match a status only another branch has.
const SCAN = ROOT ? crossBranchState(ROOT, CFG) : { scanned: false, reason: "no-configuration", byId: new Map(), branches: [], trees: [] };
for (const t of tasks) t.elsewhere = divergences(t.status, SCAN.byId.get(t.id));

// AND THE TASKS THIS TREE DOES NOT HAVE AT ALL (TL-145). A task created on an
// unmerged branch used to be reported as absent rather than as hidden, which is
// a failure mode that reads as success. They are kept OUT of `tasks`: nothing
// here can be filtered, sorted or counted like a task of this tree, because
// only its id and the status each branch gives it are known.
const ELSEWHERE_ONLY = absentHere(SCAN.byId, tasks.map((t) => t.id));
const elsewhereOnlyLines = ELSEWHERE_ONLY.map(
  (t) => t.id + " is not in this tree — elsewhere: [" + t.elsewhere.map(describeDivergence).join(", ") + "]"
);

// WHICH FILES EACH TASK TOUCHED, computed from git (TL-75). Asked for ONLY when
// the flag is present: it is one `git log` over the whole history, and a listing
// that pays for it unasked would make every other query slower for an answer
// nobody wanted.
const FILE_QUERY = opts["modified-file"];
let INDEX = null;
if (FILE_QUERY !== undefined) {
  if (!CFG) {
    console.error("✗ --modified-file needs the configuration, which `--tasks <dir>` bypasses");
    console.error("  the task id prefix is what links a commit message to a task");
    process.exit(2);
  }
  INDEX = modifiedFiles({ root: repoRoot(ROOT), prefix: CFG.taskIdPrefix });
}

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

// With no explicit --status we are asking about work to be done, not about the
// archive: in a backlog of any age most tasks are closed and would flood every
// answer. Measure your own: `query --status done --count`.
let hits = filterTasks(tasks, f, ARCHIVED);

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
  const cells = [`id: ${t.id}`, `priority: ${t.priority}`, `status: ${t.status}`, `board: ${t.board}`];
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
