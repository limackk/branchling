#!/usr/bin/env node
/**
 * build-backlog.mjs — the generator of the three-layer backlog view.
 *
 * SOURCE OF TRUTH: the frontmatter of `tasks/<ID>-*.md`. This script changes
 * NOTHING in the tasks — it only aggregates. It produces three files (all
 * GENERATED; do not edit them by hand — change the `.md` and run
 * the `build` command):
 *
 *   NOW.yaml           — "what now": in_progress + blocked + pending P0.
 *                        DERIVED from status and priority — there is no field to
 *                        maintain. The agent's default read.
 *   INDEX.yaml         — every ACTIVE task (a status outside archived_statuses),
 *                        one line each, grouped by epic, plus auto-stats.
 *   archive/done.yaml  — closed tasks, a minimal entry each. Grep-only.
 *
 * Zero dependencies. The frontmatter parser is the same subset as in
 * build-viewer.mjs.
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfigOrExit } from "./config.mjs";
import { detectPrefixMismatch, prefixMismatchMessage } from "./task-id.mjs";
import { resolveBacklogDirOrExit } from "./paths.mjs";
import { buildFieldSpecs, extractMeta as sharedExtractMeta, normalizeValue, stripComment } from "./task-fields.mjs";
import { MARK, color, errColor, refusal } from "./ui.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";


const OKM = color.ok(MARK.ok);
const ERRM = errColor.err(MARK.err);
const __dirname = dirname(fileURLToPath(import.meta.url));

// `--root <dir>` — the backlog directory to build. Without the flag: the
// directory above this script, which is the ordinary call from a repository. The
// flag exists so that the generator can be run against a temporary tree in a test
// — without it the only possible test would be one against the live backlog, and
// such a test cannot exercise the cases the repository (fortunately) does not
// have: an unknown board slug, a task with no `board` field.
// `--dir` is the canonical name since BL-1399 (every script accepts it the same
// way); `--root` stays as an alias, because existing tests and calls use it.
const rootFlag = process.argv.indexOf("--root") !== -1
  ? process.argv.indexOf("--root")
  : process.argv.indexOf("--dir");
// BL-1445: through `resolveBacklogDir`, not through `join(__dirname, "..")`.
// That shortcut is pure CO-LOCATION and works only when the code sits ABOVE the
// data (`backlog/scripts` next to `backlog/tasks`). In the layout the module is
// intended for — code in `<repo>/scripts` or in `node_modules`, data in
// `<repo>/backlog` — `__dirname/..` points at the repository root and the
// generator looks for `boards.yaml` in the wrong place. The resolver knows four
// sources and keeps co-location LAST, so the existing behaviour is untouched.
// Regression: scripts/tests/non-colocated-layout.test.mjs
const BACKLOG_DIR = resolveBacklogDirOrExit({
  dir: rootFlag !== -1 && process.argv[rootFlag + 1] ? process.argv[rootFlag + 1] : undefined,
  moduleDir: __dirname,
}, N + " build").root;

// An unknown flag FAILS (BL-1417) — the rest of the process builds the views
// without asking, so quietly accepting a typo would look like success with zero
// evidential force (the same class of defect BL-1411 fixed in the server).
{
  const KNOWN = new Set(["--root", "--dir"]);
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("-")) {
      if (i > 0 && KNOWN.has(argv[i - 1])) continue; // the value of --root/--dir
      console.error(refusal(N + " build", "unexpected argument: " + a, "--root <path> --dir <path>"));
      process.exit(2);
    }
    if (!KNOWN.has(a)) {
      console.error(refusal(N + " build", "unknown flag: " + a, "--root <path> --dir <path>"));
      process.exit(2);
    }
  }
}
const TASKS_DIR = join(BACKLOG_DIR, "tasks");
const ARCHIVE_DIR = join(BACKLOG_DIR, "archive");

// ──────────────────────────────────────────────────────────────────────────
// Epic normalisation — merge ONLY obvious duplicates. Epics whose meanings
// genuinely differ stay separate (add a mapping in config.yaml when you want to
// merge more). The key is the variant found in the frontmatter, the value is the
// canonical form.
// ──────────────────────────────────────────────────────────────────────────
// STRICT (TL-60): this is the command named by the promise in the generated
// `config.yaml` — "an unknown key fails the build". Until TL-60 it was false.
const CONFIG = loadConfigOrExit(BACKLOG_DIR);
const EPIC_ALIASES = CONFIG.epicAliases;
const UNCATEGORIZED = "(no epic)";

if (CONFIG.problems.length) {
  console.error(ERRM + " the backlog configuration is inconsistent:");
  for (const p of CONFIG.problems) console.error("  " + p);
  process.exit(1);
}

// ──────────────────────────────────────────────────────────────────────────
// Boards — the backlog partition. Unlike the epic, this vocabulary is CLOSED: it
// lives in `boards.yaml` and an unknown slug fails the build. The reason is
// asymmetric with the epic: a board is sometimes chosen by an agent when the user
// does not supply one, so a typo here is not cosmetic — it would create a third
// board nobody reads, and the task would vanish from both of the views anybody
// actually opens.
//
// The parser deliberately handles EXACTLY the shape found in boards.yaml (a flat
// list of `- slug:` blocks plus `default:`) and nothing more — the module has no
// dependencies, and a pretend "almost YAML" breaks worse than a narrow parser
// that simply does not find a field. No `boards.yaml` means no partition, not a
// silent default.
// ──────────────────────────────────────────────────────────────────────────
function readBoards() {
  // The boards.yaml parser lives in config.mjs (BL-1400) — until then the same
  // shape was read by three independent copies. The "default points at a board
  // that exists" validation is done by loadConfig(); what stays here is only the
  // refusal to work without a registry, because a missing partition is not a
  // silent default.
  if (!CONFIG.boards.length) {
    console.error(`${ERRM} no board registry in ${BACKLOG_DIR}/boards.yaml — \`${N} init\` writes one`);
    process.exit(1);
  }
  const names = {};
  for (const b of CONFIG.boards) names[b.slug] = b.name;
  return { slugs: CONFIG.boards.map((b) => b.slug), names, default: CONFIG.defaultBoard };
}

const BOARDS = readBoards();

// The field specs the SERVER and the VIEWER validate with. The build asks the
// same question of the tree it is about to render, so a value is judged by one
// rule wherever it is written — see the role gate in the read loop below.
const FIELD_SPECS = buildFieldSpecs(CONFIG);

function normalizeEpic(raw) {
  const e = (raw || "").trim();
  if (!e) return UNCATEGORIZED;
  return EPIC_ALIASES[e] || e;
}

// ──────────────────────────────────────────────────────────────────────────
// Status — the vocabulary comes from the project's configuration (BL-1400), not
// from this file, and ACTIVE means every status outside `archived_statuses`.
// ──────────────────────────────────────────────────────────────────────────
// The order of the priorities in config.yaml IS the sort order of the views.
const ARCHIVED_STATUSES = new Set(CONFIG.archivedStatuses);
const PRIORITY_ORDER = CONFIG.priorities.reduce((acc, p, i) => { acc[p] = i; return acc; }, {});

// ── Frontmatter parser ────────────────────────────────────────────────────
// ONE parser, in `task-fields.mjs`. The copy that used to live here read a
// value with `.replace(/^["']|["']$/g, "")`, which returns the comment beside
// the field as part of the value: a task fresh out of `new` landed in
// INDEX.yaml with `epic: "\"   # free text — …"` (TL-70).
function splitFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { frontmatter: "", body: text };
  return { frontmatter: match[1], body: match[2] };
}

function extractMeta(frontmatter) {
  const meta = sharedExtractMeta(frontmatter);
  // `name:` is tolerated as a legacy alias of `id:` (old tasks). It is not part
  // of the field schema, so the shared parser does not know it.
  if (!meta.id) {
    const m = frontmatter.match(/^name:\s*(.+?)\s*$/m);
    if (m) meta.id = unquote(stripComment(m[1]));
  }
  return meta;
}

function unquote(v) {
  return v.length >= 2 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))
    ? v.slice(1, -1)
    : v;
}

// ── YAML emit helpers ─────────────────────────────────────────────────────
function yStr(s) {
  if (s === null || s === undefined) return '""';
  const str = String(s);
  if (str === "") return '""';
  // Quote when the value contains characters that are risky for a YAML flow or
  // plain scalar.
  if (/[:#\[\]{}&*!|>'"%@`]|^[\s-]|[\s-]$|^[?,]/.test(str)) {
    return `"${str.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return str;
}
/**
 * A scalar inside a flow mapping `{...}`. The rules are STRICTER than in yStr:
 * there a value is ended by the end of the line, here it is also ended by `,`
 * `}` `[` `]`. A title containing a comma would, unquoted, split the row into two
 * fields. So we always quote — two characters per task is not a price worth
 * negotiating with a parser over.
 */
