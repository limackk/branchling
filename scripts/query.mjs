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
 *   query --release 2026.11       (--release "" = planned for no release)
 *   query --epic "Legal compliance" --priority P0,P1
 *   query --text sync --limit 10
 *   query --blocked-by TASK-003 --files | xargs code
 *   query --modified-file scripts/cli.mjs        (as part of what was it touched)
 *   query --modified-file scripts/               (the whole directory)
 *   query --status done --text audit --count
 *   query --status done --not-env production   (finished, not yet in production)
 *
 * Filters (AND between axes, OR inside an axis — comma-separated values):
 *   --status --priority --board --label --epic --owner --type --role --executor
 *   --release
 *   --blocked-by
 *   --modified-file  which task touched this file — COMPUTED from commit
 *                    messages naming the task id, so there is nothing to keep
 *                    up to date. Paths are relative to the REPOSITORY root; a
 *                    trailing `/` matches a whole directory
 *   --text
 *   --env / --not-env  a deployment stage (`stage` or `target/stage`) the task
 *                    has reached in full, or has not — COMPUTED from git refs
 *                    declared in `deploy_targets:` (TL-501). A task of a
 *                    target in another repository matches neither when that
 *                    repository's half would decide the answer, and the
 *                    output names it as unobservable (TL-512). Counted from
 *                    the remote's default branch, else HEAD — the trunk
 *                    `show` and `deploy status` use — and named (TL-517)
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
import { externalTargetsOf } from "./deploy-targets.mjs";
import { printJson } from "./json-envelope.mjs";
import { printLine } from "./stdout.mjs";
import { explain as explainIndex, modifiedFiles, repoRoot, touches } from "./modified-files.mjs";
import {
  TRUNK_SOURCE_TEXT, defaultTrunk, deploymentScanJson, deploymentState, describeUnknownRefs,
  explain as explainDeploy, parseStageSelector, stageMatches, taskDeployment, taskDeploymentJson,
} from "./environments.mjs";
import { backlogPaths, resolveBacklogDir, resolveBacklogDirOrExit } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { SORT_KEYS, filterTasks, readTaskRecords, sortTasks, splitList, unknownFilterValues } from "./task-select.mjs";
import { refusal } from "./ui.mjs";
import { agentEstimate } from "./agent-time.mjs";
import { readAgentTime } from "./agent-time-read.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

function collectBacklog(root, opts = {}) {
  const config = opts.config;
  const tasks = readTaskRecords(backlogPaths(root).tasksDir, config.taskId.file);
  const scan = crossBranchState(root, config);
  for (const task of tasks) task.elsewhere = divergences(task.status, scan.byId.get(task.id));
  const elsewhereOnly = absentHere(scan.byId, tasks.map((task) => task.id));
  const index = opts.modifiedFile === undefined
    ? null
    : modifiedFiles({ root: repoRoot(root), prefix: config.taskIdPrefix });
  return { root, config, tasks, scan, elsewhereOnly, index };
}

const VALUE_FLAGS = new Set([
  "--status", "--priority", "--board", "--label", "--epic", "--owner", "--type",
  "--role", "--executor", "--release", "--blocked-by", "--text", "--limit", "--sort", "--tasks", "--dir",
  "--modified-file", "--env", "--not-env", "--scope",
]);
const BOOL_FLAGS = new Set(["--json", "--files", "--count", "--help", "-h"]);

// An unknown flag MUST fail. Zero results caused by a typo are indistinguishable
// from "there is no such thing" — and they read like an answer.
const opts = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith("--") && a !== "-h") {
    console.error(refusal(`${N} query`, `unexpected argument: ${a} (every criterion is given as a flag)`,
      [...VALUE_FLAGS, ...BOOL_FLAGS].sort().join(" ")));
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
    console.error(refusal(`${N} query`, `unknown flag: ${a}`,
      [...VALUE_FLAGS, ...BOOL_FLAGS].sort().join(" ")));
    process.exit(2);
  }
}

