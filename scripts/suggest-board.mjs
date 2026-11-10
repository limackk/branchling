#!/usr/bin/env node
/**
 * suggest-board.mjs — which board this task belongs to.
 *
 * Why a script even when a project has only two boards: so that the "which board"
 * decision lives in ONE place (`boards.yaml`) and can be checked with a command,
 * instead of depending on what looks right to an agent. An agent handed a task
 * with no board calls this script and accepts the result; it decides for itself
 * only when the default comes back — and then it writes the reason into `## Log`.
 *
 * The routing rule is PATH-BASED, not keyword-based, and that is the whole
 * difficulty of the problem: in a real measurement, 247 tasks out of 1339
 * mentioned the word "backlog", because the agent protocol tells every task to
 * call the rebuild command. A keyword router would have assigned 18% of a product
 * backlog to the board about the tool. So the only thing that counts is which
 * FILES a task touches: `related_docs:` and the paths written in its body.
 *
 * Usage:
 *   tasklog board backlog/tasks/TASK-1380-boards.md
 *   node scripts/suggest-board.mjs --paths app/lib/x.js
 *   node scripts/suggest-board.mjs <file> --registry <boards.yaml>
 *
 * Output (stdout): the first line is the slug, the second is the reason, so the
 * slug drops straight into a shell substitution. `--json` gives the same answer
 * in the envelope every reading command shares (TL-72).
 */

import { readFileSync } from "node:fs";

import { printJson } from "./json-envelope.mjs";
import { backlogPaths, resolveBacklogDir, resolveBacklogDirOrExit } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { printLine } from "./stdout.mjs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { refusal, plural } from "./ui.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : null;
}

// An unknown flag FAILS, in EVERY position (BL-1417) — not only when it happens
// to land in the `process.argv[2]` slot. Four holes closed by the same mechanism:
// a flag AFTER the positional file, a flag mixed into the `--paths` list, a flag
// BEFORE `--paths`, a flag AFTER `--paths ... --registry`. Paths never begin with
// `--` (the existing `!a.startsWith("--")` filter would reject them anyway) — so
// every token starting with `--` is either a known flag or an error, wherever it
// stands.
const KNOWN_WITH_VALUE = ["--registry", "--dir"];
const KNOWN_BARE = ["--paths", "--json"];
function validateArgs(argv) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue; // the positional file, or an item of --paths
    if (KNOWN_WITH_VALUE.indexOf(a) !== -1) { i++; continue; }
    if (KNOWN_BARE.indexOf(a) !== -1) continue;
    console.error(refusal(N + " board", "unknown flag: " + a,
      "--paths <path...> --registry <boards.yaml> --dir <path> --json"));
    process.exit(2);
  }
}
validateArgs(process.argv.slice(2));

const registryPath = argValue("--registry") ||
  backlogPaths(resolveBacklogDirOrExit({ dir: argValue("--dir"), moduleDir: __dirname, jsonKind: process.argv.includes("--json") ? "board" : null }, N + " board").root).boardsPath;

/** The same narrow parser as in build-backlog.mjs — the shape of boards.yaml, and
 *  nothing more. */