function yFlowStr(s) {
  const str = String(s ?? "");
  return `"${str.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function yList(arr) {
  if (!arr || arr.length === 0) return "[]";
  return `[${arr.map(yStr).join(", ")}]`;
}

// ──────────────────────────────────────────────────────────────────────────
// Read every task.
// ──────────────────────────────────────────────────────────────────────────
const allNames = readdirSync(TASKS_DIR);

// A mismatch between the configuration and the tree MUST fail BEFORE anything is
// written (BL-1452). Without this, a backlog of `BL-*.md` files under a
// configuration saying `TASK` reads zero tasks and rebuilds the views as EMPTY
// over real data — with a success message. That is data loss, not a typo.
const mismatch = detectPrefixMismatch(allNames, CONFIG.taskIdPrefix);
if (!mismatch.ok) {
  console.error(prefixMismatchMessage(mismatch, TASKS_DIR));
  process.exit(1);
}

const files = allNames.filter((f) => CONFIG.taskId.file.test(f)).sort();

const tasks = [];
const warnings = [];
const boardErrors = [];
const roleErrors = [];
for (const file of files) {
  const raw = readFileSync(join(TASKS_DIR, file), "utf8");
  const { frontmatter } = splitFrontmatter(raw);
  const meta = extractMeta(frontmatter);
  if (!meta.id) {
    // We NEVER lose a task silently — we take the id from the filename and warn.
    const m = file.match(CONFIG.taskId.fileId);
    meta.id = m ? m[1] : file.replace(/\.md$/, "");
    warnings.push(`⚠ ${file}: no id field in the frontmatter — used "${meta.id}" from the filename (fix the .md)`);
  }
  if (!frontmatter) {
    warnings.push(`⚠ ${file}: no frontmatter found (is there a --- at the top of the file?) — the fields will be empty`);
  }
  meta.file = `tasks/${file}`;
  meta.epicNorm = normalizeEpic(meta.epic);
  // Board: no field means the registry default plus a warning (a task that
  // predates boards still builds). A slug outside the registry is a hard error
  // below — we do not want a task that has fallen out of every per-board view.
  // The `focus` field was abolished (BL-1386) — NOW.yaml derives "what now" from
  // the status. We warn instead of ignoring: a copied old task would bring back a
  // bit nobody clears, and a second, invisible definition of "what we are doing
  // now" would start to grow.
  if (/^focus:/m.test(frontmatter)) {
    warnings.push(`⚠ ${file}: the \`focus\` field is abolished — remove it (NOW.yaml derives "what now" from the status)`);
  }
  if (!meta.board) {
    meta.board = BOARDS.default;
    warnings.push(`⚠ ${file}: no board field — assumed "${BOARDS.default}" (add \`board:\` to the frontmatter)`);
  } else if (!BOARDS.slugs.includes(meta.board)) {
    boardErrors.push(`⚠ ${file}: unknown board "${meta.board}" — allowed: ${BOARDS.slugs.join(", ")} (boards.yaml)`);
  }
  // Role: a CLOSED vocabulary, and a hard error for the same asymmetric reason
  // as the board (TL-97). A typo here does not produce a task with an odd
  // label — it produces a requirement no dispatcher can satisfy, so the task
  // silently leaves every specialised queue while still looking `pending` in
  // every view. The rule is `normalizeValue`, the one the viewer and the server
  // already validate writes with; the build only names the file it read it in.
  if (meta.role) {
    const verdict = normalizeValue("role", meta.role, { fields: FIELD_SPECS });
    if (!verdict.ok) roleErrors.push(`⚠ ${file}: ${verdict.error}`);
  }
  tasks.push(meta);
}