if (opts.help || opts.h) {
  // Until TL-51 this printed the header of THIS FILE — shebang and the
  // paragraph about token costs included. The content is valuable, but it is a
  // note for a co-author, not help for a user. The list of flags is now DERIVED
  // from the same sets the input is validated against, so it cannot drift away
  // from them; `query --help` goes through the command table in cli.mjs.
  printLine("query — ask the backlog a question instead of reading a whole view\n");
  printLine("usage:");
  printLine("  query [criteria] [--json|--files|--count]\n");
  printLine("criteria (a value follows the flag):");
  printLine("  " + [...VALUE_FLAGS].sort().join(" "));
  printLine("\nswitches:");
  printLine("  " + [...BOOL_FLAGS].filter((f) => f !== "--help" && f !== "-h").sort().join(" "));
  printLine("\nexit code: 0 = the query ran (including on zero matches), 2 = a usage error.");
  process.exit(0);
}

// WHICH TASKS a query searches before any criterion narrows them (TL-540):
// `active` — today's default — `archived`, the statuses `archived_statuses`
// names, or `all`. A consumer building an Open / Archived / All switch would
// otherwise have to name every status, hard-coding the vocabulary and missing
// a task whose status is outside it. `--status` already chooses the statuses
// explicitly, so both together would let one silently override the other.
const SCOPES = ["active", "archived", "all"];
if (opts.scope !== undefined) {
  if (SCOPES.indexOf(opts.scope) < 0) {
    console.error(refusal(`${N} query`, `--scope ${opts.scope} is not a scope`, SCOPES.join(" | ")));
    process.exit(2);
  }
  if (opts.status !== undefined) {
    console.error(refusal(`${N} query`, "--scope and --status both choose which statuses are searched",
      "--scope " + SCOPES.join("|") + ", or --status <s> — not both"));
    process.exit(2);
  }
}
const SCOPE = opts.status !== undefined ? null : (opts.scope || "active");

// The data directory: --tasks (pointing straight at tasks/), otherwise the same
// backlog directory resolution as in every other script (BL-1399).
const ROOT = opts.tasks ? null : resolveBacklogDirOrExit({ dir: opts.dir, moduleDir: __dirname }, N + " query").root;
const TASKS_DIR = opts.tasks || (ROOT ? backlogPaths(ROOT).tasksDir : null);

// `--tasks <dir>` is the third case and stays apart: it points straight at a
// tasks directory, so there is no configuration to read and no branch scan to
// run. It is the only path where the vocabularies are unknown.
const FILE_QUERY = opts["modified-file"];
let COLLECTED = [];

if (opts.tasks) {
  if (opts.env !== undefined || opts["not-env"] !== undefined) {
    console.error("✗ --env and --not-env need the configuration, which `--tasks <dir>` bypasses");
    console.error("  the stages are declared in `deploy_targets:` in config.yaml");
    process.exit(2);
  }
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
} else {
  // STRICT (TL-60/TL-64): the configuration is loaded by the function that
  // refuses with the right message and the right exit code, and handed to the
  // pass. A typo in `archived_statuses` changes what "closed" means, so slipping
  // through quietly would change the ANSWER, not the appearance.
  const one = collectBacklog(ROOT, { modifiedFile: FILE_QUERY, config: loadConfigOrExit(ROOT) });
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
  release: opts.release === undefined ? null : (splitList(opts.release) || [""]),
  blockedBy: splitList(opts["blocked-by"]),
  text: opts.text,
};

const withConfig = COLLECTED.filter((c) => c.config);
const unknownValues = unknownFilterValues(f, withConfig.length ? withConfig[0].config : null);
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

