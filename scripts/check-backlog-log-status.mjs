#!/usr/bin/env node
/**
 * Guard: a task whose `## Log` and whose `status:` field disagree (TL-68).
 *
 * THE CASE THAT CAUSED IT. On 2026-08-31 TL-52 carried five `done` entries in
 * its log, committed code and green tests, while its field read `status:
 * pending`. It therefore sat in `INDEX.yaml` as open and never reached the
 * archive: the VIEWS LIED about the state of the project, looked entirely
 * normal doing it, and gave nobody a reason to open the file. The mechanism is
 * trivial and repeatable — appending to the log and changing the field are two
 * edits to one file, and when the second does not happen nothing reports it.
 *
 * WHY IT ONLY READS `## Log` AND NOT THE HISTORY. Since TL-105 the tool writes
 * the "why" of a change into `history/<ID>.jsonl` and writes NO `## Log` at
 * all. So this guard is entirely about LEGACY prose — sections written by hand
 * in tasks that predate that change and, by the rule in AGENTS.md, are kept
 * rather than tidied away. That fact decides everything below.
 *
 * WHAT COUNTS AS A STATUS CLAIM. The declared shape is `YYYY-MM-DD status —
 * who — note`, but the tree shows the second word is often an EVENT rather than
 * a status: `created`, `taken`, `renumbered`, `revised`, `board`. Only a word
 * that is in this project's `statuses:` vocabulary is read as a claim about
 * status; everything else is prose in a slot, and treating it as drift would
 * make the guard wrong about 22 of this repository's 110 logged tasks on its
 * first run. The vocabulary comes from the configuration, never from a list
 * written here.
 *
 * THE TWO DIRECTIONS ARE NOT THE SAME DEFECT, and this is the decision TL-68
 * asked to be recorded:
 *
 *   LOG AHEAD OF THE FIELD — the last entry names an ARCHIVED status while the
 *     field is still open. This is TL-52 exactly: work that is finished counts
 *     as open, so the queue offers it and the index misreports the project.
 *     A person can fix it in seconds, in either direction. It FAILS.
 *   FIELD AHEAD OF THE LOG — the field is archived (or simply different) while
 *     the last entry names an earlier status. This is stale prose, and since
 *     TL-105 it is the NORMAL end state of every legacy task: `done` moves the
 *     field and nothing will ever append the closing line, because nothing
 *     writes `## Log` any more. It WARNS.
 *
 * Made an error in both directions, this guard would leave `check` permanently
 * red over 27 of this repository's own tasks with two ways out — inventing
 * entries in somebody else's append-only notes, or switching the guard off.
 * Made a warning in both directions, it would report the one defect it exists
 * for in the same voice as the noise around it. The split is the whole point.
 *
 * IT FIXES NOTHING, deliberately. Either side can be the true one — the log may
 * be ahead because work finished and the status was not flipped, or the field
 * may be ahead because the status was changed in the viewer. An automaton
 * picking one would turn a detected contradiction into a silent decision.
 *
 * Usage:
 *   node scripts/check-backlog-log-status.mjs [--dir <backlog>]
 *
 * Exit 1 when a log is AHEAD of its field; 0 otherwise; 2 on a usage error.
 *
 * Tests: `node --test scripts/tests/log-status-agreement.test.mjs`
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfigOrExit } from "./config.mjs";
import { backlogPaths, resolveBacklogDir, takeDirFlag } from "./paths.mjs";
import { extractMeta, splitFrontmatter } from "./task-fields.mjs";
import { MARK, color, errColor } from "./ui.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";

const OKM = color.ok(MARK.ok);
const WARNM = color.warn(MARK.warn);
const ERRM = errColor.err(MARK.err);
const __dirname = dirname(fileURLToPath(import.meta.url));

/** The declared entry shape. The leading `- ` is optional because both forms
 *  are in the tree, and the em dash is what separates the note from the actor. */
const ENTRY = /^-?[ \t]*(\d{4}-\d{2}-\d{2})[ \t]+([A-Za-z][A-Za-z0-9_-]*)[ \t]+—/gm;

