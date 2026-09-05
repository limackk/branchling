#!/usr/bin/env node
/**
 * Guard: the public documents carry no context from the repository this tool
 * came out of (TL-37).
 *
 * THE DECISION THIS ENFORCES. The documents were split in two: the measurements
 * and the "why WE decided this" stay in the originating workspace, and the tool
 * gets the mechanism plus the command a reader can run to measure the same thing
 * on their own tree. The reason the other variant — anonymise the numbers and
 * keep them — was rejected is worth repeating, because the question comes back
 * with every new document:
 *
 *   An unverifiable measurement is not evidence for a stranger. "78% of commits
 *   touched views" in a repository nobody can open asks the reader to trust the
 *   author. Inside that repository the number WAS evidence, because anyone could
 *   recompute it. Outside, it stops being evidence while still carrying
 *   information about the company. Zero gain, non-zero cost.
 *
 * WHAT IT LOOKS FOR, AND WHY NOT A LIST OF NAMES. The obvious implementation is
 * a list of forbidden words — the company's name, its products, the author's
 * name — and this guard deliberately does NOT ship one. A rejected-word list
 * naming the company IS the company's name, published, in the repository the
 * decision was made to keep it out of. So the CODE knows the shapes and
 * `config.yaml` knows the values (law 3), and this project leaves the values
 * empty: the one-off name grep lives in TL-37's own `verification:`, in the
 * backlog, which the decision scoped out.
 *
 * The three shapes are the leaks a name list would miss anyway:
 *
 *   1. A PERSONAL ABSOLUTE PATH — `/Users/<name>/…`, `/home/<name>/…`,
 *      `C:\Users\<name>`. It names a person and the layout of their machine,
 *      and it is useless to every reader. `/path/to/…` is the replacement.
 *   2. AN EMAIL ADDRESS.
 *   3. A QUANTITATIVE CLAIM ABOUT A CORPUS NOBODY CAN OPEN — "1362 tasks",
 *      "78% of commits". Three digits or more, because that is the scale at
 *      which a number is describing somebody else's tree rather than an example.
 *
 * `foreign-context: allow` on the line, or on the line above it, is the
 * exception — the same shape every other guard here uses, so an exception is a
 * decision written down rather than a hole in the pattern. This repository's
 * OWN dated measurements carry it: they are reproducible by anybody who clones
 * this repository, which is the whole distinction.
 *
 * WHAT IT READS. `docs/`, `README.md`, `LINEAGE.md`, `CONTRIBUTING.md` AND
 * `backlog/` — the documents a stranger opens. The backlog was outside this
 * perimeter until TL-196, on the argument that the tasks are this tool's
 * development history and hold the record of the decision, including this one.
 * That argument was backwards: LINEAGE.md says the tasks ARE the history
 * BECAUSE the git history was flattened at extraction, which makes the backlog
 * the primary document a stranger reads, not an internal appendix. A perimeter
 * that covered 12 files and skipped 197 answered the question without looking.
 *
 * Only `.md` is read, so `backlog/history/*.jsonl` stays outside — the log is
 * append-only, and a guard that demanded edits to it would be asking for the
 * one thing that file may never have.
 *
 * NOT EVERY DETECTOR APPLIES EVERYWHERE. A NAME and a PERSONAL PATH are wrong
 * in any file — they name somebody. A MEASUREMENT is different: the rule that a
 * number must be reproducible by the reader protects a document that ARGUES,
 * and a task's dated `## Log` does not argue, it records what was true on a
 * date. Applying it there produced 124 findings against this repository's own
 * history — "337 tasks", "158 files", "1375 references rewritten" — every one
 * of them the kind of entry AGENTS.md asks for. A guard that flags the practice
 * it is supposed to protect gets silenced, so the measurement rule stops at the
 * backlog's edge. What a number about ANOTHER repository leaks is caught by the
 * name and the cross-repository reference instead.
 *
 * Tests: `node --test scripts/tests/foreign-context.test.mjs`
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { loadUserConfig, USER_KEYS } from "./home.mjs";
import { MARK, color, errColor } from "./ui.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OKM = color.ok(MARK.ok);
const ERRM = errColor.err(MARK.err);

export const ALLOW_MARKER = "foreign-context: allow";

/** The documents a stranger opens — the backlog among them (TL-196). */
export const PUBLIC_DOCS = ["docs", "README.md", "LINEAGE.md", "CONTRIBUTING.md", "backlog"];