// DEPLOYMENT STATE (TL-501), computed only when something asks for it: a
// `--env`/`--not-env` filter, or `--json` in a project that declares targets.
// A stage name outside `deploy_targets` FAILS for the same reason a status
// outside `statuses` does.
const ENV_SELECTORS = [];
for (const [flag, want] of [["env", "full"], ["not-env", "not-full"]]) {
  if (opts[flag] === undefined) continue;
  const cfg = COLLECTED[0].config;
  const sel = parseStageSelector(opts[flag], cfg.deployTargets);
  if (!sel.ok) {
    console.error("✗ --" + flag + ": " + sel.message);
    process.exit(2);
  }
  ENV_SELECTORS.push({ ...sel, want });
}
//
// THE SAME TRUNK AS `show` AND `deploy status` (TL-517): the remote's default
// branch, else `HEAD`. Counting from `HEAD` made a task worked on an unmerged
// feature branch read as deployed here and not there, and the difference was
// visible only to somebody who compared both headers. The trunk and its source
// are named in every output that shows deployment.
let DEPLOY = null;
let TRUNK = null;
{
  const one = COLLECTED[0];
  if (one.config && (ENV_SELECTORS.length || (opts.json && one.config.deployTargets.length))) {
    const repo = repoRoot(one.root);
    TRUNK = defaultTrunk(repo);
    DEPLOY = deploymentState({
      root: repo, prefix: one.config.taskIdPrefix, targets: one.config.deployTargets, trunk: TRUNK.spec,
    });
    for (const t of one.tasks) {
      t.deploy = taskDeploymentJson(taskDeployment(DEPLOY, t.id), externalTargetsOf(one.config.deployTargets, t));
    }
  }
}
if (opts.json) {
  for (const one of COLLECTED) for (const t of one.tasks) if (t.deploy === undefined) t.deploy = null;
}

// FILTERED PER PROJECT, THEN CONCATENATED. Which status counts as closed is a
// project's own decision (`archived_statuses`), so one shared set would apply
// somebody else's definition of "done" to a project that never agreed to it.
//
// With no explicit --status we are asking about work to be done, not about the
// archive: in a backlog of any age most tasks are closed and would flood every
// answer. Measure your own: `query --status done --count`.
// THE COMPUTED FIELD `agent_estimate` (TL-482), on rows that leave as data. The
// ledger is read once per backlog and only for `--json`: the text output and
// `--count` answer cheaper questions and must not pay for this one. Never on
// disk — it is what the ledger says about this estimate TODAY. `--tasks <dir>`
// has no ledger to read, so its rows say `null` rather than going without the
// key: a consumer must not have to tell "no value" from "a version without it".
if (opts.json) {
  for (const one of COLLECTED) {
    const report = one.root && one.config ? readAgentTime(one.root, one.config, { tasks: one.tasks }) : null;
    for (const t of one.tasks) t.agent_estimate = report ? agentEstimate(report, t.estimate) : null;
  }
}