// An id collision — two tasks carrying the same number. It happens when two
// sessions work in parallel: both read the same "highest free number" and both
// take it. It used to pass in silence: INDEX.yaml simply got two rows with the
// same `id:`, and references from other documents stopped pointing at one task
// unambiguously. The views are ALWAYS produced (a collision must not leave
// NOW/INDEX in their pre-edit state), but the generator exits 1 when a collision
// exists. Previously this was a warning alone at exit 0 — a detector nothing
// could fail on: four collisions survived in main for months even though this
// code saw them on every run. The hard gate is the pre-commit hook (plus
// pre-merge-commit, because a clean merge does not invoke pre-commit); the point
// here is that a call from an editor hook is loud too, instead of looking like
// success.
const byId = new Map();
for (const t of tasks) {
  if (!byId.has(t.id)) byId.set(t.id, []);
  byId.get(t.id).push(t.file);
}
let collisions = 0;
for (const [id, whichFiles] of byId) {
  if (whichFiles.length > 1) {
    collisions++;
    warnings.push(
      `⚠ ID COLLISION ${id}: ${whichFiles.join(" + ")} — renumber one of them (references to "${id}" are ambiguous)`,
    );
  }
}

const active = tasks.filter((t) => !ARCHIVED_STATUSES.has(t.status));
const archived = tasks.filter((t) => ARCHIVED_STATUSES.has(t.status));

