/**
 * The scope of a mutation run: what it mutates and which tests it consults
 * (TL-576). No Stryker here — this file runs in the default suite, which CI
 * runs WITHOUT `npm install`. The run itself is proved by
 * `scripts/tests/mutation/subprocess-kill.test.mjs`.
 *
 * Each fixture is a throwaway git repository with a `main` branch and a
 * feature branch on top, laid out like this one: `scripts/` holds the code,
 * `scripts/tests/` the tests, and `scripts/cli.mjs` exports a `COMMANDS`
 * table that dispatches to scripts.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fixtureDir } from "./_fixture-dir.mjs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SCRIPTS_DIR, isolateHome } from "./_repo.mjs";
import { reachesCli } from "../mutation-run.mjs";

const HOME = isolateHome("mutation-run");
const ENTRY = join(SCRIPTS_DIR, "mutation-run.mjs");

function sh(cwd, cmd, args) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, cmd + " " + args.join(" ") + ": " + r.stderr);
  return r.stdout;
}

function write(root, rel, text) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}

// Built rather than written out: this file would otherwise build the path of
// the repository's CLI itself, and be selected for every module cli.mjs imports.
const SPAWN_CLI = "const c = join(SCRIPTS_DIR, " + JSON.stringify("cli.mjs") + ");";

function fixture() {
  const root = fixtureDir(join(tmpdir(), "branchling-test-mutation-scope-"));
  write(root, "scripts/lib.mjs", "export const lib = () => 1;\n");
  write(root, "scripts/greet.mjs", 'import { lib } from "./lib.mjs";\nconsole.log(lib());\n');
  write(root, "scripts/other.mjs", "export const other = () => 2;\n");
  write(root, "scripts/cli.mjs", 'export const COMMANDS = { greet: { script: "greet.mjs" } };\n');
  // Rule 1: names the module.
  write(root, "scripts/tests/named.test.mjs", 'import "../lib.mjs";\n');
  // Rule 2: names a script that imports it.
  write(root, "scripts/tests/via-script.test.mjs", 'const s = "greet.mjs";\n');
  // Rule 3: builds the path of scripts/cli.mjs and names a command whose script imports it.
  write(root, "scripts/tests/via-command.test.mjs", SPAWN_CLI + ' run(["greet"]);\n');
  // Spawns the CLI, but names no command that reaches lib.mjs.
  write(root, "scripts/tests/cli-unrelated.test.mjs", SPAWN_CLI + ' run(["serve"]);\n');
  write(root, "scripts/tests/unrelated.test.mjs", 'const s = "other.mjs";\n');
  // Names a file called cli.mjs that a fixture of its own writes, and the command
  // word, but never spawns the repository's CLI (TL-591).
  write(root, "scripts/tests/names-cli.test.mjs", 'write(root, "scripts/cli.mjs", ""); run(["greet"]);\n');
  // A relative specifier that resolves to the repository root, not to scripts/.
  write(root, "scripts/tests/wrong-depth.test.mjs", 'const c = new URL("../../cli.mjs", import.meta.url); run(["greet"]);\n');
  // Outside the default glob, and the same specifier resolves to scripts/cli.mjs from here.
  write(root, "scripts/tests/nested/deep.test.mjs", 'const c = new URL("../../cli.mjs", import.meta.url); run(["greet"]);\n');
  write(root, "scripts/tests/nested/unrelated.test.mjs", 'const s = "other.mjs";\n');
  // A helper beside the tests names both modules, but is not a test file.
  write(root, "scripts/tests/nested/_helper.mjs", 'import "../../lib.mjs"; import "../../other.mjs";\n');
  sh(root, "git", ["init", "-q"]);
  sh(root, "git", ["add", "-A"]);
  sh(root, "git", ["commit", "-q", "-m", "base"]);
  sh(root, "git", ["switch", "-q", "-c", "feature"]);
  return root;
}

function run(root, args) {
  const r = spawnSync(process.execPath, [ENTRY, ...args], { cwd: root, encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

function planOf(root, extra = []) {
  const r = run(root, ["--base", "main", "--plan", "--json", ...extra]);
  assert.equal(r.code, 0, r.err);
  return JSON.parse(r.out);
}

test("the run mutates only the modules changed against the base, the working tree included", () => {
  const root = fixture();
  try {
    write(root, "scripts/lib.mjs", "export const lib = () => 3;\n");            // unstaged
    write(root, "scripts/fresh.mjs", "export const fresh = 1;\n");              // untracked
    write(root, "scripts/tests/named.test.mjs", 'import "../lib.mjs"; // x\n'); // a test, never mutated
    write(root, "README.md", "not code\n");
    write(root, "scripts/other.mjs", "export const other = () => 4;\n");
    sh(root, "git", ["commit", "-qam", "committed change"]);                     // committed on the branch
    write(root, "scripts/lib.mjs", "export const lib = () => 5;\n");

    const p = planOf(root);
    assert.equal(p.kind, "mutation-plan");
    assert.deepEqual(p.modules, ["scripts/fresh.mjs", "scripts/lib.mjs", "scripts/other.mjs"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a run with nothing changed fails and reports no score", () => {
  const root = fixture();
  try {
    write(root, "scripts/tests/named.test.mjs", "// only a test changed\n");
    const r = run(root, ["--base", "main", "--json"]);
    assert.equal(r.code, 1, r.out + r.err);
    assert.match(r.err, /nothing to mutate/);
    assert.equal(r.out, "", "a refused run printed something that could be read as a result");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("tests are selected by name, by an importing script and by a command, and not otherwise", () => {
  const root = fixture();
  try {
    write(root, "scripts/lib.mjs", "export const lib = () => 3;\n");
    const p = planOf(root);
    assert.deepEqual(p.modules, ["scripts/lib.mjs"]);
    const why = Object.fromEntries(p.tests.map((t) => [t.file, t.why.join("; ")]));
    assert.deepEqual(Object.keys(why).sort(), [
      "scripts/tests/named.test.mjs",
      "scripts/tests/nested/deep.test.mjs",
      "scripts/tests/via-command.test.mjs",
      "scripts/tests/via-script.test.mjs",
    ]);
    assert.match(why["scripts/tests/named.test.mjs"], /lib\.mjs named/);
    assert.match(why["scripts/tests/via-script.test.mjs"], /imported by greet\.mjs/);
    assert.match(why["scripts/tests/via-command.test.mjs"], /via `greet`/);
    assert.match(why["scripts/tests/nested/deep.test.mjs"], /via `greet`/);

    const narrow = planOf(root, ["--named-only"]);
    assert.deepEqual(narrow.tests.map((t) => t.file), ["scripts/tests/named.test.mjs"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a nested test file is selected by name like a top-level one (TL-591)", () => {
  const root = fixture();
  try {
    write(root, "scripts/other.mjs", "export const other = () => 4;\n");
    const p = planOf(root);
    assert.deepEqual(p.tests.map((t) => t.file), [
      "scripts/tests/nested/unrelated.test.mjs",
      "scripts/tests/unrelated.test.mjs",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a module the CLI imports selects the tests that spawn the CLI, not the ones that name a file cli.mjs (TL-591)", () => {
  const root = fixture();
  try {
    write(root, "scripts/cli.mjs", 'import "./other.mjs";\nexport const COMMANDS = { greet: { script: "greet.mjs" } };\n');
    sh(root, "git", ["commit", "-qam", "cli imports other"]);
    sh(root, "git", ["branch", "-qf", "main"]);
    write(root, "scripts/other.mjs", "export const other = () => 4;\n");
    const p = planOf(root);
    assert.deepEqual(p.modules, ["scripts/other.mjs"]);
    const why = Object.fromEntries(p.tests.map((t) => [t.file, t.why.join("; ")]));
    assert.deepEqual(Object.keys(why).sort(), [
      "scripts/tests/cli-unrelated.test.mjs",
      "scripts/tests/nested/deep.test.mjs",
      "scripts/tests/nested/unrelated.test.mjs",
      "scripts/tests/unrelated.test.mjs",
      "scripts/tests/via-command.test.mjs",
    ]);
    assert.match(why["scripts/tests/cli-unrelated.test.mjs"], /other\.mjs imported by cli\.mjs/);
    assert.match(why["scripts/tests/nested/deep.test.mjs"], /other\.mjs imported by cli\.mjs/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the CLI is recognised by the path a test builds, not by the name cli.mjs (TL-591)", () => {
  // `@` stands for the CLI's filename, so that this file does not contain the
  // forms it asserts on and stays unselected for what cli.mjs imports.
  const reaches = (text, at = "scripts/tests/x.test.mjs") => reachesCli(text.split("@").join("cli.mjs"), at);
  for (const text of [
    'spawnSync(process.execPath, [join(SCRIPTS_DIR, "@"), "next"])',
    'const CLI = join(HERE, "..", "@");',
    'const CLI = join(SCRIPTS_DIR,"@" );',
    'const CLI = SCRIPTS_DIR+"/@";',
    'const CLI = join(ROOT, "scripts", "@");',
    'spawnSync(process.execPath, [SCRIPTS_DIR + "/@", "query"])',
    'const CLI = fileURLToPath(new URL("../@", import.meta.url));',
    'import { COMMANDS } from "../@";',
  ]) assert.equal(reaches(text), true, text);
  assert.equal(reaches('const c = new URL("../../@", import.meta.url);', "scripts/tests/nested/x.test.mjs"), true);
  for (const text of [
    'write(root, "scripts/@", "");',
    'step.command === "node scripts/@ check"',
    'const c = new URL("./@", import.meta.url);',
    'const c = new URL("../../@", import.meta.url);',
  ]) assert.equal(reaches(text), false, text);
  // The case that was measured on 2026-11-06: this file's fixtures name
  // cli.mjs, and it was selected for the task-id module, which it never
  // reaches. The module is not named here, or rule 1 would select it again.
  const self = readFileSync(fileURLToPath(import.meta.url), "utf8");
  assert.equal(reachesCli(self, "scripts/tests/mutation-run.test.mjs"), false);
});

test("a changed module that no test reaches fails instead of scoring zero", () => {
  const root = fixture();
  try {
    write(root, "scripts/orphan.mjs", "export const orphan = 1;\n");
    const r = run(root, ["--base", "main"]);
    assert.equal(r.code, 1, r.out + r.err);
    assert.match(r.err, /no test file reaches scripts\/orphan\.mjs/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an unknown flag fails", () => {
  const r = run(HOME, ["--everything"]);
  assert.equal(r.code, 2);
  assert.match(r.err, /unknown argument "--everything"/);
});