let hits = [];
// The tasks `--env`/`--not-env` held out because the half that would decide
// the answer lives in another repository (TL-512), per target. Collected so
// the output can say why they are missing: dropped silently they read as "not
// deployed anywhere", which is the false answer TL-507 exists to prevent.
const HELD_UNOBSERVABLE = new Map();
for (const one of COLLECTED) {
  const archived = new Set(one.config ? one.config.archivedStatuses : ["done", "cancelled"]);
  // `archived` and `all` lift the active-only default; `archived` then keeps
  // the closed ones by this tree's own status, the same test that default uses.
  let some = filterTasks(one.tasks, f, SCOPE === "active" ? archived : new Set());
  if (SCOPE === "archived") some = some.filter((t) => archived.has(t.status));
  // APPLIED AFTER the shared filters, and deliberately not inside `filterTasks`:
  // that module is the one `next` also uses to choose work, and a criterion that
  // needs a git process has no business in the dispatcher's hot path.
  if (one.index) some = some.filter((t) => touches(one.index.byTask.get(t.id) || new Set(), FILE_QUERY));
  // A task that touched no target declaring the stage, or whose answer hangs
  // on a ref that did not resolve, matches NEITHER filter: it is not "in
  // production" and it is not "missing from production" either.
  //
  // A task the other repository's half would decide is named, but only when
  // that is the reason it is missing: a selector it fails outright excludes it
  // on its own, whatever the other repository holds.
  if (DEPLOY && ENV_SELECTORS.length) {
    some = some.filter((t) => {
      const away = externalTargetsOf(one.config.deployTargets, t);
      const answers = ENV_SELECTORS.map((sel) => stageMatches(taskDeployment(DEPLOY, t.id), sel, away));
      if (answers.every((a, i) => a === ENV_SELECTORS[i].want)) return true;
      if (answers.some((a) => a === "unobservable") &&
          answers.every((a, i) => a === "unobservable" || a === ENV_SELECTORS[i].want)) {
        for (const x of away) {
          if (!HELD_UNOBSERVABLE.has(x.name)) HELD_UNOBSERVABLE.set(x.name, { target: x.name, repository: x.repository, tasks: [] });
          HELD_UNOBSERVABLE.get(x.name).tasks.push(t.id);
        }
      }
      return false;
    });
  }
  hits = hits.concat(some);
}

// The resolved backlog decides the vocabularies the output is shaped by.
const PRIMARY = COLLECTED[0] || { config: null, scan: { scanned: false, reason: "no-configuration", branches: [], trees: [] }, index: null };
const CFG = PRIMARY.config;
const SCAN = PRIMARY.scan;
const INDEX = PRIMARY.index;
const ELSEWHERE_ONLY = COLLECTED.flatMap((c) => c.elsewhereOnly);
const elsewhereOnlyLines = ELSEWHERE_ONLY.map(
  (t) => (t.project ? t.project + "/" : "") + t.id +
    " is not in this tree — elsewhere: [" + t.elsewhere.map(describeDivergence).join(", ") + "]"
);

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
  printLine(String(total));
  // On stderr, so a count stays a number for a script. Silence would make a
  // backlog with work on an unmerged branch indistinguishable from one without.
  for (const line of elsewhereOnlyLines) console.error("# " + line);
  for (const line of deployNotes()) console.error("# " + line);
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
    // Which tasks were searched (TL-540): `active`, `archived` or `all`, and
    // null when `--status` named the statuses itself.
    scope: SCOPE,
    scan: { scanned: SCAN.scanned, reason: SCAN.reason, branches: SCAN.branches, trees: SCAN.trees.length },
    // Beside `tasks`, never inside it: a consumer that treats these as ordinary
    // rows would be reporting work this checkout cannot open (TL-145).
    elsewhereOnly: ELSEWHERE_ONLY,
    // `null` unless asked for, and then it says whether the index could be
    // computed at all — zero matches and an unscanned repository are otherwise
    // the same empty `tasks` (TL-75). Present either way: the envelope's rule is
    // that a declared key never goes missing.
    modifiedFile: INDEX ? { query: FILE_QUERY, scanned: INDEX.scanned, reason: INDEX.reason } : null,
    // `null` unless deployment state was computed (TL-501), and then whether it
    // could be, from which trunk, and EVERY ref it read with its SHA: the answer
    // is only as fresh as those refs, and an unresolved one is `unknown`.
    // `unobservable` beside it lists, per target in another repository, the
    // tasks `--env`/`--not-env` held out because that repository's half would
    // decide the answer (TL-512) — `[]` when no such filter ran.
    // `trunk.source` says whether it is the remote's default branch or the
    // `HEAD` fallback, as in `show --json` (TL-517).
    deploy: DEPLOY ? deployEnvelope() : null,
    // WHAT THE PASS COULD NOT REACH (TL-36). In the RESULT and not only on
    // stderr: a consumer reading this envelope would otherwise count an
    // incomplete set as complete, and "you moved the repository" would arrive
    // as "that project has no tasks". Always present, `[]` when everything
    // answered — the envelope's rule is that a declared key never goes missing.
  });
  process.exit(0);
}
if (opts.files) {
  // SYNCHRONOUSLY (TL-175). `--files` exists to be piped into `xargs`, and a
  // list cut off at one pipe buffer would silently open the wrong subset of
  // files — the same defect as the truncated JSON, in the output most likely
  // to be long.
  for (const t of shown) printLine(t.file);
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
  for (const line of deployNotes()) console.error("# " + line);
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
  if (t.release) cells.push(`release: ${t.release}`);
  if (t.target && t.target.length) cells.push(`target: [${t.target.join(", ")}]`);
  // The disagreement is NEVER resolved into one status — both values stand, and
  // each is named with the branch it came from (TL-73).
  if (t.elsewhere.length) {
    cells.push(`elsewhere: [${t.elsewhere.map(describeDivergence).join(", ")}]`);
  }
  cells.push(`title: ${q(t.title)}`);
  printLine(`- {${cells.join(", ")}}`);
}