/** A home directory with somebody's name in it. `/path/to/...` and
 *  `/Users/x/...` in an obviously schematic example are NOT exempt: a reader
 *  cannot tell a real name from a short one, so neither does the guard. */
const PERSONAL_PATH = /(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\)(?!x\b)[A-Za-z0-9._-]+/;

/**
 * An address, except the domains reserved for documentation.
 *
 * `example.com`, `example.org`, `example.net` and `.invalid` exist precisely so
 * that a document can show the SHAPE of an address without naming a person
 * (RFC 2606). Exempting them by rule beats an `allow` marker on every DCO
 * snippet and sign-off example, and it keeps the marker for decisions that
 * actually need arguing.
 */
const EMAIL = /[A-Za-z0-9._%+-]+@(?!example\.(?:com|org|net)\b)(?![A-Za-z0-9.-]*\.invalid\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

/** A claim about a corpus the reader cannot open. Three digits or more: below
 *  that a number is an example ("two branches", "12 of 44"), above it the
 *  number is doing the arguing, and then it has to be reproducible. */
const BIG_COUNT = /\b\d{3,}\s+(?:tasks?|commits?|files?|branches|worktrees)\b/i;
const SHARE_OF = /\b\d{1,3}\s?%\s+of\s+(?:the\s+)?(?:commits?|tasks?|files?)\b/i;

/** A markdown link's `(...)` target, removed from the text that is SEARCHED.
 *  The line REPORTED is still the original, so a real mistake stays visible. */
export function stripLinkTargets(line) {
  return String(line).replace(/\]\([^)]*\)/g, "]()");
}

/** A line of a fenced block, and the fence itself, are not prose. A command
 *  that PRINTS a big number is the replacement this guard is asking for, so
 *  flagging it would forbid the fix. */
