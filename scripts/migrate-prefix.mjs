#!/usr/bin/env node
/**
 * The `migrate-prefix --to <NEW>` command — renumber a whole backlog (BL-1452).
 *
 * WHY THIS SHIPS IN THE SAME CHANGE AS THE SETTING. Making `task_id_prefix`
 * configurable without this command would be a trap, not a feature: editing the
 * line alone leaves a tree the tool no longer recognises. `build` would read
 * zero tasks and `next-id` would restart from 1. The mismatch guard in
 * task-id.mjs turns that into a loud failure; this command is the way out of it.
 *
 * WHAT MOVES, and why each piece has to. Four things carry the id, and leaving
 * any one behind produces a backlog that is worse than before the migration:
 *   1. the task FILENAME              — otherwise nothing is found
 *   2. the `id:` in the frontmatter   — otherwise the guard reports a mismatch
 *                                       between name and content
 *   3. `blocked_by` / `blocks`        — otherwise every dependency dangles
 *                                       (BL-1451 would then fail the tree)
 *   4. `history/<ID>.jsonl` + the `task` field inside it — otherwise the
 *      attribution log is orphaned exactly when it is most needed
 *   5. the keys of `history/.snapshot.json` — otherwise the next reconcile
 *      compares remembered `BL-*` against present `TL-*` and records the whole
 *      backlog as deleted and created again (TL-111)
 *   6. a record in `history/.migrations.jsonl` — the snapshot is gitignored, so
 *      (5) heals THIS clone only; the record is what lets every other clone
 *      reach the same conclusion instead of writing those tombstones itself
 *
 * WHY IT PLANS BEFORE IT WRITES. A half-finished renumber leaves a tree that
 * neither the old nor the new prefix can read — strictly worse than not
 * starting. So the whole plan is built and validated first (collisions,
 * unreadable files), and nothing touches disk unless every step is possible.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: rewrite ids inside prose. A task body may
 * mention `BL-1445` meaning ANOTHER repository's task (that is the documented
 * cross-repo form), and a blanket rewrite would silently repoint it. Prose is
 * reported, not edited — the count is printed so nobody assumes it was handled.
 *
 * Tests: `node --test scripts/tests/id-prefix.test.mjs`
 */

import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveActor } from "./actor.mjs";
import { loadConfigOrExit } from "./config.mjs";
import { ACTOR_NAMESPACES, MIGRATIONS_FILE, SNAPSHOT_FILE, appendMigration, applyIdMigrations, isValidActor, loadSnapshot, saveSnapshot } from "./history.mjs";
import { backlogPaths, resolveBacklogDir, takeDirFlag } from "./paths.mjs";
import { PREFIX_SHAPE, taskIdPatterns } from "./task-id.mjs";
import { MARK, color, errColor } from "./ui.mjs";
import { stripComment, unquote } from "./task-fields.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";


const OKM = color.ok(MARK.ok);
const ERRM = errColor.err(MARK.err);
const __dirname = dirname(fileURLToPath(import.meta.url));

const USAGE = [
  `${N} migrate-prefix --to <NEW> [--dir <path>] [--actor <ns:name>] [--dry-run]`,
  "",
  "  Renumbers the WHOLE backlog onto a new prefix: filenames, `id:`,",
  "  `blocked_by`/`blocks`, the history logs, the history snapshot and",
  "  `task_id_prefix` in config.yaml. The migration is recorded in",
  `  history/${MIGRATIONS_FILE}, so other clones repoint their own snapshot too.`,
  "  References in PROSE are left untouched — they may point at another repository.",
].join("\n");

/**
 * Build the whole plan. PURE apart from reading — nothing is written here, so
 * a collision can abort the migration before it has started.
 */
