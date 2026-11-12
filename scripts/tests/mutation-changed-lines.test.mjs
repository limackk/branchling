/**
 * A mutation run limited to the lines a change touched (TL-648). No Stryker
 * here — this file runs in the default suite, which CI runs WITHOUT `npm
 * install`. What it proves is the half that decides what Stryker is asked to
 * mutate: the diff hunks become `path:start-end` entries, those entries are
 * the `mutate` list of the configuration Stryker is given, and the report
 * names them. That Stryker creates no mutant outside such an entry is proved
 * by a real run in `scripts/tests/mutation/changed-lines.test.mjs`.
 *
 * The fixture module has two functions; the branch changes only `shout`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fixtureDir } from "./_fixture-dir.mjs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { SCRIPTS_DIR, isolateHome } from "./_repo.mjs";
import { hunkRanges, strykerConfig } from "../mutation-run.mjs";

isolateHome("mutation-changed-lines");
const ENTRY = join(SCRIPTS_DIR, "mutation-run.mjs");

const BASE_LIB = `export function greet(name) {
  return "hello " + name;
}

export function shout(text) {
  return text;
}
`;
// shout() is lines 5-8 after the change; lines 6-7 are what the change wrote.
const CHANGED_LIB = `export function greet(name) {
  return "hello " + name;
}

export function shout(text) {
  const loud = text.toUpperCase();
  return loud + "!";
}
`;

function sh(cwd, cmd, args) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, cmd + " " + args.join(" ") + ": " + r.stderr);
  return r.stdout;
}

function write(root, rel, text) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}

function fixture() {
  const root = fixtureDir(join(tmpdir(), "branchling-test-mutation-lines-"));
  write(root, "scripts/lib.mjs", BASE_LIB);
  write(root, "scripts/gone.mjs", "export const a = 1;\nexport const b = 2;\n");
  write(root, "scripts/gone-too.mjs", "export const c = 3;\nexport const d = 4;\n");
  write(root, "scripts/tests/lib.test.mjs", 'import "../lib.mjs"; import "../gone.mjs"; import "../fresh.mjs";\n');
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

function planOf(root, extra = []) {
  const r = run(root, ["--plan", "--json", ...extra]);
  assert.equal(r.code, 0, r.err);
  return JSON.parse(r.out);
}

test("hunk headers become merged new-side ranges, and a deletion contributes none", () => {
  const diff = [
    "diff --git a/x.mjs b/x.mjs",
    "--- a/x.mjs",
    "+++ b/x.mjs",
    "@@ -1,2 +1,3 @@",
    "+++ an added line that reads like a file header",
    "@@ -9 +4 @@",        // no count means one line, and it touches 1-3
    "@@ -20,3 +19,0 @@",  // lines deleted, none added
    "@@ -30 +12,2 @@",
  ].join("\n");
  assert.deepEqual(hunkRanges(diff), [{ start: 1, end: 4 }, { start: 12, end: 13 }]);
  assert.deepEqual(hunkRanges(""), []);
  // TL-676: a header is read only at the start of a line, and counts of any width.
  assert.deepEqual(hunkRanges("@@ -100,20 +100,30 @@\n+x @@ -1 +5,2 @@\n"), [{ start: 100, end: 129 }]);
  assert.deepEqual(hunkRanges("@@ -1,12 +1 @@"), [{ start: 1, end: 1 }]);
});

test("with --changed-lines only the lines the change wrote are mutated, committed and uncommitted alike", () => {
  const root = fixture();
  try {
    write(root, "scripts/lib.mjs", CHANGED_LIB.replace('"!"', '"?"'));
    sh(root, "git", ["commit", "-qam", "committed half"]);
    write(root, "scripts/lib.mjs", CHANGED_LIB);                              // uncommitted on top
    write(root, "scripts/fresh.mjs", "export const x = 1;\nexport const y = 2;\n"); // untracked
    write(root, "scripts/gone.mjs", "export const a = 1;\n");                  // a line deleted, none added

    const whole = planOf(root);
    assert.deepEqual(whole.mutate, ["scripts/fresh.mjs", "scripts/gone.mjs", "scripts/lib.mjs"],
      "without the flag a run still mutates whole modules");
    assert.equal(whole.lines, undefined);

    const p = planOf(root, ["--changed-lines"]);
    assert.deepEqual(p.lines, {
      "scripts/fresh.mjs": [{ start: 1, end: 2 }],
      "scripts/lib.mjs": [{ start: 6, end: 7 }],
    });
    assert.deepEqual(p.mutate, ["scripts/fresh.mjs:1-2", "scripts/lib.mjs:6-7"]);
    assert.deepEqual(p.modules, ["scripts/fresh.mjs", "scripts/lib.mjs"]);
    assert.deepEqual(p.noAddedLines, ["scripts/gone.mjs"]);
    assert.deepEqual(p.tests.map((t) => t.file), ["scripts/tests/lib.test.mjs"]);

    // The entries reach Stryker unchanged, in the syntax it reads as a range.
    const config = strykerConfig(p, { concurrency: 1 }, [], "/work");
    assert.deepEqual(config.mutate, p.mutate);
    for (const entry of config.mutate) assert.match(entry, /^scripts\/[a-z]+\.mjs:\d+-\d+$/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the report names the ranges and says that lines outside them were not mutated", () => {
  const root = fixture();
  try {
    write(root, "scripts/lib.mjs", CHANGED_LIB);
    write(root, "scripts/gone.mjs", "export const a = 1;\n");
    write(root, "scripts/gone-too.mjs", "export const c = 3;\n");
    const r = run(root, ["--plan", "--changed-lines"]);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /^mutated lines only: scripts\/lib\.mjs:6-7$/m);
    assert.match(r.out, /^not mutated: every line outside these ranges/m);
    assert.match(r.out, /^not mutated \(no added line\): scripts\/gone-too\.mjs, scripts\/gone\.mjs$/m);

    const plain = run(root, ["--plan"]);
    assert.doesNotMatch(plain.out, /mutated lines only/, "a whole-module run claimed a line range");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a ranged --files entry under --changed-lines mutates the changed lines inside its range (TL-705)", () => {
  const root = fixture();
  try {
    write(root, "scripts/lib.mjs", CHANGED_LIB);                    // lines 6-7 changed
    const p = planOf(root, ["--changed-lines", "--files", "scripts/lib.mjs:7-8"]);
    assert.deepEqual(p.mutate, ["scripts/lib.mjs:7-7"], "the range was not intersected with the change");
    assert.deepEqual(p.lines, { "scripts/lib.mjs": [{ start: 7, end: 7 }] });
    assert.deepEqual(p.modules, ["scripts/lib.mjs"]);
    assert.deepEqual(p.noAddedLines, []);
    assert.deepEqual(p.tests.map((t) => t.file), ["scripts/tests/lib.test.mjs"]);

    // A range wider than the change keeps the change; one beside it holds no changed line.
    assert.deepEqual(planOf(root, ["--changed-lines", "--files", "scripts/lib.mjs:1-8"]).mutate, ["scripts/lib.mjs:6-7"]);
    const beside = planOf(root, ["--changed-lines", "--files", "scripts/lib.mjs:7-8,scripts/lib.mjs:1-3"]);
    assert.deepEqual(beside.mutate, ["scripts/lib.mjs:7-7"]);
    assert.deepEqual(beside.noAddedLines, ["scripts/lib.mjs:1-3"]);
    // The same file also given whole is mutated on every changed line.
    assert.deepEqual(planOf(root, ["--changed-lines", "--files", "scripts/lib.mjs:7-8,scripts/lib.mjs"]).mutate,
      ["scripts/lib.mjs:6-7"]);

    // Each file is narrowed by its own entries only.
    write(root, "scripts/fresh.mjs", "export const x = 1;\nexport const y = 2;\nexport const z = 3;\n");
    const two = planOf(root, ["--changed-lines", "--files", "scripts/lib.mjs:7-8,scripts/fresh.mjs:2-2"]);
    assert.deepEqual(two.lines, { "scripts/lib.mjs": [{ start: 7, end: 7 }], "scripts/fresh.mjs": [{ start: 2, end: 2 }] });
    assert.deepEqual(two.mutate, ["scripts/lib.mjs:7-7", "scripts/fresh.mjs:2-2"]);

    const outside = run(root, ["--changed-lines", "--files", "scripts/lib.mjs:1-3"]);
    assert.equal(outside.code, 1, outside.out + outside.err);
    assert.match(outside.err, /nothing to mutate: the change added no line to scripts\/lib\.mjs:1-3\n/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a change that only deleted lines leaves nothing to mutate, and the run says so", () => {
  const root = fixture();
  try {
    write(root, "scripts/gone.mjs", "export const a = 1;\n");
    write(root, "scripts/gone-too.mjs", "export const c = 3;\n");
    const r = run(root, ["--changed-lines", "--json"]);
    assert.equal(r.code, 1, r.out + r.err);
    assert.deepEqual(r.err.replace(/\x1b\[[0-9;]*m/g, "").split("\n").slice(0, 3), [
      "✗ node scripts/mutation-run.mjs: nothing to mutate: the change added no line to scripts/gone-too.mjs, scripts/gone.mjs",
      "  A line that was only deleted leaves nothing to mutate, and a score over an empty set would read like a score over real work.",
      "  → node scripts/mutation-run.mjs --files scripts/gone-too.mjs,scripts/gone.mjs",
    ]);
    assert.equal(r.out, "", "a refused run printed something that could be read as a result");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