/**
 * The LAST entry in `## Log` whose second word is a status this project uses.
 *
 * PURE — takes text, so a test needs no tree.
 *
 * @returns {{status: string, date: string}|null} `null` when there is no `##
 *   Log`, or when it holds no entry that makes a claim about status. An absence
 *   is not a violation: it is an absence of data.
 */
export function lastLoggedStatus(text, config) {
  const heading = String(text || "").search(/^## Log\b/m);
  if (heading < 0) return null;
  const section = String(text).slice(heading);
  const known = new Set(config.statuses || []);
  let found = null;
  // The regex is stateful (`g`), so it is re-armed rather than shared.
  ENTRY.lastIndex = 0;
  for (const m of section.matchAll(ENTRY)) {
    if (known.has(m[2])) found = { status: m[2], date: m[1] };
  }
  return found;
}

/**
 * PURE — audits files already read.
 *
 * @param {{file: string, text: string}[]} files
 * @returns {{ahead: object[], behind: object[], logged: number, checked: number}}
 */
export function auditLogStatus(files, config) {
  const archived = new Set(config.archivedStatuses || []);
  const ahead = [];
  const behind = [];
  let logged = 0;

  for (const { file, text } of files) {
    const last = lastLoggedStatus(text, config);
    if (!last) continue;
    logged++;
    const { frontmatter } = splitFrontmatter(text);
    const status = extractMeta(frontmatter).status;
    if (!status || status === last.status) continue;
    const row = { file, date: last.date, logged: last.status, field: status };
    if (archived.has(last.status) && !archived.has(status)) ahead.push(row);
    else behind.push(row);
  }
  return { ahead, behind, logged, checked: files.length };
}

/** The task files as text. Exported so `doctor` can ask the same question
 *  through the same code — a second reader would drift from this one, and then
 *  the two commands would disagree about one file. */
export function readTaskTexts(tasksDir) {
  return readdirSync(tasksDir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((file) => ({ file, text: readFileSync(join(tasksDir, file), "utf8") }));
}

/** The message carries the file, BOTH values and the entry's date — enough to
 *  settle it without opening the file, which is what makes it actionable. */
function describe(row) {
  return "  - " + row.file + "\n" +
    "      `## Log` " + row.date + " says `" + row.logged + "`, the field says `" + row.field + "`";
}

export function main(argv) {
  const { dir, argv: rest } = takeDirFlag(argv);
  if (rest.length) {
    console.error(`${N} check: unknown argument: ` + rest.join(" "));
    console.error("  usage: check-backlog-log-status.mjs [--dir <backlog>]");
    return 2;
  }
  const root = resolveBacklogDir({ dir: dir || undefined, moduleDir: __dirname }).root;
  const config = loadConfigOrExit(root);
  const { ahead, behind, logged, checked } = auditLogStatus(readTaskTexts(backlogPaths(root).tasksDir), config);

  if (!ahead.length && !behind.length) {
    // The two counts ARE the positive control: "no drift" over zero logged tasks
    // means the guard found nothing to read, which is a different answer.
    console.log(`${OKM} log/status: ${logged} of ${checked} task(s) carry a status-bearing \`## Log\`, each agreeing with its field`);
    return 0;
  }

  if (ahead.length) {
    console.error(`${ERRM} log/status: ${ahead.length} task(s) whose log records a CLOSED status while the field is still open`);
    for (const row of ahead) console.error(describe(row));
    console.error("  The views take the field, so these count as open work while being finished —");
    console.error("  the state the index misreports without looking wrong. Settle it by hand: either");
    console.error(`  side may be the true one, so \`${N} done <ID>\` or a new log entry, not a guess.`);
  }
  if (behind.length) {
    console.log(`${WARNM} log/status: ${behind.length} of ${logged} logged task(s) have a \`## Log\` behind their field`);
    for (const row of behind.slice(0, 10)) console.log(describe(row));
    if (behind.length > 10) console.log(`  … and ${behind.length - 10} more`);
    console.log("  This reports, it does not fail. Since TL-105 the tool writes no `## Log` at all —");
    console.log("  the reason for a change travels with the write, in history/<ID>.jsonl — so a");
    console.log("  legacy section going stale is the normal end state, not somebody's mistake.");
  }
  return ahead.length ? 1 : 0;
}

if (process.argv[1] && process.argv[1].endsWith("check-backlog-log-status.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
