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
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fixtureDir } from "./_fixture-dir.mjs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

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
  // Rule 3: names cli.mjs and a command whose script imports it.
  write(root, "scripts/tests/via-command.test.mjs", 'const c = "cli.mjs"; run(["greet"]);\n');
  // Names cli.mjs, but no command that reaches lib.mjs.
  write(root, "scripts/tests/cli-unrelated.test.mjs", 'const c = "cli.mjs"; run(["serve"]);\n');
  write(root, "scripts/tests/unrelated.test.mjs", 'const s = "other.mjs";\n');
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
      "scripts/tests/via-command.test.mjs",
      "scripts/tests/via-script.test.mjs",
    ]);
    assert.match(why["scripts/tests/named.test.mjs"], /lib\.mjs named/);
    assert.match(why["scripts/tests/via-script.test.mjs"], /imported by greet\.mjs/);
    assert.match(why["scripts/tests/via-command.test.mjs"], /via `greet`/);

    const narrow = planOf(root, ["--named-only"]);
    assert.deepEqual(narrow.tests.map((t) => t.file), ["scripts/tests/named.test.mjs"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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
