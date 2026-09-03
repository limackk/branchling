#!/usr/bin/env node
/**
 * The `renumber` command — close the gaps in a backlog's numbering (TL-135).
 *
 * WHY THIS IS NOT `migrate-prefix` WITH A FLAG. The two look like one feature and
 * are not. A prefix migration is a FUNCTION of the old id — `BL-7` is `TL-7`
 * under any tree, in any clone, forever — which is why its record can be a rule
 * and why references left in prose stay merely stale. A renumber has no such
 * function: `PROJ-1303` becomes `PROJ-1` only because of where it sat in one
 * ordering of one tree at one moment. That difference decides three things this
 * command does differently, and each of them is the reason it exists separately:
 *
 *   1. THE RECORD CARRIES THE WHOLE MAP, not a from/to pair. See
 *      `appendRenumberMigration()`.
 *   2. PROSE IS REWRITTEN, not counted. `migrate-prefix` deliberately leaves it
 *      alone, because a body saying `BL-1445` may mean ANOTHER repository and a
 *      blanket rewrite would repoint it. Here the argument inverts: after a
 *      renumber, `PROJ-1509` still exists and now means a DIFFERENT task, so
 *      leaving prose alone does not produce a stale reference — it produces a
 *      wrong one that reads as correct. Silence is the more dangerous option, so
 *      the default flips.
 *   3. THE ID SPACES OVERLAP. `BL-*` → `TL-*` can never collide with itself;
 *      `PROJ-1303` → `PROJ-1` can, the moment a tree already holds low numbers. So
 *      every rename goes through a temporary name — see `applyRenumber()`.
 *
 * WHAT IT REFUSES TO TOUCH, and why that is not an oversight:
 *
 *   - `history/*.jsonl` BODIES, apart from the `task` field. The log is
 *     append-only; a `reason` written by a person in the past is their sentence,
 *     not a reference the tool owns. Mentions inside it are REPORTED.
 *   - `history/.migrations.jsonl`. It is the one file that must keep speaking in
 *     old ids — rewriting it would erase the map that explains the rewrite.
 *   - ANY LINE MARKED `renumber: allow`. A known id in documentation is either a
 *     reference, which must follow its task, or an EXAMPLE of the renumbering
 *     itself, which the rewrite would turn into nonsense while every guard stays
 *     green. Nothing can tell the two apart mechanically, so the author says
 *     which it is — see `rewriteIds()`.
 *   - Anything outside the backlog unless `--also` names it. A tool that went
 *     hunting through a repository it was merely installed into would be
 *     rewriting files nobody asked it to open.
 *
 * WHAT IT CANNOT REACH AT ALL: commit messages, and any clone or branch that is
 * not this working tree. Both are stated by `--dry-run` rather than discovered
 * afterwards, because an id in a commit title does not become stale — it becomes
 * a confident pointer to the wrong task.
 *
 * Tests: `node --test scripts/tests/renumber.test.mjs`
 */

import { existsSync, lstatSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfigOrExit } from "./config.mjs";
import { ACTOR_NAMESPACES, MIGRATIONS_FILE, appendRenumberMigration, applyIdMigrations, isValidActor, loadSnapshot, saveSnapshot } from "./history.mjs";
import { backlogPaths, resolveBacklogDir, resolveBacklogDirOrExit, takeDirFlag } from "./paths.mjs";
import { taskIdPatterns, taskIdScanner } from "./task-id.mjs";
import { MARK, color, errColor } from "./ui.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";

const OKM = color.ok(MARK.ok);
const ERRM = errColor.err(MARK.err);
const WARNM = errColor.warn(MARK.warn);
const __dirname = dirname(fileURLToPath(import.meta.url));

/** Which files `--also` may rewrite. Everything else is skipped, silently. */
const TEXT_EXTENSIONS = [".md", ".mjs", ".js", ".cjs", ".json", ".yaml", ".yml", ".txt", ".html", ".css"];
/** Never descended into, whatever `--also` says. */
const SKIP_DIRS = new Set([".git", "node_modules", ".claude"]);

