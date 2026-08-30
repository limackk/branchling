#!/usr/bin/env node
/**
 * check-backlog-id-collisions.mjs — read-only guard on backlog identity.
 *
 * INVARIANT: a BL number identifies exactly ONE task file, and a task's
 * frontmatter `id` agrees with the number in its filename.
 *
 * WHY A GUARD AND NOT A WARNING. `build-backlog.mjs` has detected collisions
 * since 2026-08-07, but it printed `⚠` and exited 0 — so nothing ever failed on
 * one. Four collisions (BL-262, BL-607, BL-860, BL-703) lived in the tree for
 * months, and every reference to those numbers in commits, docs and code was
 * ambiguous. A detector nobody can fail is a warning, not a guard.
 *
 * HOW THEY ARE PRODUCED. Parallel sessions/worktrees each pick "highest number
 * + 1" from their OWN view of `tasks/`, so two branches hand the same number to
 * different work. The collision only becomes visible when the branches meet —
 * which is why this runs on merge commits too, not just ordinary ones
 * (`pre-merge-commit`; a clean merge never invokes `pre-commit` — measured
 * 2026-08-09, not assumed).
 *
 * SECOND HALF OF THE INVARIANT. Renumbering means changing the filename AND the
 * frontmatter. Doing one without the other leaves a tree that reads as clean
 * while cross-references resolve to the wrong task, so a mismatch fails here
 * exactly like a duplicate.
 *
 * Usage: node backlog/scripts/check-backlog-id-collisions.mjs [tasksDir]
 * Exit 0 = invariant holds. Exit 1 = violations, listed on stderr.
 */

import { readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { backlogPaths, resolveBacklogDir } from "./paths.mjs";
import { loadConfigOrExit } from "./config.mjs";
import { inferPrefix, taskIdPatterns } from "./task-id.mjs";
import { MARK, color, errColor } from "./ui.mjs";
import { stripComment, unquote } from "./task-fields.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";


const OKM = color.ok(MARK.ok);
const ERRM = errColor.err(MARK.err);
const __dirname = dirname(fileURLToPath(import.meta.url));
// The tasks directory is sometimes given positionally (that is how the hook
// calls it). The prefix lives in the configuration — and it has to be the
// configuration of THAT directory (TL-44). Previously the root came from cwd,
// so the named directory was judged by another backlog's vocabulary: zero files
// matched and "✓ 0 tasks, each id used once" came out. Green with zero
// evidential force is worse than red.
const ARG_DIR = process.argv[2] || null;
const BACKLOG_ROOT = ARG_DIR
  ? (basename(ARG_DIR) === "tasks" ? dirname(ARG_DIR) : ARG_DIR)
  : resolveBacklogDir({ moduleDir: __dirname }).root;
const TASKS_DIR = ARG_DIR || backlogPaths(BACKLOG_ROOT).tasksDir;

// Same filename shape the generator accepts, so the two cannot disagree about
// what counts as a task (`_template.md`, README and friends are not tasks).
// The prefix: the configuration of the SCANNED backlog, and when there is none —
// the tree itself (TL-44). The default value applied to somebody else's
// directory matches nothing and prints "✓ 0 tasks", so we ask the files before
// concluding there are none. STRICT (TL-60): including for ANOTHER directory
// named by `--dir`. "I cannot read this configuration" is a more honest answer
// than "✓ 0 tasks".
const SCAN_CFG = loadConfigOrExit(BACKLOG_ROOT);
const SCAN_PREFIX =
  (!SCAN_CFG.taskIdPrefixExplicit && inferPrefix(readdirSync(TASKS_DIR))) || SCAN_CFG.taskIdPrefix;
const PAT = taskIdPatterns(SCAN_PREFIX);
const TASK_FILE = PAT.file;

/** `id` out of the leading `---` block only — a later "id:" in prose is not frontmatter. */
function frontmatterId(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const id = m[1].match(/^id:\s*(.+?)\s*$/m);
  return id ? unquote(stripComment(id[1])) : null;
}

const files = readdirSync(TASKS_DIR).filter((f) => TASK_FILE.test(f)).sort();

const problems = [];
const byId = new Map();

for (const file of files) {
  const declared = frontmatterId(readFileSync(join(TASKS_DIR, file), "utf8"));
  const fromName = file.match(PAT.fileId)[1];

  if (!declared) {
    problems.push(
      `${file}: no \`id\` field in the frontmatter — a task with no id has no ` +
        `identity, and the views will derive one from the filename, at which point ` +
        `the mismatch stops being visible`,
    );
    continue;
  }
  if (declared !== fromName) {
    problems.push(
      `${file}: the frontmatter says \`id: ${declared}\`, the filename says ` +
        `\`${fromName}\` — an unfinished renumbering; references will drift apart silently`,
    );
  }

  if (!byId.has(declared)) byId.set(declared, []);
  byId.get(declared).push(file);
}

for (const [id, whichFiles] of [...byId].sort()) {
  if (whichFiles.length > 1) {
    problems.push(
      `ID COLLISION ${id}: ${whichFiles.join(" + ")} — renumber the one with FEWER ` +
        `references (grep the workspace AND any sub-repositories) and repoint them in the same commit`,
    );
  }
}

if (problems.length) {
  console.error(ERRM + " backlog: task identity is violated\n");
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    `\n  One ${PAT.prefix}-NNN, one task. A free number: ${PAT.prefix}-${
      Math.max(0, ...files.map((f) => Number(f.match(PAT.fileNumber)[1]))) + 1
    }.`,
  );
  console.error(`  Take the number from \`${N} next-id\`, which counts across every branch.`);
  process.exit(1);
}

console.log(`${OKM} backlog: ${files.length} tasks, each ${PAT.prefix}-NNN used once`);