function byPriorityThenId(a, b) {
  const pa = PRIORITY_ORDER[a.priority] ?? 9;
  const pb = PRIORITY_ORDER[b.priority] ?? 9;
  if (pa !== pb) return pa - pb;
  return (a.id || "").localeCompare(b.id || "");
}

// BL-890 — a build-time stamp is safe HERE, and the condition is worth stating
// because it is not obvious: nothing byte-compares this generator's output
// against disk. There is no `--check` mode and no pre-commit guard that renders
// and diffs, so the stamp cannot make a check fail overnight. Its growth-kb twin
// DID have such a guard, and the clock made it fail every day for everyone,
// which trained `--no-verify` past the entire guard chain.
//
// If you ever add a `--check`/drift guard to this generator, this line becomes
// that bug: derive the date from the DATA (as `build-growth-kb.mjs` now does
// from the newest `fetched:`) before you add the guard, not after.
const TODAY = new Date().toISOString().slice(0, 10);
const GEN_HEADER = (title, extra) =>
  `# ${title}
# =============================================================================
# GENERATED FILE — DO NOT EDIT BY HAND.
#     Source of truth: tasks/${CONFIG.taskIdPrefix}-NNN-*.md (frontmatter).
#     Rebuild with:    ${N} build
# =============================================================================
# Generated: ${TODAY}
${extra || ""}`;

// ──────────────────────────────────────────────────────────────────────────
// NOW.yaml — "what now", DERIVED from status and priority.
//
// It replaced a FOCUS.yaml and a `focus` field. The reason was a measurement, not
// a preference: at 55 entries the flag had stopped discriminating — 10 items
// untouched for months, 11 flags on tasks that were already `done`, and 93 active
// P0/P1 tasks sitting OUTSIDE the focus. The file was therefore answering "what
// did somebody declare once", not "what are we doing now". A manual bit nobody
// clears always tends towards that state; a derived value cannot rot, because
// there is nothing to fail to clear.
//
// Three sections, each answering a different question:
//   in_progress — what is STARTED (finish it before starting more),
//   blocked     — what is waiting on a decision (that is work too: unblock or cancel),
//   next        — pending P0, the critical work nobody has touched.
// An ordinary `pending` P1-P3 does not enter NOW — that is what the INDEX is for.
//
// NO CAP, DELIBERATELY. Cutting the list to ten items would hide the fact that 43
// things are in progress; the header is there to NAME it. This file has no right
// to mask a WIP leak, because that is the one thing it can say about it.
// ──────────────────────────────────────────────────────────────────────────
const WIP_WARN_AT = 10;