// The truncation MUST be stated. A list without this line reads as complete —
// the same class of defect as a silent cap in a report: the result looks like an
// answer while it is a slice.
if (limit && total > shown.length) {
  printLine(`# showing ${shown.length} of ${total} matching (limit ${limit})`);
} else if (total === 0) {
  printLine("# 0 matching tasks (check whether the filters exclude one another)");
}

// The tasks that exist only somewhere else, named one per line and kept out of
// the list above — they are not rows of this tree (TL-145).
for (const line of elsewhereOnlyLines) printLine("# " + line);

// A scan that could not run has to SAY so. Silence here is indistinguishable
// from "every branch agrees", and that is the answer this whole mechanism exists
// to stop the tool from giving by accident.
{
  const note = scanNote(SCAN.reason);
  if (note) printLine("# " + note);
}

// The same rule for the file index: an empty answer has two causes and only one
// of them is an answer.
if (INDEX) {
  const why = explainIndex(INDEX.reason);
  if (why) printLine("# " + why);
}

// The same rule for deployment state: an unresolved ref is unknown, and an
// empty answer says which empty it is.
for (const line of deployNotes()) printLine("# " + line);

function deployEnvelope() {
  const scan = deploymentScanJson(DEPLOY);
  return { ...scan, trunk: { ...scan.trunk, source: TRUNK.source }, unobservable: heldUnobservable() };
}

function deployNotes() {
  if (!DEPLOY || !ENV_SELECTORS.length) return [];
  const lines = [];
  // Named on every answer that filtered by deployment, so a reader comparing it
  // with `show` or `deploy status` can see it was counted from the same place.
  lines.push("deployment counted from trunk " + DEPLOY.trunk.spec + " " +
    (DEPLOY.trunk.sha ? DEPLOY.trunk.sha.slice(0, 12) : "unresolved") + " (" + TRUNK_SOURCE_TEXT[TRUNK.source] + ")");
  const why = explainDeploy(DEPLOY.reason);
  if (why) lines.push(why);
  for (const l of describeUnknownRefs(DEPLOY)) lines.push(l + " — tasks that depend on it match neither --env nor --not-env");
  for (const u of heldUnobservable()) {
    lines.push(u.target + ": unobservable — deployed from `" + u.repository + "`, which is not read here, so " +
      u.tasks.join(", ") + (u.tasks.length === 1 ? " matches" : " match") + " neither --env nor --not-env");
  }
  return lines;
}

function heldUnobservable() {
  const byId = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
  return [...HELD_UNOBSERVABLE.values()]
    .sort((a, b) => a.target.localeCompare(b.target))
    .map((u) => ({ target: u.target, repository: u.repository, tasks: [...u.tasks].sort(byId) }));
}
