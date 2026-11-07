#!/usr/bin/env node
/**
 * `template refresh` — add to a backlog's `_template.md` the frontmatter fields
 * this release ships and the file lacks (TL-595).
 *
 * WHY IT EXISTS. `init` copies `_template.md` once and never again, so a
 * backlog started on an earlier release keeps that release's field list.
 * `doctor` has named the missing fields since TL-588, but its repair was a
 * sentence — "copy the lines for <keys> from <shipped> into <own>" — and a
 * repair that is a sentence is a repair that waits for somebody with the time
 * to do it by hand. The other copied files already had a command: the agent
 * pointer `instructions --update-nudge`, the skill `skills install --refresh`,
 * the git gates `hooks install`.
 *
 * WHY IT INSERTS AND NEVER REPLACES. The template is unlike those three: they
 * are fenced blocks or files the package owns, and this is the PROJECT's file.
 * It may carry fields of its own, defaults and comments it changed, a field it
 * removed on purpose. So the refresh adds the line of each missing shipped key
 * — with its comment, which is the only explanation of the field a person
 * editing a task by hand ever sees — and leaves every existing line byte for
 * byte. A shipped key that the project removed deliberately comes back; that
 * is the one judgement the command cannot make, and why it prints what it
 * added and why `--dry-run` exists.
 *
 * WHERE A LINE GOES. After the nearest preceding shipped key the template still
 * has — after that key's whole value, nested lines included — so a refreshed
 * template reads in shipped order. A key with no such neighbour (it leads the
 * shipped list) goes at the end of the frontmatter, never above the project's
 * own header. A missing key with a nested value (`verification:`) is copied
 * with its nested lines; the key line alone would be a different value.
 *
 * THE COMMAND SURFACE, AND WHAT WAS REJECTED.
 *   - `template refresh` (CHOSEN): a noun for the file and a verb for the act,
 *     the shape `skills install` and `hooks install` already have, and room for
 *     a second act on the same file without a second command.
 *   - `init --refresh-template`: `init` is about an empty directory and refuses
 *     an existing backlog; a flag that inverts the command's premise is a
 *     second command hiding behind the first one's name.
 *   - `doctor --fix`: `doctor` fixes nothing, and its header says why — a
 *     diagnosis that writes "while it is here" is a change nobody decided on.
 *   - `skills install --refresh`-style flag on `new`: `new` writes a task, and
 *     rewriting the template as a side effect of creating a task is exactly the
 *     unasked write the other refreshes were built to avoid.
 *
 * ONE PLANNER, TWO READERS. `doctor` asks `planRefresh` which fields are
 * missing, so the row and the command cannot disagree about what the command
 * would do — the same reason `doctor` calls the checks rather than rewriting
 * them.
 *
 * Exit: 0 refreshed or nothing to do · 1 there is no template to refresh, no
 * packaged one to refresh it from, or a template without a closed frontmatter
 * · 2 a usage error.
 *
 * Tests: `node --test scripts/tests/template-refresh.test.mjs scripts/tests/doctor.test.mjs`
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { printJson } from "./json-envelope.mjs";
import { answerBacklogDirRefusal, backlogPaths, isBacklogDirRefusal, resolveBacklogDir, takeDirFlag, TEMPLATE_FILENAME } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { MARK, color, failure, plural, refusal } from "./ui.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The template this release would write into a new backlog. */
export const SHIPPED_TEMPLATE = join(HERE, "..", TEMPLATE_FILENAME);

/** The JSON kind `template refresh --json` answers in. */
export const JSON_KIND = "template-refresh";

// A quoted value is skipped whole, so a `#` inside it is not a comment.
const KEY_LINE = /^([A-Za-z_][\w-]*):\s*(?:"(?:[^"\\]|\\.)*"|'(?:[^']|'')*')?(.*)$/;

/** A line that continues the value of the key above it: indented, or a block
 *  sequence item written at column 0, which YAML allows under a key. */
function continues(line) {
  return (/^[ \t]/.test(line) && line.trim() !== "") || /^-(\s|$)/.test(line);
}

/** Neither a key nor a value: may sit inside a nested value or between keys. */
function neutral(line) {
  return line.trim() === "" || /^#/.test(line);
}

