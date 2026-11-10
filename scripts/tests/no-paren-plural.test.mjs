/**
 * Every count a user reads is singular or plural, never `noun(s)` (TL-637).
 *
 * "1 task(s)" is not text — it is a programmer's note seen by a user, and the
 * reason `plural()` in scripts/ui.mjs exists. TL-616 moved that helper there;
 * this guard is what keeps the parenthesised form from coming back one message
 * at a time.
 *
 * WHAT IS JUDGED. The text of every string literal — double-quoted,
 * single-quoted and the literal parts of a template — in `scripts/*.mjs` and
 * `bin/*.mjs`. Comments are not messages and are not read, and neither is code:
 * `escape(s)` and `(s) =>` are a call and a parameter, which is exactly what the
 * task's grep could not tell apart from a message. The scanner below separates
 * them by lexing, not by a list of known false matches.
 *
 * WHAT IS EXEMPT. `http(s)` names a URL scheme, not a count. A `function
 * name(s)` inside a literal is the viewer's page script, which build-viewer.mjs
 * holds as one template literal: a declaration, not a message. A deliberate
 * quotation of the old form inside a message is marked `plural: allow` on that
 * ONE line, the way `renumber: allow` marks an example id.
 *
 * `scripts/tests/` is outside the scan on purpose: an assertion MESSAGE there is
 * read by a developer whose test failed, not by a user of the tool.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { plural } from "../ui.mjs";
import { buildHtml, computeStats, readTasks } from "../build-viewer.mjs";
import { REPO_ROOT, SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

isolateHome("no-paren-plural");

const PAREN_PLURAL = /\b([A-Za-z]+)\((?:s|es|ies)\)/g;
const EXEMPT_WORDS = new Set(["http"]);
const ALLOW_MARKER = "plural: allow";

/** A `/` after one of these starts a regular expression, not a division. */
const REGEX_AFTER_CHAR = new Set([..."(,=:[!&|?{};+-*%<>~^"]);
const REGEX_AFTER_WORD = new Set([
  "return", "typeof", "case", "in", "of", "void", "delete", "throw", "new", "yield", "await", "else", "do",
]);

/**
 * The string literals of a JavaScript source, each with the line it starts on.
 * A lexer, deliberately small: it knows comments, the three quote forms with
 * `${…}` nested to any depth, and regular-expression literals by the usual
 * previous-token rule. It does not need to understand anything else, because
 * everything else is code and code is not judged.
 *
 * @returns {{ text: string, line: number }[]}
 */
export function stringLiterals(source) {
  const out = [];
  let i = 0;
  let line = 1;
  const n = source.length;
  // A stack of open template literals: each holds the brace depth of the
  // `${…}` currently being lexed as code inside it.
  const templates = [];
  let lastSignificant = "";
  let lastWord = "";

  if (source.startsWith("#!")) {
    while (i < n && source[i] !== "\n") i++;
  }

  const take = (quote) => {
    // Lexes a "…" or '…' literal starting after its opening quote.
    const start = line;
    let text = "";
    while (i < n && source[i] !== quote) {
      if (source[i] === "\\") { text += source[i] + (source[i + 1] || ""); i += 2; continue; }
      if (source[i] === "\n") line++;
      text += source[i++];
    }
    i++;
    out.push({ text, line: start });
  };

  const takeTemplatePart = () => {
    // Lexes template text until the closing backtick or the next `${`.
    const start = line;
    let text = "";
    while (i < n) {
      const c = source[i];
      if (c === "\\") { text += c + (source[i + 1] || ""); i += 2; continue; }
      if (c === "`") { i++; templates.pop(); break; }
      if (c === "$" && source[i + 1] === "{") { i += 2; templates[templates.length - 1] = 1; break; }
      if (c === "\n") line++;
      text += c;
      i++;
    }
    out.push({ text, line: start });
  };

  while (i < n) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "\n") { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === "/" && next === "/") {
      while (i < n && source[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) { if (source[i] === "\n") line++; i++; }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") { i++; take(c); lastSignificant = c; lastWord = ""; continue; }
    if (c === "`") { i++; templates.push(0); takeTemplatePart(); lastSignificant = "`"; lastWord = ""; continue; }
    if (templates.length && templates[templates.length - 1] > 0) {
      if (c === "{") templates[templates.length - 1]++;
      if (c === "}") {
        templates[templates.length - 1]--;
        if (templates[templates.length - 1] === 0) { i++; takeTemplatePart(); lastSignificant = "`"; lastWord = ""; continue; }
      }
    }
    if (c === "/") {
      const regex = lastSignificant === "" || REGEX_AFTER_CHAR.has(lastSignificant) || REGEX_AFTER_WORD.has(lastWord);
      if (regex) {
        i++;
        let inClass = false;
        while (i < n && source[i] !== "\n") {
          const r = source[i];
          if (r === "\\") { i += 2; continue; }
          if (r === "[") inClass = true;
          else if (r === "]") inClass = false;
          else if (r === "/" && !inClass) break;
          i++;
        }
        i++;
        while (i < n && /[a-z]/.test(source[i])) i++;
        lastSignificant = ")";
        lastWord = "";
        continue;
      }
    }
    if (/[A-Za-z_$0-9]/.test(c)) {
      let word = "";
      while (i < n && /[A-Za-z_$0-9]/.test(source[i])) word += source[i++];
      lastWord = word;
      lastSignificant = "a";
      continue;
    }
    lastSignificant = c;
    lastWord = "";
    i++;
  }
  return out;
}

