#!/usr/bin/env node
/**
 * Guard: the product name is spelled out in ONE file (TL-117).
 *
 * WHAT IT ENFORCES. `product.mjs` reads the name from `package.json` and exports
 * it; every other file under `scripts/` and `bin/` must take it from there
 * rather than write it out. Then renaming the product is an edit to
 * `package.json` — which is what `product.mjs` has claimed since BL-1439.
 *
 * WHY A GUARD AND NOT A ONE-OFF SWEEP. The claim was already written down, in
 * CLAUDE.md and in `product.mjs` itself, and it was false: the rename carried
 * out on 2026-09-01 touched 158 files, 26 of them under `scripts/`.
 * A rule that only lives in prose is obeyed until the first hurried message. The
 * sweep is worth doing only together with something that fails when it comes
 * back.
 *
 * WHY COMMENTS COUNT TOO. A comment quoting the name in front of a command goes
 * stale at a rename exactly like a help string does, and it is read by the next person
 * working here. It is also cheap to write without the name at all: the commands
 * are `build`, `check`, `done` — the binary's name adds nothing inside a file
 * that IS the binary.
 *
 * WHY IT CHECKS THE FROZEN MARKER TOO. `BLOCK_MARKER_NAME` is a second spelling
 * of the same word, deliberately kept apart from `PRODUCT_NAME` (see the comment
 * at its definition). Both are literals somebody could retype, so the guard
 * looks for both.
 *
 * WHY THERE IS AN ALLOW LIST. Some occurrences are not the product name at all
 * but part of a path that exists on disk — a document under `docs/`, a skill
 * directory under `.claude/skills/`. Renaming those is a different decision
 * from renaming the product, so they are marked in the source with
 * `product-name: allow` and the exception is written down instead of the pattern
 * having a hole.
 *
 * Usage:
 *   node scripts/check-product-name.mjs
 *
 * Exit 0 = no literal outside `product.mjs` (and it says how many lines it read
 * — a ✓ over zero lines would mean it walked the wrong tree).
 * Exit 1 = at least one file spells the name out.
 *
 * Tests: `node --test scripts/tests/product-name.test.mjs`
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { MARK, color, errColor } from "./ui.mjs";
import { PRODUCT_NAME, BLOCK_MARKER_NAME } from "./product.mjs";

const OKM = color.ok(MARK.ok);
const ERRM = errColor.err(MARK.err);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

/** The marker that turns one line into a deliberate exception. */
export const ALLOW_MARKER = "product-name: allow";

/** The code that is allowed to spell the name: the one place it comes from. */
export const SOURCE_FILE = "scripts/product.mjs";

/** Where the name must not appear. Only executable source — `README.md` and
 *  `_template.md` are prose for a human and name the tool on purpose. */
export const CHECKED_PATHS = ["scripts", "bin"];

/**
 * `tests` is skipped ON PURPOSE, and this is the one judgement call in the guard.
 *
 * A test that takes the expected name from the same constant as the code proves
 * nothing about the name: it asserts `N === N` and stays green through a broken
 * rename. Some assertions here SHOULD hold the current spelling, because that is
 * where the positive control lives. The price is honest and bounded: a rename
 * still touches the test files (85 occurrences across 24 of them, measured
 * 2026-09-01), most of it temporary-directory prefixes.
 */
const SKIP_DIRS = new Set(["node_modules", ".git", "tests"]);

/** Every spelling of the name that a file could hold. Both come from
 *  `product.mjs`, so this guard carries no literal of its own. */
export function names() {
  return [...new Set([PRODUCT_NAME, BLOCK_MARKER_NAME].filter(Boolean))];
}

function walk(abs, out) {
  if (statSync(abs).isDirectory()) {
    for (const name of readdirSync(abs).sort()) {
      if (SKIP_DIRS.has(name)) continue;
      walk(join(abs, name), out);
    }
    return out;
  }
  if (/\.(mjs|js)$/.test(abs)) out.push(abs);
  return out;
}

/**
 * PURE — audits already-read text, so a test can exercise it without a tree.
 *
 * @param {string} text
 * @param {string[]} words the spellings to look for
 * @returns {Array<{line: number, text: string, name: string}>}
 */
export function auditText(text, words = names()) {
  const lines = String(text || "").split(/\r?\n/);
  const problems = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // The exception is declared on the line itself. A hit is a single word
    // inside an ordinary line, and a marker floating above would silence more
    // than the reader intends.
    if (line.includes(ALLOW_MARKER)) continue;
    for (const w of words) {
      if (line.toLowerCase().includes(w.toLowerCase())) {
        problems.push({ line: i + 1, text: line.trim(), name: w });
        break;
      }
    }
  }
  return problems;
}

export function auditTree(root = ROOT, words = names()) {
  const files = [];
  for (const entry of CHECKED_PATHS) {
    try {
      walk(join(root, entry), files);
    } catch {
      // A path that is not there is not a violation: the same guard runs against
      // fixtures that carry only some of these directories.
    }
  }
  const findings = [];
  let linesChecked = 0;
  for (const file of files) {
    const rel = relative(root, file).split("\\").join("/");
    if (rel === SOURCE_FILE) continue;
    const text = readFileSync(file, "utf8");
    linesChecked += text.split(/\r?\n/).length;
    for (const p of auditText(text, words)) findings.push({ file: rel, ...p });
  }
  return { findings, filesChecked: files.length, linesChecked };
}

function main() {
  const { findings, filesChecked, linesChecked } = auditTree();

  if (!findings.length) {
    // The counts are the positive control: a ✓ over zero files would mean the
    // walk read the wrong tree, not that the name has one home.
    console.log(
      `${OKM} product name: ${linesChecked} lines across ${filesChecked} source files, ` +
        `no name literal outside ${SOURCE_FILE}`
    );
    return 0;
  }

  console.error(ERRM + " product name: the name is written out instead of imported\n");
  for (const f of findings.slice(0, 20)) {
    console.error(`  - ${f.file}:${f.line}: ${f.text.slice(0, 100)}`);
  }
  if (findings.length > 20) console.error(`  … and ${findings.length - 20} more`);
  console.error("");
  console.error(`  The name has ONE home: ${SOURCE_FILE}, which reads it from package.json.`);
  console.error("  In code: `import { PRODUCT_NAME as N } from \"./product.mjs\"` and a template");
  console.error("  string. In a comment: name the COMMAND (`build`, `check`), not the binary.");
  console.error(`  A deliberate exception — a real path, say — takes \`${ALLOW_MARKER}\` on the line.`);
  return 1;
}

if (process.argv[1] && process.argv[1].endsWith("check-product-name.mjs")) {
  process.exit(main());
}
