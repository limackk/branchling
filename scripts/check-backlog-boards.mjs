#!/usr/bin/env node
/**
 * check-backlog-boards.mjs — read-only guard on the board partition.
 *
 * INVARIANT: every task carries a `board:` whose slug exists in `boards.yaml`,
 * and the registry itself is well-formed (unique slugs, `default` pointing at a
 * real board).
 *
 * WHY A GUARD AND NOT JUST THE GENERATOR. `build-backlog.mjs` already exits 1 on
 * an unknown slug — but only when somebody runs it. A commit can introduce a
 * typo'd or missing `board:` without the generator being invoked once, and the
 * breakage then lands on whoever runs it next. Same class the id-collision guard
 * closed: a detector nothing can fail is a warning, not a protection.
 *
 * WHY THE SCOPE DIFFERS FROM THE ID GUARD. An id collision is a property of the
 * SET — it cannot be judged from one file, so that guard reads the whole tree. A
 * board is a property of ONE file. Reading the whole tree here would mean a
 * parallel session's uncommitted task fails MY commit, which is how people learn
 * `--no-verify`. So the hook passes its staged files and the guard judges those.
 *
 * ONE EXCEPTION, AND IT MATTERS: when `boards.yaml` itself is part of the change,
 * the whole tree is checked (`--all`). Deleting or renaming a board orphans every
 * task pointing at it, and none of those tasks is in the commit — a staged-only
 * check would wave through the one change that breaks the most files.
 *
 * Usage:
 *   node scripts/check-backlog-boards.mjs <file.md...>     # staged files
 *   node scripts/check-backlog-boards.mjs --all [tasksDir] # whole tree
 *   ... [--registry <boards.yaml>]
 *
 * Exit 0 = invariant holds. Exit 1 = violations, listed on stderr.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

import { backlogForTaskPath, backlogPaths, resolveBacklogDir } from "./paths.mjs";
import { loadConfigOrExit } from "./config.mjs";
import { inferPrefix, taskIdPatterns } from "./task-id.mjs";
import { MARK, color, errColor } from "./ui.mjs";
import { stripComment, unquote } from "./task-fields.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";


const OKM = color.ok(MARK.ok);
const ERRM = errColor.err(MARK.err);
const __dirname = dirname(fileURLToPath(import.meta.url));

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : null;
}

// The data directory is resolved as in the rest of the scripts (BL-1399). The
// --registry flag stays, because the guard sometimes reads the registry FROM
// SOMEWHERE ELSE.
const positional = process.argv.slice(2).filter((a, i, all) => {
  if (a.startsWith("--")) return false;
  const prev = all[i - 1];
  return prev !== "--registry" && prev !== "--dir"; // a flag's value, not a path
});
const wantAll = process.argv.includes("--all");

// WHICH backlog we are judging (TL-44). Until now it was always cwd — and the
// guard is handed a directory or files POSITIONALLY, so another tree was judged
// by this repository's vocabulary: zero files matched and a green "0 tasks
// checked". The order: an explicit --dir, then the directory/file we were given,
// and cwd last.
const scanDir = wantAll ? positional[0] || null : null;
const fromScan = scanDir ? (basename(scanDir) === "tasks" ? dirname(scanDir) : scanDir) : null;
const fromFile = positional.map(backlogForTaskPath).find(Boolean);
const BACKLOG_DIR =
  argValue("--dir") || fromScan || (fromFile && fromFile.root) ||
  resolveBacklogDir({ moduleDir: __dirname }).root;
const registryPath = argValue("--registry") || backlogPaths(BACKLOG_DIR).boardsPath;

// The same filename shape as in the generator — `_template.md`, the README and
// the views are not tasks and have no business failing the guard. The prefix
// comes from the configuration of the backlog BEING JUDGED, and when there is
// none — from the names of the files we are actually looking at.
// STRICT (TL-60): this is a guard whose job is to fail when something is
// wrong. Judging boards under a configuration that could not be read produces a
// result about something other than the question.
const CFG = loadConfigOrExit(BACKLOG_DIR);
const scanNames = (() => {
  if (CFG.taskIdPrefixExplicit) return [];
  try {
    return readdirSync(scanDir || backlogPaths(BACKLOG_DIR).tasksDir);
  } catch {
    return positional.map((x) => basename(x));
  }
})();
const TASK_FILE = taskIdPatterns(inferPrefix(scanNames) || CFG.taskIdPrefix).file;


// ── The registry ──────────────────────────────────────────────────────────
// The same narrow parser as in build-backlog.mjs and suggest-board.mjs: exactly
// the shape of boards.yaml. A third parser of the same structure is the price of
// having no dependencies in the module; a difference between them would show
// immediately, because all three read THE SAME file and the same test walks a
// real tree.
let raw;
try {
  raw = readFileSync(registryPath, "utf8");
} catch {
  console.error(`${ERRM} backlog: no board registry (${registryPath})`);
  console.error("  Without it `board:` has no vocabulary and every value is \"correct\".");
  console.error(`  \`${N} init\` writes one; see README.md, section "The task file".`);
  process.exit(1);
}

const registryProblems = [];
const slugs = [...raw.matchAll(/^\s*-\s*slug:\s*(\S+)\s*$/gm)].map((m) => m[1]);
const seen = new Set();
for (const slug of slugs) {
  if (seen.has(slug)) {
    registryProblems.push(
      `duplicate slug \`${slug}\` in boards.yaml — two blocks describe one board, ` +
        `and the views will generate it twice`,
    );
  }
  seen.add(slug);
}
if (!slugs.length) {
  registryProblems.push("boards.yaml declares not a single `- slug:`");
}
const def = (raw.match(/^default:\s*(\S+)\s*$/m) || [])[1] || "";
if (!def) {
  registryProblems.push("boards.yaml has no `default:` field — a task with no `board:` would have nowhere to land");
} else if (!seen.has(def)) {
  registryProblems.push(
    `\`default: ${def}\` points at no board in the list (${[...seen].join(", ") || "none"})`,
  );
}

if (registryProblems.length) {
  console.error(ERRM + " backlog: the board registry is inconsistent\n");
  for (const p of registryProblems) console.error(`  - ${p}`);
  console.error("\n  File: " + registryPath);
  process.exit(1);
}

// ── Which files we check ──────────────────────────────────────────────────
let files; // [{ path, name }]
if (wantAll) {
  const dir = positional[0] || join(BACKLOG_DIR, "tasks");
  files = readdirSync(dir)
    .filter((f) => TASK_FILE.test(f))
    .sort()
    .map((f) => ({ path: join(dir, f), name: f }));
} else {
  files = positional
    .filter((p) => TASK_FILE.test(basename(p)))
    .map((p) => ({ path: p, name: basename(p) }));
}

/** `board` from the leading `---` block — a "board:" in prose is not frontmatter. */
function frontmatterBoard(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return { hasFrontmatter: false, board: null };
  const b = m[1].match(/^board:\s*(.+?)\s*$/m);
  return { hasFrontmatter: true, board: b ? unquote(stripComment(b[1])) : null };
}

