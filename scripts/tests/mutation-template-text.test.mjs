/**
 * A mutation run says which of the lines it was asked to mutate are
 * template-literal text, which Stryker cannot mutate (TL-657).
 *
 * Stryker parses a module and mutates its code; a template literal is one
 * string to it, however much JavaScript the string holds. The viewer's page
 * script — `metaRowHtml()` and most functions beside it — is such text inside
 * scripts/build-viewer.mjs. The field editors, `startEdit()` among them, left
 * it for scripts/viewer-field-editors.mjs, which the page pastes by source
 * (TL-704), and are code there. A `--files` or `--changed-lines` range there used
 * to produce no mutant and read exactly like a range whose mutants were all
 * killed. No Stryker here: this file runs in the default suite, which CI runs
 * without `npm install`, and what it proves is the classification and what
 * the run does with it before Stryker would start.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { fixtureDir } from "./_fixture-dir.mjs";
import { SCRIPTS_DIR, isolateHome, scriptSource } from "./_repo.mjs";
import { plan, templateTextLines } from "../mutation-run.mjs";

isolateHome("mutation-template-text");
const ENTRY = join(SCRIPTS_DIR, "mutation-run.mjs");

function lineSet(source) {
  return templateTextLines(source).flatMap((r) => Array.from({ length: r.end - r.start + 1 }, (_, k) => r.start + k));
}

test("only lines that hold template text and nothing else are text", () => {
  const src = [
    "const page = `<script>",        // 1 code: opens the template
    "function f(x) { return x + 1; }", // 2 text
    "",                                 // 3 text: a blank line inside the template
    "const n = ${count};",              // 4 code: an expression
    "a \\` still text",                 // 5 text: an escaped backtick does not close it
    "${inner(`nested",                  // 6 code
    "nested text`)}",                   // 7 code: the nested template closes here, then the expression
    "after ${ {a: 1}.a } braces",       // 8 code: braces inside an expression do not close it
    "last line of text",                // 9 text
    "</script>`;",                      // 10 code: closes the template
    "const q = 4 / 2; // not a regex `", // 11 code: a backtick in a comment opens nothing
    "const s = \"`\" + '`';",           // 12 code: a backtick in a string opens nothing
    "const r = /[`/]/g.test(s);",       // 13 code: nor does one in a regular expression
    "/* `",                             // 14 code
    "` */ const t = `x`;",              // 15 code
  ].join("\n") + "\n";
  assert.deepEqual(lineSet(src), [2, 3, 5, 9]);
});

// Every case is followed by the same template, whose line 3 is text. A `/` the
// lexer misreads turns the backtick before it into an opening one, and the
// tail then ends inside a template: no text line at all instead of [3].
const TAIL = "\nconst t = `\nTEXT\n`;\n";

test("a slash after an operator, a keyword or a template expression opens a regular expression", () => {
  const leads = [..."(,=:[!&|?{};+-*%<>~^"].map((p) => "a " + p + " ")
    .concat(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
      "throw", "case", "do", "else", "yield", "await"].map((w) => w + " "))
    .concat(["", "\t", "\r"]);
  for (const lead of leads) {
    const src = lead + "/[`/]/g.source;" + TAIL;
    assert.deepEqual(templateTextLines(src), [{ start: 3, end: 3 }], "after " + JSON.stringify(lead) + ": " + src);
  }
  const inExpr = "const p = `\n${ /`/.source }\nTEXT\n`;\n";
  assert.deepEqual(templateTextLines(inExpr), [{ start: 3, end: 3 }], "a `${` is where an expression, and a regex, may start");
});

test("a slash after a value divides", () => {
  for (const lead of ["a", "a1_$", ")", "]", "'s'", '"s"', "`s`", "/re/g", "/re/"]) {
    // Read as a regular expression, the `/` would run to the end of the line
    // and the lexer would give up: no text line instead of [2].
    const src = "q = " + lead + " / 2; const t = `\nTEXT\n`;\n";
    assert.deepEqual(templateTextLines(src), [{ start: 2, end: 2 }], "after " + JSON.stringify(lead) + ": " + src);
  }
  // The closing slash is consumed with the regex: left behind, it and the `*`
  // that multiplies would read as a comment that never closes.
  assert.deepEqual(templateTextLines("q = /re/*2; const t = `\nTEXT\n`;\n"), [{ start: 2, end: 2 }]);
});