/** The `noun(s)` forms in a source's string literals, minus the exemptions. */
export function parenPlurals(source) {
  const lines = source.split("\n");
  const found = [];
  for (const literal of stringLiterals(source)) {
    for (const m of literal.text.matchAll(PAREN_PLURAL)) {
      if (EXEMPT_WORDS.has(m[1].toLowerCase())) continue;
      // The viewer's page script is one template literal in build-viewer.mjs,
      // so its function declarations arrive here as text: code, not a message.
      if (/\bfunction\s+$/.test(literal.text.slice(0, m.index))) continue;
      const offset = literal.text.slice(0, m.index).split("\n").length - 1;
      const at = literal.line + offset;
      if ((lines[at - 1] || "").includes(ALLOW_MARKER)) continue;
      found.push({ line: at, match: m[0] });
    }
  }
  return found;
}

function sources() {
  const dirs = [SCRIPTS_DIR, join(REPO_ROOT, "bin")];
  const files = [];
  for (const dir of dirs) {
    for (const name of readdirSync(dir)) {
      if (name.endsWith(".mjs")) files.push(join(dir, name));
    }
  }
  return files;
}

test("plural(): one for exactly one, the plural for every other count", () => {
  assert.equal(plural(1, "task", "tasks"), "task");
  assert.equal(plural(0, "task", "tasks"), "tasks");
  assert.equal(plural(2, "task", "tasks"), "tasks");
});

test("the scanner finds noun(s) in every quote form and nothing in code or comments", () => {
  // POSITIVE CONTROL: a scanner that read nothing would pass the guard below.
  const source = [
    "#!/usr/bin/env node",
    "// a comment saying task(s) is not a message",
    "/* nor is a block comment with entr(ies) */",
    'const a = "1 task(s) checked";',
    "const b = 'skipped 2 file(s)';",
    "const c = `${n} entr(ies) across ${m + `${k} branch(es)`} in total`;",
    "const d = escape(s) + inline(s);",
    "const e = list.map((s) => s.id);",
    'const f = /"/.test(x) ? "an http(s) URL" : "";',
    'const g = x / 2 / y + " day(s)";',
    'const h = "quoted on purpose: 1 error(s)"; // plural: allow',
    "const page = `function escape(s) { return s; }`;",
  ].join("\n");
  const found = parenPlurals(source).map((f) => f.line + ":" + f.match);
  assert.deepEqual(found, ["4:task(s)", "5:file(s)", "6:entr(ies)", "6:branch(es)", "10:day(s)"]);
});

test("no message in scripts/ or bin/ counts with noun(s)", () => {
  const files = sources();
  let literals = 0;
  const findings = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    literals += stringLiterals(source).length;
    for (const f of parenPlurals(source)) findings.push(file.slice(REPO_ROOT.length + 1) + ":" + f.line + " " + f.match);
  }
  // The sample, stated: a guard over zero files or zero literals is green
  // with no evidentiary force.
  assert.ok(files.length > 50, "only " + files.length + " source files were scanned");
  assert.ok(literals > 5000, "only " + literals + " string literals were read — the lexer lost its way");
  assert.deepEqual(findings, [],
    "spell the count through plural() from scripts/ui.mjs:\n  " + findings.join("\n  "));
});

test("the viewer page carries plural() for the modules pasted into it", () => {
  const tasks = readTasks();
  assert.ok(tasks.length > 0, "no tasks read — the page would carry none of the pasted views");
  const html = buildHtml(tasks, computeStats(tasks));
  // The page also carries task text, which may quote the old form as data, so
  // what is asserted is the definition the pasted modules reach for.
  assert.equal(html.split("function plural(").length - 1, 1, "the page must define plural() exactly once");
});