const USAGE = [
  `${N} renumber [--start <n>] [--also <path>] [--actor <ns:name>] [--dry-run] [--dir <path>]`,
  "",
  "  Renumbers every task to a CONTIGUOUS range, oldest id first, closing the gaps",
  "  left by tasks that were deleted or that never belonged to this repository.",
  "  The prefix does not change — for that, `migrate-prefix`.",
  "",
  "  --start <n>        first number (default 1)",
  "  --also <path>      also rewrite ids in this file or directory, outside the",
  "                     backlog: docs, source comments, a changelog. Repeatable.",
  "  --dry-run          print the plan, write nothing",
  "",
  "  Inside the backlog it always rewrites: task filenames, `id:`, `blocked_by`,",
  "  `blocks`, task BODIES, the history filenames and their `task` field, plus",
  "  plan.yaml and config.yaml. It never rewrites prose inside history records —",
  "  the log is append-only — and never `history/" + MIGRATIONS_FILE + "`.",
  "",
  "  Ids found in text that this renumber does not know are LEFT ALONE and listed.",
  "",
  "  An id that ILLUSTRATES the renumbering rather than pointing at a task is an",
  "  example, and rewriting it destroys the sentence around it. Mark that ONE line",
  "  `renumber: allow` in a comment beside it and every id on it is left alone.",
  "",
  "  exit: 0 renumbered (or nothing to do) · 1 refused · 2 usage error",
].join("\n");

// ──────────────────────────────────────────────────────────────────────────
// Planning — pure apart from reading. Nothing here touches disk.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Build the whole plan and validate it.
 *
 * WHY THE ORDER IS THE OLD NUMBER and not the `created:` field. The old number
 * IS the creation order — it was handed out by a counter — while `created:` is
 * a date that repeats many times a day and cannot break its own ties. Sorting by
 * a field with ties would make the new numbering depend on filesystem listing
 * order, so two clones renumbering the same tree could disagree.
 */
export function planRenumber(root, prefix, opts = {}) {
  const start = opts.start === undefined ? 1 : opts.start;
  const paths = backlogPaths(root);
  const pat = taskIdPatterns(prefix);
  const historyDir = join(root, "history");
  const problems = [];
  const warnings = [];

  const taskFiles = readdirSync(paths.tasksDir).filter((f) => pat.file.test(f));
  const numbered = taskFiles
    .map((file) => ({ file, id: file.match(pat.fileId)[1], num: Number(file.match(pat.fileNumber)[1]) }))
    .sort((a, b) => a.num - b.num);

  const idMap = new Map();
  const renames = [];
  numbered.forEach((t, i) => {
    const newId = prefix + "-" + (start + i);
    idMap.set(t.id, newId);
    // `replace` on the captured id and not on the whole name: the slug carries
    // the title and has no business changing because a number did.
    const newFile = t.file.replace(pat.fileId, newId);
    renames.push({ kind: "task", dir: paths.tasksDir, from: t.file, to: newFile, id: t.id, newId });
  });

  if (existsSync(historyDir)) {
    for (const file of readdirSync(historyDir).filter((f) => pat.historyFile.test(f))) {
      const id = file.match(pat.historyFile)[1];
      const newId = idMap.get(id);
      // A log whose task is gone keeps its name, and that is NOT a refusal:
      // deleting a task while its log stays is a supported state. Renaming it
      // would need a number the map cannot supply, and inventing one would
      // attach a departed task's history to a living one.
      if (!newId) {
        warnings.push(`history/${file} has no task in tasks/ — left under its old id`);
        continue;
      }
      renames.push({ kind: "history", dir: historyDir, from: file, to: newId + ".jsonl", id, newId });
    }
  }

  // Two ids landing on one name would destroy a task. It cannot happen from the
  // map alone (the counter is injective), so this catches the case where the
  // tree ALREADY holds a file the map wants to create — which is why the check
  // reads the directory rather than trusting the arithmetic.
  const claimed = new Map();
  for (const r of renames) {
    const key = r.dir + "/" + r.to;
    if (claimed.has(key)) problems.push(`collision: ${r.from} and ${claimed.get(key)} both become ${r.to}`);
    claimed.set(key, r.from);
  }

  const identity = renames.every((r) => r.from === r.to);
  return { prefix, start, idMap, renames, problems, warnings, identity, taskCount: numbered.length, pat };
}