export function planMigration(root, from, to) {
  const paths = backlogPaths(root);
  const fromPat = taskIdPatterns(from);
  const toPat = taskIdPatterns(to);
  const tasksDir = paths.tasksDir;
  const historyDir = join(root, "history");

  const names = readdirSync(tasksDir);
  const taskFiles = names.filter((f) => fromPat.file.test(f)).sort();
  const problems = [];
  const renames = [];
  const idMap = new Map();

  for (const file of taskFiles) {
    const id = file.match(fromPat.fileId)[1];
    const newId = to + "-" + id.match(fromPat.fileNumber)[1];
    const newFile = file.replace(fromPat.fileId, newId);
    idMap.set(id, newId);
    if (existsSync(join(tasksDir, newFile)) && newFile !== file) {
      problems.push(`collision: ${newFile} already exists — not overwriting`);
    }
    renames.push({ kind: "task", from: join(tasksDir, file), to: join(tasksDir, newFile), id, newId });
  }

  const historyFiles = existsSync(historyDir)
    ? readdirSync(historyDir).filter((f) => fromPat.historyFile.test(f)).sort()
    : [];
  for (const file of historyFiles) {
    const id = file.match(fromPat.historyFile)[1];
    const newId = idMap.get(id) || to + "-" + id.match(fromPat.fileNumber)[1];
    const newFile = newId + ".jsonl";
    if (existsSync(join(historyDir, newFile)) && newFile !== file) {
      problems.push(`collision: history/${newFile} already exists — not overwriting`);
    }
    renames.push({ kind: "history", from: join(historyDir, file), to: join(historyDir, newFile), id, newId });
  }

  // Prose mentions are counted, never rewritten — see the header.
  let proseMentions = 0;
  const bareId = new RegExp(fromPat.id.source.replace(/^\^|\$$/g, ""), "g");
  for (const file of taskFiles) {
    const raw = readFileSync(join(tasksDir, file), "utf8");
    const body = raw.split(/^---$/m).slice(2).join("---");
    proseMentions += (body.match(bareId) || []).length;
  }

  // The snapshot is not renamed but REKEYED, so it is counted rather than
  // planned as a file move — and it is counted here so `--dry-run` can name it.
  // A migration that says nothing about the snapshot is the one that produced
  // the tombstones (TL-111): what is not announced is not reviewed.
  const snapshot = loadSnapshot(root);
  const snapshotKeys = snapshot
    ? Object.keys(snapshot.tasks || {}).filter((id) => fromPat.id.test(id)).length
    : 0;

  return {
    from, to, renames, idMap, problems, proseMentions,
    taskCount: taskFiles.length, snapshotKeys, hasSnapshot: Boolean(snapshot),
    fromPat, toPat,
  };
}

function rewriteTask(raw, plan) {
  const { fromPat, idMap, to } = plan;
  const parts = raw.split(/^---$/m);
  if (parts.length < 3) return raw;
  let fm = parts[1];

  // The comment beside the field is preserved, and is NOT part of the id being
  // looked up: `id: BL-100   # prefix from config.yaml` used to miss in `idMap`
  // and stay on the old prefix while its filename was renamed (TL-70).
  fm = fm.replace(/^id:[ \t]*(.+?)[ \t]*$/m, (m, rest) => {
    const value = stripComment(rest);
    const trailing = rest.slice(value.length);
    return "id: " + (idMap.get(unquote(value)) || value) + trailing;
  });
  for (const field of ["blocked_by", "blocks"]) {
    // The match ENDS at the `]` — anything after it is a comment and is left
    // alone. Anchoring at `$` instead meant a commented `blocked_by:` did not
    // match at all, so its references silently kept the old prefix (TL-70).
    fm = fm.replace(new RegExp("^(" + field + ":[ \\t]*\\[)(.*?)(\\])", "m"), (m, open, inner, close) => {
      const mapped = inner
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
        .map((ref) => idMap.get(ref) || (fromPat.id.test(ref) ? to + "-" + ref.match(fromPat.fileNumber)[1] : ref));
      return open + mapped.join(", ") + close;
    });
  }
  parts[1] = fm;
  return parts.join("---");
}

function rewriteHistory(raw, plan) {
  return raw
    .split("\n")
    .map((line) => {
      if (!line.trim()) return line;
      try {
        const e = JSON.parse(line);
        if (e && typeof e.task === "string" && plan.idMap.has(e.task)) {
          e.task = plan.idMap.get(e.task);
          return JSON.stringify(e);
        }
      } catch {
        // A malformed line is somebody's data; pass it through untouched rather
        // than dropping it during a migration.
      }
      return line;
    })
    .join("\n");
}

export function applyMigration(root, plan, opts = {}) {
  // The RECORD goes first, before a single file moves. It is the only step that
  // makes a half-finished migration recoverable: `applyIdMigrations()` moves
  // a snapshot key only when the old task is gone and the new one is present, so
  // a record written for work that never happened is a no-op, while a record
  // missing after work that did happen is 74 tombstones nobody can undo.
  const record = appendMigration(root, { from: plan.from, to: plan.to, actor: opts.actor });

  // Content first, then names: a crash between the two leaves files whose body
  // is already correct, which the mismatch guard can explain. The reverse order
  // leaves renamed files with stale ids, which looks like corruption.
  for (const r of plan.renames) {
    const raw = readFileSync(r.from, "utf8");
    const next = r.kind === "task" ? rewriteTask(raw, plan) : rewriteHistory(raw, plan);
    if (next !== raw) writeFileSync(r.from, next, "utf8");
  }
  for (const r of plan.renames) {
    if (r.from !== r.to) renameSync(r.from, r.to);
  }

  // After the renames, because the rekeying reads the TREE to decide: the same
  // function every other clone runs from the log, given the record we just
  // wrote. One implementation, so the migrating clone cannot end up somewhere
  // the others never reach.
  const snapshot = loadSnapshot(root);
  if (snapshot) {
    const present = new Set(plan.renames.filter((r) => r.kind === "task").map((r) => r.newId));
    if (applyIdMigrations(snapshot, [record], present)) saveSnapshot(root, snapshot);
  }

  const configPath = backlogPaths(root).configPath;
  if (existsSync(configPath)) {
    const raw = readFileSync(configPath, "utf8");
    const next = /^task_id_prefix:/m.test(raw)
      ? raw.replace(/^task_id_prefix:.*$/m, "task_id_prefix: " + plan.to)
      : raw.replace(/\n?$/, "\ntask_id_prefix: " + plan.to + "\n");
    writeFileSync(configPath, next, "utf8");
  }
}