function readBoards(file) {
  const raw = readFileSync(file, "utf8");
  const def = (raw.match(/^default:\s*(\S+)\s*$/m) || [])[1] || "";
  const blocks = raw.split(/^\s*-\s*slug:\s*/m).slice(1);
  const boards = blocks.map((b) => {
    const slug = b.match(/^(\S+)/)[1];
    const pathsBlock = b.match(/^\s+paths:\s*\n((?:\s+-\s.*\n)+)/m);
    const paths = pathsBlock
      ? [...pathsBlock[1].matchAll(/^\s+-\s*(.+?)\s*$/gm)].map((m) => m[1].replace(/^["']|["']$/g, ""))
      : [];
    return { slug, paths };
  });
  const ignoreBlock = raw.match(/^ignore_paths:\s*\n((?:\s+-\s.*\n)+)/m);
  const ignore = ignoreBlock
    ? [...ignoreBlock[1].matchAll(/^\s+-\s*(.+?)\s*$/gm)].map((m) => m[1].replace(/^["']|["']$/g, ""))
    : [];
  if (!def || !boards.some((b) => b.slug === def)) {
    console.error("✗ " + file + ": `default:` points at no board in the list");
    process.exit(2);
  }
  return { boards, ignore, default: def };
}

/** glob → regex. Supported: `**` (any depth) and `*` (within one segment). */
function globToRe(glob) {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const body = esc.replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*");
  return new RegExp("(^|[\\s\"'`(])" + body);
}

/**
 * The paths a task TOUCHES. Two sources, both explicit in the file:
 *   • `related_docs:` — the declaration made by the task's author,
 *   • the paths written out in the body (steps, verification, pre-flight reading).
 * We deliberately do NOT take the prose itself into account — see the file header.
 */
function pathsFromTask(text) {
  const out = new Set();
  const rel = text.match(/^related_docs:\s*\n((?:\s+-\s.*\n)+)/m);
  if (rel) {
    for (const m of rel[1].matchAll(/^\s+-\s*(.+?)\s*$/gm)) {
      out.add(m[1].replace(/^["']|["']$/g, ""));
    }
  }
  for (const m of text.matchAll(/[A-Za-z0-9_./-]+\.[A-Za-z0-9]{1,5}\b/g)) {
    if (m[0].includes("/")) out.add(m[0]);
  }
  return [...out];
}

const registry = readBoards(registryPath);

let paths = [];
const pathsFlag = process.argv.indexOf("--paths");
if (pathsFlag !== -1) {
  paths = process.argv.slice(pathsFlag + 1).filter((a) => !a.startsWith("--"));
} else {
  // The positional file is the first argument that is neither a flag nor the
  // VALUE of one — `board --json x.md` and `board --dir d x.md` are the same
  // question as `board x.md`, and reading argv[2] made position significant.
  const rest = process.argv.slice(2);
  const file = rest.find((a, i) => !a.startsWith("--") && !(i > 0 && KNOWN_WITH_VALUE.indexOf(rest[i - 1]) !== -1));
  if (!file) {
    console.error("usage: suggest-board.mjs <task-file.md> | --paths <path...> [--registry <boards.yaml>]");
    process.exit(2);
  }
  paths = pathsFromTask(readFileSync(resolve(file), "utf8"));
}

// The first hit wins, in registry order — and `default` has no `paths:`, so it
// never wins by accident, only through an absence of hits. Protocol paths are
// dropped BEFORE anything is matched — otherwise "the task mentions the rebuild
// command" would mean "the task rebuilds the module".
paths = paths.filter((p) => !registry.ignore.includes(p));

const asJson = process.argv.includes("--json");

/** One answer, printed in whichever of the two shapes was asked for. */
function answer({ board, rule, matched, reason }) {
  if (asJson) {
    printJson("board", { board, rule, matched, isDefault: rule === null, reason });
  } else {
    printLine(board);
    printLine(reason);
  }
  process.exit(0);
}

for (const board of registry.boards) {
  for (const glob of board.paths) {
    const re = globToRe(glob);
    const hit = paths.find((p) => re.test(" " + p));
    if (hit) {
      answer({ board: board.slug, rule: glob, matched: hit, reason: 'paths rule: "' + glob + '" \u2190 ' + hit });
    }
  }
}

answer({
  board: registry.default,
  // No rule matched, so there is nothing to name — `null` here is what tells a
  // program the slug is a fallback rather than a decision.
  rule: null,
  matched: null,
  reason:
    "the default from boards.yaml — no paths rule matched (" +
    paths.length + " " + plural(paths.length, "path", "paths") +
    " in the task). If this is the wrong board, set it yourself and say why.",
});