// ──────────────────────────────────────────────────────────────────────────
// Rewriting
// ──────────────────────────────────────────────────────────────────────────

/**
 * The marker that says an id on this line is an EXAMPLE, not a reference
 * (TL-136). Same shape as the repository's other in-line guard exceptions, and
 * for the same reason: the exception stands beside the ONE line it covers, so
 * a reviewer reads it in the diff instead of having to know a convention.
 */
export const EXAMPLE_MARKER = "renumber: allow";

/**
 * Replace every id the map knows; leave every other id alone and name it.
 *
 * A LINE CARRYING `renumber: allow` IS PASSED THROUGH WHOLE. In documentation an
 * id plays two roles the scanner cannot tell apart: a REFERENCE, which must
 * follow the task, and an EXAMPLE, which illustrates the renumbering itself.
 * Rewriting the second is not a stale pointer but a sentence that destroys its
 * own meaning — `PROJ-1303 becomes PROJ-1` collapsing into `PROJ-1 becomes
 * PROJ-1` — and it does so SILENTLY: every id was real, so no guard fires and
 * the tests stay green. Measured on this repository's own renumbering run.
 *
 * The marker is the author's declaration, because nothing else can be: an id
 * next to the word "becomes" is a heuristic, and a heuristic that is wrong here
 * is wrong in the direction of not rewriting a real reference.
 *
 * @returns {{text: string, changed: number, unknown: string[], exempt: number}}
 */
export function rewriteIds(raw, idMap, prefix) {
  const unknown = new Set();
  let changed = 0;
  let exempt = 0;
  const scan = taskIdScanner(prefix);
  const text = raw
    .split("\n")
    .map((line) => {
      if (line.includes(EXAMPLE_MARKER)) {
        // Counted, not silently skipped: an exemption nobody is told about is
        // indistinguishable from the tool having missed the line.
        exempt += [...line.matchAll(scan)].filter((m) => idMap.has(m[1])).length;
        return line;
      }
      return line.replace(scan, (whole, id) => {
        const next = idMap.get(id);
        if (!next) {
          unknown.add(id);
          return whole;
        }
        changed++;
        return next;
      });
    })
    .join("\n");
  return { text, changed, unknown: [...unknown].sort(), exempt };
}

/**
 * A history log: the `task` field moves, the rest of the record does not.
 *
 * Mentions inside `reason` are counted so the caller can report them. Rewriting
 * them would edit somebody's sentence after the fact, which is the one thing an
 * append-only log promises not to do.
 */
export function rewriteHistoryFile(raw, idMap, prefix) {
  const scan = taskIdScanner(prefix);
  let prose = 0;
  const text = raw
    .split("\n")
    .map((line) => {
      if (!line.trim()) return line;
      let e;
      try {
        e = JSON.parse(line);
      } catch {
        // Somebody's data, malformed. Passing it through beats dropping it
        // during a migration, when it is least replaceable.
        return line;
      }
      if (!e || typeof e !== "object") return line;
      for (const field of ["reason", "note", "from", "to"]) {
        if (typeof e[field] === "string") prose += [...e[field].matchAll(scan)].filter((m) => idMap.has(m[1])).length;
      }
      if (typeof e.task === "string" && idMap.has(e.task)) {
        e.task = idMap.get(e.task);
        return JSON.stringify(e);
      }
      return line;
    })
    .join("\n");
  return { text, prose };
}