export function main(argv) {
  if (argv.some((a) => ["--help", "-h", "help"].includes(a))) {
    console.log(USAGE);
    return 0;
  }
  const { dir, argv: rest } = takeDirFlag(argv);
  const dryRun = rest.includes("--dry-run");
  const toIdx = rest.indexOf("--to");
  const to = toIdx !== -1 ? rest[toIdx + 1] : null;
  const actorIdx = rest.indexOf("--actor");
  // The migration record carries an actor like every other entry in the log, and
  // it comes from the same chain as every other command's — including the user
  // layer, which is why this must not be spelled out here a second time.
  const actor = actorIdx !== -1 ? rest[actorIdx + 1] : resolveActor("");
  const VALUE_FLAGS = ["--to", "--actor"];
  const unknown = rest.filter(
    (a, i) => a.startsWith("-") && a !== "--dry-run" && VALUE_FLAGS.indexOf(a) === -1 && VALUE_FLAGS.indexOf(rest[i - 1]) === -1
  );

  if (unknown.length) {
    console.error(`${N} migrate-prefix: unknown flag: ` + unknown.join(" ") + "\n" + USAGE);
    return 2;
  }
  if (!to) {
    console.error(`${N} migrate-prefix: missing \`--to <NEW>\`\n` + USAGE);
    return 2;
  }
  if (actorIdx !== -1 && !rest[actorIdx + 1]) {
    console.error(`${N} migrate-prefix: \`--actor\` with no name\n` + USAGE);
    return 2;
  }
  if (actor && !isValidActor(actor)) {
    console.error(`${N} migrate-prefix: the actor \`${actor}\` has no valid namespace — expected ${ACTOR_NAMESPACES.map((ns) => ns + ":<name>").join(", ")}`);
    return 2;
  }
  if (!PREFIX_SHAPE.test(to)) {
    console.error(`${N} migrate-prefix: \`` + to + "` is not a prefix — expecting a letter, then letters/digits/`.`/`_`/`-`");
    return 2;
  }

  const root = resolveBacklogDir({ dir: dir || undefined, moduleDir: __dirname }).root;
  // STRICT (TL-60): this is a command that RENAMES FILES. When the typo sits in
  // `task_id_prefix` itself, the source prefix comes out of the default value and
  // the migration renumbers the tree from something other than what it thinks.
  const from = loadConfigOrExit(root).taskIdPrefix;
  if (from === to) {
    console.log(`${N} migrate-prefix: the prefix is already \`${to}\` — nothing to do`);
    return 0;
  }

  const plan = planMigration(root, from, to);
  if (plan.problems.length) {
    console.error(ERRM + ` ${N} migrate-prefix: stopping BEFORE anything is written — a half-finished renumbering`);
    console.error("  would leave a tree that neither the old nor the new prefix can see.");
    for (const p of plan.problems) console.error("  - " + p);
    return 1;
  }

  console.log(`${N} migrate-prefix: ${from} → ${to} (${plan.taskCount} tasks, ${plan.renames.length} files)`);
  for (const r of plan.renames.slice(0, 10)) {
    console.log(`  ${r.id} → ${r.newId}`);
  }
  if (plan.renames.length > 10) console.log(`  … and ${plan.renames.length - 10} more`);
  console.log(
    plan.hasSnapshot
      ? `  history/${SNAPSHOT_FILE}: ${plan.snapshotKeys} key(s) repointed to \`${to}\``
      : `  history/${SNAPSHOT_FILE}: none yet — nothing to repoint`
  );
  console.log(`  history/${MIGRATIONS_FILE}: recording ${from} → ${to} so other clones repoint theirs`);
  if (plan.proseMentions) {
    console.log(
      `  ⚠ ${plan.proseMentions} mentions of \`${from}-NNN\` in task PROSE are left untouched —\n` +
        "    they may point at another repository. Review them yourself."
    );
  }

  if (dryRun) {
    console.log("  (--dry-run: nothing was written)");
    return 0;
  }

  applyMigration(root, plan, { actor });
  console.log(`${OKM} renumbered. Now: ${N} build && ${N} check`);
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("migrate-prefix.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