test("comments, strings and escapes hide a backtick from the lexer", () => {
  const cases = [
    "// `",
    "/* ` */",
    "/* `\n` */",
    "'`'",
    '"\\"`"',
    "'\\'`'",
    "/\\/`/",
    "/[/`]/",
    "/*/ ` */",
  ];
  for (const c of cases) {
    const src = "x = 1;\n" + c + ";\nconst t = `\nTEXT\n`;\n";
    const textLine = src.split("\n").indexOf("TEXT") + 1;
    assert.deepEqual(templateTextLines(src), [{ start: textLine, end: textLine }], JSON.stringify(c));
  }
  assert.deepEqual(templateTextLines("const t = `\n\\${not} an expression\n`;\n"), [{ start: 2, end: 2 }]);
  assert.deepEqual(templateTextLines("const t = `\na\\`b\n`;\n"), [{ start: 2, end: 2 }]);
  assert.deepEqual(templateTextLines("x = `${ f({\n}, \nb) }\nTEXT\n`;\n"), [{ start: 4, end: 4 }],
    "the brace closing an object inside `${` does not close the expression");
  assert.deepEqual(templateTextLines("x = `${ a\n}TEXT\nMORE\n`;\n"), [{ start: 3, end: 3 }],
    "the brace that closes `${` is code on its line");
  assert.deepEqual(templateTextLines("/* c */`\nTEXT\n`;\n"), [{ start: 2, end: 2 }], "a backtick right after a comment opens");
  assert.deepEqual(templateTextLines("t = `\nTEXT\n`; // no newline at the end"), [{ start: 2, end: 2 }]);
  assert.deepEqual(templateTextLines("t = `\nTEXT\n`; end"), [{ start: 2, end: 2 }]);
});

test("source the lexer cannot follow to the end claims no text at all", () => {
  // It errs towards code: a line called text must be unable to hold a mutant.
  // Each of these would otherwise leave line 3 looking like template text.
  for (const head of ["const a = `", "const a = 'x", "/* open", "x = /re", "x = /[re/", "const a = `${ {"]) {
    const src = "y = `\nok\n`;\n" + head;
    assert.deepEqual(templateTextLines(src), [], JSON.stringify(head));
  }
  assert.deepEqual(templateTextLines("a = 'line\nbreak';\nt = `\nx\n`;\n"), [], "a quote does not span lines");
  assert.deepEqual(templateTextLines("a = /line\nbreak/;\nt = `\nx\n`;\n"), [], "a regular expression does not span lines");
  assert.deepEqual(templateTextLines("const a = `\nopen\n"), []);
});