function nowRow(t, scope) {
  const cells = [`id: ${t.id}`, `priority: ${t.priority}`];
  if (!scope) cells.push(`board: ${t.board}`);
  if (t.blocked_by.length) cells.push(`blocked_by: ${yList(t.blocked_by)}`);
  if (t.epicNorm !== UNCATEGORIZED) cells.push(`epic: ${yFlowStr(t.epicNorm)}`);
  cells.push(`title: ${yFlowStr(t.title)}`);
  return `  - {${cells.join(", ")}}\n`;
}

function writeNow(path, activeList, scope) {
  const inProgress = activeList.filter((t) => t.status === "in_progress").sort(byPriorityThenId);
  const blocked = activeList.filter((t) => t.status === "blocked").sort(byPriorityThenId);
  const next = activeList
    .filter((t) => t.status === "pending" && t.priority === "P0")
    .sort(byPriorityThenId);

  const wipNote =
    inProgress.length > WIP_WARN_AT
      ? `
#
# ⚠ ${inProgress.length} tasks in progress at once. That many things do not get done in
#   parallel — some of them are abandoned starts. Close them or put them back to
#   \`pending\` before taking on more (warning threshold: ${WIP_WARN_AT}).`
      : "";

  let out =
    GEN_HEADER(
      scope ? `${CONFIG.projectName} — NOW · board ${scope}` : `${CONFIG.projectName} — NOW (what now)`,
      `#
# THE DEFAULT LAYER — this is the file to read first.
#
# The contents are DERIVED, not declared — there is no field anybody has to
# remember to set or to clear:
#   in_progress — status: in_progress (started),
#   blocked     — status: blocked (waiting on a decision),
#   next        — status: pending + priority: P0 (critical, still untouched).
# The rest of the backlog: ${scope ? "INDEX.yaml in this directory" : "INDEX.yaml"}. Closed work: archive/done.yaml.
${scope
  ? `# SCOPE: board \`${scope}\` (${BOARDS.names[scope]}). The global view: ../../NOW.yaml.`
  : "# SCOPE: every board. Per board: boards/<slug>/NOW.yaml."}${wipNote}
`
    ) + "\n";

  out += `counts: {in_progress: ${inProgress.length}, blocked: ${blocked.length}, next_p0: ${next.length}}\n`;
  for (const [name, list, empty] of [
    ["in_progress", inProgress, "nothing has been started"],
    ["blocked", blocked, "nothing is waiting to be unblocked"],
    ["next", next, "no untouched P0"],
  ]) {
    out += `\n${name}:\n`;
    if (!list.length) out += `  []  # ${empty}\n`;
    else for (const t of list) out += nowRow(t, scope);
  }
  writeFileSync(path, out);
}