function isMarker(line) {
  return line.trim() === "---";
}

/**
 * The frontmatter of a template, read by line: each top-level key with its
 * one-line comment and the half-open line range its value occupies. `close` is
 * the index of the closing marker, or -1 when the frontmatter never closes;
 * with no opening marker there is no frontmatter and no field. Read by line,
 * not by a YAML parser, because the comment IS the payload — a parser discards
 * it — and because an insertion has to know where a value ends. PURE.
 */
export function frontmatterFields(lines) {
  if (!lines.length || !isMarker(lines[0])) return { close: -1, fields: [], framed: false };
  const fields = [];
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (isMarker(lines[i])) { close = i; break; }
    const m = KEY_LINE.exec(lines[i]);
    if (!m) continue;
    const comment = /(?:^|\s)#\s*(.*)$/.exec(m[2]);
    // A blank line or a column-0 comment ends the value only when no further
    // continuation follows it; otherwise an insertion would split the value.
    let end = i + 1;
    for (let j = i + 1; j < lines.length && !isMarker(lines[j]); j++) {
      if (continues(lines[j])) end = j + 1;
      else if (!neutral(lines[j])) break;
    }
    fields.push({ key: m[1], comment: comment ? comment[1].trim() : "", start: i, end });
  }
  return { close, fields, framed: true };
}

/** Lines without the carriage return a CRLF file leaves on each. */
function splitLines(text) {
  return String(text).split("\n").map((l) => l.replace(/\r$/, ""));
}

/**
 * The top-level frontmatter keys of a template, each with its one-line comment.
 * Indented lines belong to a nested value. PURE.
 */
export function templateFields(text) {
  return frontmatterFields(splitLines(text)).fields.map(({ key, comment }) => ({ key, comment }));
}

/**
 * What a refresh would add to `own` from `shipped`, and the text it would leave.
 *
 * Every line of `own` survives unchanged and in order — the new text is the old
 * one with lines inserted, nothing else — and the inserted lines take the
 * file's own line ending. PURE.
 *
 * @returns {{ok: true, added: {key: string, comment: string, after: string|null, lines: string[]}[], text: string}
 *          | {ok: false, kind: string, message: string}}
 */
export function planRefresh(own, shipped) {
  const ownText = String(own);
  const raw = ownText.split("\n");
  const mine = frontmatterFields(splitLines(ownText));
  if (!mine.framed) {
    return { ok: false, kind: "no-frontmatter", message: "the template has no frontmatter: its first line is not `---`" };
  }
  if (mine.close === -1) {
    return { ok: false, kind: "no-frontmatter", message: "the template's frontmatter never closes: no second `---` line" };
  }
  const shippedLines = splitLines(shipped);
  const theirs = frontmatterFields(shippedLines);
  const present = new Map();
  for (const f of mine.fields) if (!present.has(f.key)) present.set(f.key, f);

  // Each missing key follows the value of its nearest preceding shipped key,
  // so consecutive missing keys share one anchor and keep their shipped order.
  // A leading key has no such neighbour: it goes last, never above the
  // project's own header.
  const at = new Map();
  const tail = [];
  const added = [];
  let anchor = null;
  let previous = null;
  for (const f of theirs.fields) {
    const own = present.get(f.key);
    if (own) { anchor = own.end; previous = f.key; continue; }
    if (added.some((a) => a.key === f.key)) continue;
    const lines = shippedLines.slice(f.start, f.end);
    if (anchor === null) tail.push(...lines);
    else {
      if (!at.has(anchor)) at.set(anchor, []);
      at.get(anchor).push(...lines);
    }
    added.push({ key: f.key, comment: f.comment, after: previous, lines });
    previous = f.key;
  }
  if (!added.length) return { ok: true, added, text: ownText };

  const eol = raw[0].endsWith("\r") ? "\r" : "";
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const before = (at.get(i) || []).concat(i === mine.close ? tail : []);
    for (const line of before) out.push(line + eol);
    out.push(raw[i]);
  }
  return { ok: true, added, text: out.join("\n") };
}

/**
 * Refresh the template of the backlog at `root`.
 *
 * @param {string} root  the backlog directory
 * @param {{shipped?: string, dryRun?: boolean}} opts  `shipped` is for the tests
 */