test("in build-viewer.mjs, the body of the page's metaRowHtml() is text and buildHtml is code", () => {
  const source = scriptSource("build-viewer.mjs");
  const lines = source.split("\n");
  const at = (re) => {
    const i = lines.findIndex((l) => re.test(l));
    assert.ok(i >= 0, "the line the assertion rests on has moved: " + re);
    return i + 1;
  };
  const text = new Set(lineSet(source));
  const metaRow = at(/^function metaRowHtml\(/);
  assert.ok(text.has(metaRow) && text.has(metaRow + 1),
    "metaRowHtml() is page code inside a template literal and must be classified as such");
  assert.equal(text.has(at(/^export function buildHtml\(/)), false, "buildHtml() is module code Stryker mutates");
  assert.ok(text.size > 1000, "the page script is far larger than " + text.size + " lines");
  assert.equal(lines.some((l) => /^function startEdit\(/.test(l)), false,
    "startEdit() is written in the page template again instead of in viewer-field-editors.mjs");
});

test("in viewer-field-editors.mjs, the body of startEdit() is code a mutation run mutates", () => {
  const source = scriptSource("viewer-field-editors.mjs");
  const lines = source.split("\n");
  const startEdit = lines.findIndex((l) => /^export function startEdit\(/.test(l)) + 1;
  assert.ok(startEdit > 0, "viewer-field-editors.mjs no longer declares startEdit()");
  // Positive control: the module does hold template-free code to classify.
  assert.ok(lines.length > startEdit + 10);
  assert.deepEqual(templateTextLines(source), [], "no line of the field editors is template-literal text");
});

// Lines 7-16 are the page's text; line 17 interpolates, so it is code.
const BASE = `export function title(t) {
  return t.trim();
}

export function page(n) {
  return \`<script>
function show(x) {
  return x;
}
function hide(x) {
  return !x;
}
function both(x) {
  return [show(x), hide(x)];
}
// the end of the page's own code
const N = \${n};
</script>\`;
}
`;

function sh(cwd, cmd, args) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, cmd + " " + args.join(" ") + ": " + r.stderr);
}

function write(root, rel, text) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}

function fixture() {
  const root = fixtureDir(join(tmpdir(), "branchling-test-mutation-text-"));
  write(root, "scripts/view.mjs", BASE);
  write(root, "scripts/other.mjs", "export const a = 1;\nexport const b = 2;\n");
  write(root, "scripts/tests/view.test.mjs", 'import "../view.mjs"; import "../other.mjs";\n');
  sh(root, "git", ["init", "-q"]);
  sh(root, "git", ["add", "-A"]);
  sh(root, "git", ["commit", "-q", "-m", "base"]);
  sh(root, "git", ["switch", "-q", "-c", "feature"]);
  return root;
}

function run(root, args) {
  const r = spawnSync(process.execPath, [ENTRY, "--base", "main", ...args], { cwd: root, encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const GUARD = "a template literal is one string to Stryker, so code written inside one — the viewer's page script "
  + "in build-viewer.mjs — is guarded only by tests that execute the text it builds (the page script run in node:vm), "
  + "not by this run";

test("a change only inside a template literal is refused, and the run says it is template text", async () => {
  const root = fixture();
  try {
    write(root, "scripts/view.mjs", BASE.replace("  return x;\n", "  return x + 1;\n"));
    const p = await plan(root, { base: "main", changedLines: true });
    assert.deepEqual(p.lines, {}, "the plan names template text as lines it mutates");
    assert.deepEqual(p.onlyText, ["scripts/view.mjs"]);
    const r = run(root, ["--changed-lines"]);
    assert.equal(r.code, 1, r.out + r.err);
    assert.equal(r.err.replace(/^\S+ /, ""), [
      "node scripts/mutation-run.mjs: nothing to mutate: every line asked for is template-literal text, scripts/view.mjs:8-8",
      "  Stryker would create no mutant there, and a run with none would read like one whose mutants were all killed.",
      "  Not mutated because " + GUARD + ".",
      "",
    ].join("\n"), "the refusal says what and why, and nothing else");
    assert.equal(r.out, "", "a refused run printed something that could be read as a result");

    // Text in two places of one module is named range by range.
    write(root, "scripts/view.mjs", BASE.replace("  return x;\n", "  return x + 1;\n").replace("  return !x;\n", "  return !!x;\n"));
    assert.match(run(root, ["--changed-lines"]).err, /template-literal text, scripts\/view\.mjs:8-8,11-11\n/);

    // Modules the change only deleted from are named beside it, not dropped.
    write(root, "scripts/other.mjs", "export const a = 1;\n");
    write(root, "scripts/third.mjs", "\n");
    sh(root, "git", ["add", "-A"]);
    sh(root, "git", ["commit", "-qm", "third"]);
    sh(root, "git", ["switch", "-q", "main"]);
    sh(root, "git", ["merge", "-q", "feature"]);
    sh(root, "git", ["switch", "-q", "feature"]);
    write(root, "scripts/view.mjs", BASE.replace("  return x;\n", "  return x + 2;\n"));
    write(root, "scripts/other.mjs", "");
    write(root, "scripts/third.mjs", "");
    const both = run(root, ["--changed-lines"]);
    assert.equal(both.code, 1, both.out + both.err);
    assert.match(both.err, /\n  Not mutated \(no added line\): scripts\/other\.mjs, scripts\/third\.mjs\n/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an explicit --files range inside the template is refused the same way, whatever its digits", () => {
  const root = fixture();
  try {
    for (const range of ["7-9", "7-16", "10-16"]) {
      const r = run(root, ["--files", "scripts/view.mjs:" + range]);
      assert.equal(r.code, 1, range + ": " + r.out + r.err);
      assert.match(r.err, new RegExp("template-literal text, scripts/view\\.mjs:" + range + "\\n"));
    }
    const two = run(root, ["--files", "scripts/view.mjs:7-9,scripts/view.mjs:11-12"]);
    assert.match(two.err, /template-literal text, scripts\/view\.mjs:7-9, scripts\/view\.mjs:11-12\n/);
    const whole = run(root, ["--files", "scripts/view.mjs:6-7", "--plan", "--json"]);
    assert.equal(whole.code, 0, "a range with one line of code in it is still mutated: " + whole.err);
    assert.deepEqual(JSON.parse(whole.out).mutate, ["scripts/view.mjs:6-7"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a change touching code and template text mutates the code and names the text", () => {
  const root = fixture();
  try {
    write(root, "scripts/view.mjs", BASE.replace("t.trim()", "t.trim().toUpperCase()")
      .replace("  return x;\n", "  return x + 1;\n").replace("  return !x;\n", "  return !!x;\n"));
    const json = run(root, ["--changed-lines", "--plan", "--json"]);
    assert.equal(json.code, 0, json.err);
    const p = JSON.parse(json.out);
    assert.deepEqual(p.mutate, ["scripts/view.mjs:2-2"], "a range of template text alone is not handed to Stryker");
    assert.deepEqual(p.modules, ["scripts/view.mjs"]);
    assert.deepEqual(p.lines, { "scripts/view.mjs": [{ start: 2, end: 2 }] });
    assert.deepEqual(p.onlyText, []);
    assert.deepEqual(p.templateText, { "scripts/view.mjs": { whole: false, ranges: [{ start: 8, end: 8 }, { start: 11, end: 11 }] } });

    const text = run(root, ["--changed-lines", "--plan"]);
    assert.match(text.out, /^mutated lines only: scripts\/view\.mjs:2-2$/m);
    assert.match(text.out, /^not mutated \(template-literal text\): scripts\/view\.mjs:8-8,11-11$/m);
    assert.ok(text.out.includes("\n  " + GUARD + "\n"), text.out);

    // One module only text, the other code: the text one is reported, not mutated.
    write(root, "scripts/view.mjs", BASE.replace("  return x;\n", "  return x + 1;\n"));
    write(root, "scripts/other.mjs", "export const a = 1;\nexport const b = 3;\n");
    const mixed = JSON.parse(run(root, ["--changed-lines", "--plan", "--json"]).out);
    assert.deepEqual(mixed.modules, ["scripts/other.mjs"]);
    assert.deepEqual(mixed.onlyText, ["scripts/view.mjs"]);
    assert.deepEqual(mixed.lines, { "scripts/other.mjs": [{ start: 2, end: 2 }] });
    assert.deepEqual(mixed.mutate, ["scripts/other.mjs:2-2"]);

    // POSITIVE CONTROL: a change to code alone reports no template text.
    write(root, "scripts/other.mjs", "export const a = 1;\nexport const b = 2;\n");
    write(root, "scripts/view.mjs", BASE.replace("t.trim()", "t.trim().toUpperCase()"));
    const code = run(root, ["--changed-lines", "--plan", "--json"]);
    assert.equal(code.code, 0, code.err);
    assert.deepEqual(JSON.parse(code.out).templateText, {});
    // The cost lines (TL-682) depend on whether Stryker is installed and on a
    // timed run; mutation-run.test.mjs asserts them.
    const scope = run(root, ["--changed-lines", "--plan"]).out.split("\n")
      .filter((l) => !/^(mutants\b|estimate: |the selected tests failed)/.test(l)).join("\n");
    assert.equal(scope, [
      "mutate (1): scripts/view.mjs",
      "mutated lines only: scripts/view.mjs:2-2",
      "not mutated: every line outside these ranges, and every mutant spanning one",
      "tests (1):",
      "  scripts/tests/view.test.mjs  — view.mjs named",
      "",
    ].join("\n"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a whole-module run says how many of its lines are template text", () => {
  const root = fixture();
  try {
    const r = run(root, ["--files", "scripts/view.mjs", "--plan"]);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /^not mutated \(template-literal text\): scripts\/view\.mjs \(10 lines\)$/m);
    const p = JSON.parse(run(root, ["--files", "scripts/view.mjs", "--plan", "--json"]).out);
    assert.deepEqual(p.templateText, { "scripts/view.mjs": { whole: true, ranges: [{ start: 7, end: 16 }] } });
    assert.deepEqual(p.mutate, ["scripts/view.mjs"], "a whole module is mutated, its text only reported");

    write(root, "scripts/one.mjs", "export const s = `a\nb\nc`;\n");
    const one = run(root, ["--files", "scripts/view.mjs,scripts/one.mjs", "--tests", "scripts/tests/view.test.mjs", "--plan"]);
    assert.match(one.out, /^not mutated \(template-literal text\): scripts\/view\.mjs \(10 lines\)  scripts\/one\.mjs \(1 line\)$/m);

    const missing = run(root, ["--files", "scripts/missing.mjs", "--tests", "scripts/tests/view.test.mjs", "--plan", "--json"]);
    assert.equal(missing.code, 0, missing.err);
    assert.deepEqual(JSON.parse(missing.out).templateText, {}, "a module that is not there has no text to report");
    const odd = JSON.parse(run(root, ["--files", "scripts/view.mjs:7-9x", "--tests", "scripts/tests/view.test.mjs", "--plan", "--json"]).out);
    assert.deepEqual(odd.mutate, ["scripts/view.mjs:7-9x"], "only a whole `:start-end` suffix is a range");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