const problems = [];
for (const f of files) {
  let text;
  try {
    text = readFileSync(f.path, "utf8");
  } catch {
    // The file disappeared between `git diff --cached` and this read (a rebase,
    // somebody else's checkout). Not our business, and not a reason to fail the
    // commit.
    continue;
  }
  const { hasFrontmatter, board } = frontmatterBoard(text);
  if (!hasFrontmatter) {
    problems.push(`${f.name}: no frontmatter (is there a \`---\` at the top of the file?)`);
    continue;
  }
  if (!board) {
    problems.push(
      `${f.name}: no \`board:\` field — the task will drop out of the per-board views, ` +
        `and the generator will assign it to \`${def}\` without your decision`,
    );
    continue;
  }
  if (!seen.has(board)) {
    problems.push(
      `${f.name}: \`board: ${board}\` is not in the registry — allowed: ${[...seen].join(", ")}`,
    );
  }
}

if (problems.length) {
  console.error(ERRM + " backlog: the board partition is violated\n");
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    `\n  The board is chosen by the tool, not from memory: \`${N} board <file>\``,
  );
  console.error("  The vocabulary lives in boards.yaml.");
  process.exit(1);
}

console.log(
  `${OKM} backlog: ${files.length} task(s) checked, each with a board from the registry ` +
    `(${[...seen].join(", ")})`,
);