/** Every text file under a path `--also` named, recursively. */
export function collectTextFiles(target, out = []) {
  if (!existsSync(target)) return out;
  const stat = lstatSync(target);
  if (stat.isSymbolicLink()) return out;
  if (stat.isFile()) {
    if (TEXT_EXTENSIONS.some((e) => target.endsWith(e))) out.push(target);
    return out;
  }
  if (!stat.isDirectory()) return out;
  for (const entry of readdirSync(target).sort()) {
    if (SKIP_DIRS.has(entry)) continue;
    collectTextFiles(join(target, entry), out);
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
// Applying
// ──────────────────────────────────────────────────────────────────────────

export function applyRenumber(root, plan, opts = {}) {
  const { idMap, prefix } = plan;
  const paths = backlogPaths(root);

  // The RECORD goes first, before a single file moves — the same reasoning as
  // `migrate-prefix`: `applyIdMigrations()` moves a snapshot key only when the
  // old task is gone and the new one is present, so a record written for work
  // that never happened is a no-op, while work done without a record is one
  // tombstone per task in every other clone.
  const record = appendRenumberMigration(root, {
    prefix,
    map: Object.fromEntries(idMap),
    actor: opts.actor,
  });

  const report = { files: 0, replacements: 0, unknown: new Map(), historyProse: 0, exempt: 0, exemptFiles: new Set() };
  const noteExempt = (file, count) => {
    if (!count) return;
    report.exempt += count;
    report.exemptFiles.add(file);
  };
  const note = (file, unknown) => {
    for (const id of unknown) {
      if (!report.unknown.has(id)) report.unknown.set(id, new Set());
      report.unknown.get(id).add(file);
    }
  };

  // Content before names. A crash between the two leaves files whose body is
  // already right, which the tree can still explain; the reverse leaves renamed
  // files carrying somebody else's id, which reads as corruption.
  for (const r of plan.renames) {
    const abs = join(r.dir, r.from);
    const raw = readFileSync(abs, "utf8");
    let next;
    if (r.kind === "history") {
      const res = rewriteHistoryFile(raw, idMap, prefix);
      next = res.text;
      report.historyProse += res.prose;
    } else {
      const res = rewriteIds(raw, idMap, prefix);
      next = res.text;
      report.replacements += res.changed;
      noteExempt(relative(root, abs), res.exempt);
      note(relative(root, abs), res.unknown);
    }
    if (next !== raw) {
      writeFileSync(abs, next, "utf8");
      report.files++;
    }
  }

  // Through a temporary name, because old and new id spaces OVERLAP: renaming
  // PROJ-1303 to PROJ-1 while PROJ-1 is still a file that has not moved yet would
  // overwrite it. Two passes cost nothing and remove the ordering question.
  const staged = [];
  for (const r of plan.renames) {
    if (r.from === r.to) continue;
    const tmp = r.to + ".renumbering";
    renameSync(join(r.dir, r.from), join(r.dir, tmp));
    staged.push({ dir: r.dir, tmp, to: r.to });
  }
  for (const s of staged) renameSync(join(s.dir, s.tmp), join(s.dir, s.to));

  // Files that hold ids but are not themselves named after one.
  const extra = [paths.configPath, paths.planPath, ...(opts.also || [])];
  for (const file of extra) {
    if (!existsSync(file)) continue;
    const raw = readFileSync(file, "utf8");
    const res = rewriteIds(raw, idMap, prefix);
    noteExempt(relative(root, file), res.exempt);
    note(relative(root, file), res.unknown);
    if (res.text !== raw) {
      writeFileSync(file, res.text, "utf8");
      report.files++;
      report.replacements += res.changed;
    }
  }

  // After the renames, because the rekeying reads the TREE to decide — the same
  // function every other clone will run from the log we just wrote.
  const snapshot = loadSnapshot(root);
  if (snapshot) {
    const present = new Set(plan.renames.filter((r) => r.kind === "task").map((r) => r.newId));
    if (applyIdMigrations(snapshot, [record], present)) saveSnapshot(root, snapshot);
  }

  return report;
}

// ──────────────────────────────────────────────────────────────────────────
// Command
// ──────────────────────────────────────────────────────────────────────────

function takeRepeatable(argv, flag) {
  const values = [];
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === flag) {
      if (i + 1 >= argv.length) return { values: null, rest };
      values.push(argv[++i]);
      continue;
    }
    rest.push(argv[i]);
  }
  return { values, rest };
}