// ──────────────────────────────────────────────────────────────────────────
// INDEX.yaml — every active task, one line each, grouped by epic.
// ──────────────────────────────────────────────────────────────────────────
function writeIndex(path, activeList, archivedCount, scope) {
  const byStatus = {};
  const byPriority = {};
  const byLabel = {};
  const byBoard = {};
  for (const t of activeList) {
    byStatus[t.status] = (byStatus[t.status] || 0) + 1;
    byPriority[t.priority] = (byPriority[t.priority] || 0) + 1;
    byBoard[t.board] = (byBoard[t.board] || 0) + 1;
    for (const l of t.labels) byLabel[l] = (byLabel[l] || 0) + 1;
  }
  const fmtCount = (obj) =>
    Object.keys(obj)
      .sort()
      .map((k) => `    ${k}: ${obj[k]}`)
      .join("\n");

  let out = GEN_HEADER(
    scope ? `${CONFIG.projectName} — INDEX · board ${scope}` : `${CONFIG.projectName} — INDEX (active tasks)`,
    `#
# An INDEX of every active task (status outside: ${CONFIG.archivedStatuses.join(", ")}),
# grouped by epic, sorted ${CONFIG.priorities[0]}→${CONFIG.priorities[CONFIG.priorities.length - 1]}. Closed work: archive/done.yaml.
#
# ONE LINE PER TASK — only the fields work is chosen by. The full description
# (type, owner, estimate, confidence, created, updated, blocks, related_docs,
# steps, acceptance criteria) is in the task file, which is the source of truth:
#     ls tasks/${CONFIG.taskIdPrefix}-123-*.md   # a glob on the id alone is unambiguous
# \`epic\` is not repeated on the row — it stands in the group header. \`blocks\` is
# not indexed — it is the inverse of \`blocked_by\` and follows from the other rows.
${scope
  ? `# SCOPE: board \`${scope}\` (${BOARDS.names[scope]}). The global view: ../../INDEX.yaml.`
  : "# SCOPE: every board. Per board: boards/<slug>/INDEX.yaml."}
# What now (a subset): NOW.yaml.
#
# The labels / types / statuses / priorities vocabulary lives in config.yaml.
`
  );

  out += `\nstats:\n`;
  out += `  generated: ${TODAY}\n`;
  if (scope) out += `  board: ${scope}\n`;
  out += `  active_total: ${activeList.length}\n`;
  out += `  archived_total: ${archivedCount}  # see archive/done.yaml\n`;
  out += `  by_status:\n${fmtCount(byStatus)}\n`;
  out += `  by_priority:\n${fmtCount(byPriority)}\n`;
  out += `  by_board:\n${fmtCount(byBoard)}\n`;
  out += `  by_label:\n${fmtCount(byLabel)}\n`;

  // grouping by epic — the epics sorted by the highest priority inside each group
  const epics = {};
  for (const t of activeList) {
    if (!epics[t.epicNorm]) epics[t.epicNorm] = [];
    epics[t.epicNorm].push(t);
  }
  const epicNames = Object.keys(epics).sort((a, b) => {
    const minA = Math.min(...epics[a].map((t) => PRIORITY_ORDER[t.priority] ?? 9));
    const minB = Math.min(...epics[b].map((t) => PRIORITY_ORDER[t.priority] ?? 9));
    if (minA !== minB) return minA - minB;
    return a.localeCompare(b);
  });

  out += `\ntasks:\n`;
  for (const epic of epicNames) {
    const group = epics[epic].sort(byPriorityThenId);
    out += `\n  # ─── EPIC: ${epic} (${group.length}) ───────────────────────\n`;
    for (const t of group) {
      // ONE line per task. The INDEX is an index, not a copy of the frontmatter:
      // the full fields stand in tasks/<id>-*.md, which is the single source of
      // truth. The previous format mirrored 15 lines per task — measured at 149 KB
      // on a real backlog, most of it data nobody uses to CHOOSE work.
      //
      // What is deliberately absent here:
      //   epic      — it stands in the group header; on the row it would be paid
      //               for once per task;
      //   blocks    — the inverse of `blocked_by`, derivable from the same file;
      //   file      — the filename is `tasks/<id>-*.md` and the glob is
      //               unambiguous, because the identity guard guarantees one id,
      //               one file;
      //   type/owner/estimate/confidence/created/updated — a description of the
      //               task, not a criterion for choosing it.
      const cells = [
        `id: ${t.id}`,
        `priority: ${t.priority}`,
        `status: ${t.status}`,
      ];
      // In a per-board view `board:` would be the same thing as `epic` on the
      // row: a constant repeated on every line that the file header has already
      // given.
      if (!scope) cells.push(`board: ${t.board}`);
      if (t.labels.length) cells.push(`labels: ${yList(t.labels)}`);
      if (t.blocked_by.length) cells.push(`blocked_by: ${yList(t.blocked_by)}`);
      // The title goes last — it is the only field of variable length, so the
      // columns to its left stay readable at a glance despite having no padding.
      cells.push(`title: ${yFlowStr(t.title)}`);
      out += `  - {${cells.join(", ")}}\n`;
    }
  }
  writeFileSync(path, out);
}