function fenceState(line, inside) {
  return /^\s*```/.test(line) ? !inside : inside;
}

/**
 * PURE — audits already-read text so a test can exercise it without a tree.
 *
 * @param {string} text
 * @param {string[]} words  extra forbidden words from `config.yaml`; empty here
 * @returns {Array<{line: number, text: string, reason: string}>}
 */
export function auditText(text, words = [], { measurements = true } = {}) {
  const lines = String(text || "").split(/\r?\n/);
  const forbidden = (words || []).filter(Boolean)
    .map((w) => new RegExp("\\b" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i"));
  const problems = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const wasInFence = inFence;
    inFence = fenceState(line, inFence);
    const allowed = line.includes(ALLOW_MARKER) || (i > 0 && lines[i - 1].includes(ALLOW_MARKER));
    if (allowed) continue;
    // A NAME IS SEARCHED EVERYWHERE, a measurement only in prose. A command in
    // a fenced block is the replacement this guard asks for; a company name in
    // one is still the company name.
    //
    // A MARKDOWN LINK'S TARGET IS NOT SEARCHED, for the reason TL-137 gave the
    // language guard: a filename is data, and this repository's task files carry
    // Polish words forever, one of which happens to contain a company's name as
    // a substring. A guard that flagged those would have to be silenced on every
    // cross-reference, which is worse than the gap.
    const searched = stripLinkTargets(line);
    for (let w = 0; w < forbidden.length; w++) {
      if (forbidden[w].test(searched)) {
        problems.push({ line: i + 1, text: line.trim(), reason: "word:" + words[w] });
        break;
      }
    }
    if (problems.length && problems[problems.length - 1].line === i + 1) continue;
    if (PERSONAL_PATH.test(line)) {
      problems.push({ line: i + 1, text: line.trim(), reason: "personal-path" });
      continue;
    }
    if (EMAIL.test(line)) {
      problems.push({ line: i + 1, text: line.trim(), reason: "email" });
      continue;
    }
    if (wasInFence || inFence) continue;
    if (!measurements) continue;
    if (BIG_COUNT.test(line)) {
      problems.push({ line: i + 1, text: line.trim(), reason: "measurement" });
      continue;
    }
    if (SHARE_OF.test(line)) {
      problems.push({ line: i + 1, text: line.trim(), reason: "measurement" });
    }
  }
  return problems;
}

const SKIP_DIRS = new Set([".git", "node_modules", "demo"]);

function walk(abs, out) {
  let stat;
  try { stat = statSync(abs); } catch { return out; }
  if (stat.isDirectory()) {
    for (const name of readdirSync(abs).sort()) {
      if (SKIP_DIRS.has(name)) continue;
      walk(join(abs, name), out);
    }
    return out;
  }
  if (/\.md$/.test(abs)) out.push(abs);
  return out;
}

/** Entries whose files are a dated record rather than an argument — the
 *  measurement rule does not run there. See the header. */
export const HISTORICAL_RECORD = ["backlog"];

export function auditTree(root, words = []) {
  const files = [];
  for (const entry of PUBLIC_DOCS) {
    const found = [];
    walk(join(root, entry), found);
    const measurements = HISTORICAL_RECORD.indexOf(entry) < 0;
    for (const abs of found) files.push({ abs, measurements });
  }
  const findings = [];
  let linesChecked = 0;
  for (const { abs, measurements } of files) {
    const text = readFileSync(abs, "utf8");
    linesChecked += text.split(/\r?\n/).length;
    for (const p of auditText(text, words, { measurements })) {
      findings.push({ file: relative(root, abs), ...p });
    }
  }
  return { findings, filesChecked: files.length, linesChecked };
}

function main(argv = process.argv.slice(2)) {
  const repoRoot = join(HERE, "..");
  let words = [];
  try {
    // THE LIST COMES FROM THE USER LAYER, NOT FROM THE REPOSITORY (TL-196). A
    // list of names this tree may not contain cannot be stored in this tree —
    // writing it down is the disclosure. It used to live in a task's
    // `verification:`, which is why the backlog named another project 101
    // times while the guard reported green.
    const raw = loadUserConfig(process.env, []).values.foreign_context_words;
    words = String(raw || "").split(",").map((w) => w.trim()).filter(Boolean);
  } catch {
    // No preferences file, or one that will not load: the structural checks
    // still run. This guard is about the documents, not the configuration.
  }
  // `--words a,b` ADDS to that list for one run.
  const at = argv.indexOf("--words");
  if (at >= 0) {
    const value = argv[at + 1];
    if (!value) {
      console.error(ERRM + " foreign context: `--words` with no value");
      return 2;
    }
    words = words.concat(value.split(",").map((w) => w.trim()).filter(Boolean));
  }
  for (const a of argv) {
    if (a.startsWith("--") && a !== "--words") {
      console.error(ERRM + " foreign context: unknown flag: " + a);
      return 2;
    }
  }
  const { findings, filesChecked, linesChecked } = auditTree(repoRoot, words);

  if (!findings.length) {
    // The counts are the positive control: a ✓ over zero files would mean the
    // walk read the wrong tree, not that the documents are clean.
    console.log(
      `${OKM} foreign context: ${linesChecked} lines across ${filesChecked} public document(s), ` +
        "no personal paths, addresses or unreproducible measurements" +
        (words.length ? ", and none of the " + words.length + " forbidden word(s)" : "")
    );
    return 0;
  }

  console.error(ERRM + " foreign context: a public document carries something a reader cannot check\n");
  for (const f of findings.slice(0, 20)) {
    console.error(`  - ${f.file}:${f.line} (${f.reason}): ${f.text.slice(0, 100)}`);
  }
  if (findings.length > 20) console.error(`  … and ${findings.length - 20} more`);
  console.error("");
  console.error("  An unverifiable measurement is not evidence for a stranger: a number from a");
  console.error("  repository nobody can open asks them to trust the author, while still");
  console.error("  carrying information about it. Replace it with the MECHANISM, with the");
  console.error("  COMMAND that reproduces it, or with a conditional warning — never delete it");
  console.error("  and leave the paragraph with nothing to defend.");
  console.error(`  A deliberate exception: put \`${ALLOW_MARKER}\` on the line or above it.`);
  return 1;
}

if (process.argv[1] && process.argv[1].endsWith("check-no-foreign-context.mjs")) {
  process.exit(main());
}