export function main(argv) {
  if (argv.some((a) => ["--help", "-h", "help"].includes(a))) {
    console.log(USAGE);
    return 0;
  }
  const { dir, argv: afterDir } = takeDirFlag(argv);
  const { values: also, rest: afterAlso } = takeRepeatable(afterDir, "--also");
  if (also === null) {
    console.error(`${ERRM} ${N} renumber: --also needs a path`);
    return 2;
  }

  let start = 1;
  let actor = "";
  const rest = [];
  for (let i = 0; i < afterAlso.length; i++) {
    const a = afterAlso[i];
    if (a === "--start") {
      start = Number(afterAlso[++i]);
      continue;
    }
    if (a === "--actor") {
      actor = afterAlso[++i] || "";
      continue;
    }
    if (a === "--dry-run") continue;
    rest.push(a);
  }
  const dryRun = afterAlso.includes("--dry-run");

  if (rest.length) {
    console.error(`${ERRM} ${N} renumber: unknown argument: ` + rest.join(" "));
    console.error("  usage: " + USAGE.split("\n")[0]);
    return 2;
  }
  if (!Number.isInteger(start) || start < 0) {
    console.error(`${ERRM} ${N} renumber: --start takes a whole number ≥ 0`);
    return 2;
  }
  if (actor && !isValidActor(actor)) {
    console.error(`${ERRM} ${N} renumber: --actor must be one of ${ACTOR_NAMESPACES.join(", ")} followed by a name`);
    return 2;
  }

  const root = resolveBacklogDirOrExit({ dir: dir || undefined, moduleDir: __dirname }, N + " renumber").root;
  const config = loadConfigOrExit(root);
  const plan = planRenumber(root, config.taskIdPrefix, { start });

  if (plan.problems.length) {
    console.error(`${ERRM} ${N} renumber: stopping BEFORE anything is written`);
    for (const p of plan.problems) console.error("  - " + p);
    console.error("");
    console.error("  A half-finished renumbering leaves a tree that neither the old nor the new");
    console.error("  numbering can read — strictly worse than not starting.");
    return 1;
  }
  for (const w of plan.warnings) console.error(`${WARNM} renumber: ${w}`);
  if (plan.identity) {
    console.log(`${OKM} ${N} renumber: already contiguous from ${plan.start} — nothing to do`);
    return 0;
  }

  const alsoFiles = (also || []).flatMap((t) => collectTextFiles(t));
  const first = plan.renames.find((r) => r.kind === "task");
  const last = [...plan.renames].reverse().find((r) => r.kind === "task");

  console.log(`${N} renumber — ${relative(process.cwd(), root) || root}`);
  console.log(`  ${plan.taskCount} task(s): ${first.id} → ${first.newId} … ${last.id} → ${last.newId}`);
  console.log(`  ${plan.renames.filter((r) => r.kind === "history").length} history log(s) follow their task`);
  console.log(`  also rewriting ids in ${alsoFiles.length} file(s) outside the backlog`);
  console.log(`  history/${MIGRATIONS_FILE}: recording the full map so other clones repoint theirs`);
  console.log("");
  console.log(`  ${WARNM} commit messages are NOT rewritten and cannot be — an id in a commit title`);
  console.log("     will keep naming the number it had when it was written.");

  if (dryRun) {
    console.log("");
    console.log(`  --dry-run: nothing written. Drop the flag to renumber.`);
    return 0;
  }

  const report = applyRenumber(root, plan, { actor, also: alsoFiles });

  console.log("");
  console.log(`${OKM} renumbered. ${report.replacements} reference(s) rewritten across ${report.files} file(s)`);
  if (report.historyProse) {
    console.log(`  ${report.historyProse} mention(s) inside history records left as written — the log is append-only`);
  }
  if (report.exempt) {
    console.log(`  ${report.exempt} id(s) across ${report.exemptFiles.size} file(s) left as EXAMPLES — the line says \`${EXAMPLE_MARKER}\``);
  }
  if (report.unknown.size) {
    console.log(`  ${report.unknown.size} id(s) left alone because this renumber does not know them:`);
    for (const [id, files] of [...report.unknown].sort()) {
      console.log(`    ${id} — ${[...files].sort().slice(0, 3).join(", ")}${files.size > 3 ? ` (+${files.size - 3} more)` : ""}`);
    }
  }
  console.log(`  next: ${N} build && ${N} check`);
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("renumber.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