export function refreshTemplate(root, opts = {}) {
  const shipped = opts.shipped || SHIPPED_TEMPLATE;
  const path = backlogPaths(root).templatePath;
  const base = { path, shipped, dryRun: Boolean(opts.dryRun) };
  if (!existsSync(path)) {
    return {
      ...base, ok: false, kind: "no-template",
      message: "this backlog has no " + TEMPLATE_FILENAME + ": " + path,
      details: ["There is nothing to refresh. To start one from this release's, copy " + shipped + " there."],
    };
  }
  if (!existsSync(shipped)) {
    return {
      ...base, ok: false, kind: "no-shipped-template",
      message: "the packaged template is missing: " + shipped,
      details: ["A tarball built without `" + TEMPLATE_FILENAME + "` in `files` produces exactly this."],
    };
  }
  const before = readFileSync(path, "utf8");
  const plan = planRefresh(before, readFileSync(shipped, "utf8"));
  if (!plan.ok) {
    return { ...base, ok: false, kind: plan.kind, message: plan.message + " — " + path, details: ["Nothing was written."] };
  }
  const changed = plan.text !== before;
  if (changed && !opts.dryRun) writeFileSync(path, plan.text, "utf8");
  return { ...base, ok: true, changed, added: plan.added.map(({ key, comment, after, lines }) => ({ key, comment, after, lines })) };
}

/** The human answer. */
export function renderRefresh(result, opts = {}) {
  const paint = opts.color || color;
  if (!result.added.length) {
    return paint.dim(MARK.bullet + " template: every field this release ships is already in " + result.path + " — nothing changed");
  }
  const verb = result.dryRun ? "would add" : "added";
  const out = [paint.ok(MARK.ok) + " template: " + verb + " " + result.added.length + " " + plural(result.added.length, "field", "fields") + " → " + result.path];
  const width = Math.max(...result.added.map((a) => a.key.length));
  for (const a of result.added) {
    out.push("    " + a.key.padEnd(width) + "  " + paint.dim(a.after ? "after `" + a.after + "`" : "at the end of the frontmatter"));
  }
  out.push("  " + paint.dim("Every line that was already there is unchanged. A field you removed on purpose is back: delete its line again."));
  return out.join("\n");
}

const KNOWN_FLAGS = ["--dry-run", "--json", "--dir"];

export function main(argv) {
  const sub = argv[0];
  if (sub !== "refresh") {
    console.error(refusal(N + " template", sub ? "unknown subcommand: " + sub : "no subcommand", "refresh"));
    return 2;
  }
  const cli = takeDirFlag(argv.slice(1));
  const unknown = cli.argv.filter((a) => !KNOWN_FLAGS.includes(a));
  if (unknown.length) {
    const problem = unknown[0].startsWith("-") ? "unknown flag: " : "unexpected argument: ";
    console.error(refusal(N + " template refresh", problem + unknown.join(" "), KNOWN_FLAGS.join(" ")));
    return 2;
  }
  const asJson = cli.argv.includes("--json");

  let root;
  try {
    root = resolveBacklogDir({ dir: cli.dir || undefined, moduleDir: HERE }).root;
  } catch (e) {
    if (!isBacklogDirRefusal(e)) throw e;
    return answerBacklogDirRefusal(e, { command: N + " template refresh", jsonKind: asJson ? JSON_KIND : null });
  }

  const result = refreshTemplate(root, { dryRun: cli.argv.includes("--dry-run") });
  if (!result.ok) {
    if (asJson) {
      printJson(JSON_KIND, {
        ok: false, path: result.path, shipped: result.shipped, dryRun: result.dryRun,
        refusalKind: result.kind, refusal: result.message, details: result.details,
      });
    } else {
      console.error(failure(N + " template refresh", result.message, result.details));
    }
    return 1;
  }
  if (asJson) {
    printJson(JSON_KIND, {
      ok: true, path: result.path, shipped: result.shipped, dryRun: result.dryRun,
      changed: result.changed, added: result.added,
    });
  } else {
    console.log(renderRefresh(result));
  }
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("template-command.mjs")) {
  process.exitCode = main(process.argv.slice(2));
}