// ── The global view (unchanged for everything that reads it today) ─────────
writeNow(join(BACKLOG_DIR, "NOW.yaml"), active, null);
writeIndex(join(BACKLOG_DIR, "INDEX.yaml"), active, archived.length, null);

// ── The per-board views ───────────────────────────────────────────────────
// A partition, not a filter: the sum of the tasks across all boards equals
// `active`, because every task has exactly one board (no field → the default, an
// unknown one → an error).
const BOARDS_DIR = join(BACKLOG_DIR, "boards");
for (const slug of BOARDS.slugs) {
  const dir = join(BOARDS_DIR, slug);
  mkdirSync(dir, { recursive: true });
  const activeB = active.filter((t) => t.board === slug);
  const archivedB = archived.filter((t) => t.board === slug);
  writeNow(join(dir, "NOW.yaml"), activeB, slug);
  writeIndex(join(dir, "INDEX.yaml"), activeB, archivedB.length, slug);
}

// ──────────────────────────────────────────────────────────────────────────
// archive/done.yaml — the archived statuses, a minimal entry each.
// ──────────────────────────────────────────────────────────────────────────
{
  mkdirSync(ARCHIVE_DIR, { recursive: true });
  const sorted = [...archived].sort((a, b) => (a.id || "").localeCompare(b.id || ""));
  let out =
    GEN_HEADER(
      `${CONFIG.projectName} — ARCHIVE (${CONFIG.archivedStatuses.join(" + ")})`,
      `#
# Closed tasks. Grep-only: look in here when you want to check whether something
# has already been done. The full context is still in tasks/${CONFIG.taskIdPrefix}-NNN-*.md.
`
    ) + `\ndone:\n`;
  for (const t of sorted) {
    out += `  - id: ${t.id}\n`;
    out += `    title: ${yStr(t.title)}\n`;
    out += `    status: ${t.status}\n`;
    out += `    board: ${t.board}\n`;
    out += `    epic: ${yStr(t.epicNorm)}\n`;
    out += `    file: ${t.file}\n`;
    if (t.updated) out += `    updated: ${t.updated}\n`;
  }
  writeFileSync(join(ARCHIVE_DIR, "done.yaml"), out);
}

// ── The report ────────────────────────────────────────────────────────────
for (const w of warnings) console.error(w);
for (const e of boardErrors) console.error(e);
for (const e of roleErrors) console.error(e);
const perBoard = BOARDS.slugs
  .map((s) => `${s}: ${active.filter((t) => t.board === s).length}`)
  .join(", ");
console.log(
  `${OKM} backlog generated: ${tasks.length} tasks → ` +
    `${active.length} active (INDEX.yaml), ` +
    `${active.filter((t) => t.status === "in_progress").length} in progress (NOW.yaml), ` +
    `${archived.length} archived (archive/done.yaml)\n` +
    `  boards (active): ${perBoard} → boards/<slug>/{NOW,INDEX}.yaml`
);

// The views are written — only now do we signal failure, so that a collision does
// not leave the generated files stale.
if (collisions > 0) {
  console.error(
    `\n✗ ${collisions} id collision${collisions === 1 ? "" : "s"} — one ${CONFIG.taskIdPrefix}-NNN, one task. ` +
      `Renumber the one with FEWER references and repoint them in the same commit.`,
  );
}
if (boardErrors.length > 0) {
  console.error(
    `\n✗ ${boardErrors.length} task(s) with a board outside the registry — fix \`board:\` in the ` +
      `frontmatter, or add the board to boards.yaml.`,
  );
}
if (roleErrors.length > 0) {
  console.error(
    `\n✗ ${roleErrors.length} task(s) with a role outside \`roles:\` — fix \`role:\` in the ` +
      `frontmatter, or declare the role in config.yaml. Which side is the truth is a ` +
      `decision about this project, so the build does not pick one.`,
  );
}
if (collisions > 0 || boardErrors.length > 0 || roleErrors.length > 0) process.exit(1);
