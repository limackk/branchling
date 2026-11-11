/**
 * A `--named-only` mutation run over a change to a module most of the suite
 * names refuses before Stryker starts, and says why (TL-661). Observed on
 * 2026-11-08: a change touching `scripts/cli.mjs` selected 223 test files
 * under `--named-only`, Stryker instrumented 4307 mutants, and its initial
 * test run timed out, so the "fast lower bound" ended in a stack trace with no
 * mutant judged.
 *
 * No Stryker here: the refusal has to come BEFORE it, which is what makes the
 * test valid without `npm install`. A run without `--plan` is attempted too,
 * so a refusal that only guarded the plan would fail here.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fixtureDir } from "./_fixture-dir.mjs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { REPO_ROOT, SCRIPTS_DIR, isolateHome, plainOutput } from "./_repo.mjs";
import { NAMED_ONLY_MAX_SHARE, candidateTestCount, selectTests, unselectiveModules } from "../mutation-run.mjs";

isolateHome("mutation-named-only-cli");
// The refusal is matched line by line, so colour codes would break the anchors.
plainOutput();
const ENTRY = join(SCRIPTS_DIR, "mutation-run.mjs");
const CLI = "cli" + ".mjs";
// Built rather than written out, as in mutation-run.test.mjs.
const SPAWN_CLI = "const c = join(SCRIPTS_DIR, " + JSON.stringify(CLI) + ");";

function sh(cwd, cmd, args) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, cmd + " " + args.join(" ") + ": " + r.stderr);
  return r.stdout;
}

function write(root, rel, text) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}

/** Four test files; `cliNamers` of them spawn the CLI by path, one names lib.mjs. */
function fixture(cliNamers) {
  const root = fixtureDir(join(tmpdir(), "branchling-test-mutation-named-only-"));
  write(root, "scripts/" + CLI, 'export const COMMANDS = {};\nexport const HELP = "usage";\n');
  write(root, "scripts/lib.mjs", "export const lib = () => 1;\n");
  write(root, "scripts/tests/lib.test.mjs", 'import "../lib.mjs";\n');
  // Not under scripts/tests/, so not a candidate the share is counted against.
  write(root, "scripts/stray.test.mjs", SPAWN_CLI + "\n");
  for (let i = 0; i < 3; i++) {
    write(root, "scripts/tests/e2e-" + i + ".test.mjs", i < cliNamers ? SPAWN_CLI + "\n" : "// nothing\n");
  }
  sh(root, "git", ["init", "-q"]);
  sh(root, "git", ["add", "-A"]);
  sh(root, "git", ["commit", "-q", "-m", "base"]);
  sh(root, "git", ["switch", "-q", "-c", "feature"]);
  // One line of help text, as in the observed run, and a change elsewhere.
  write(root, "scripts/" + CLI, 'export const COMMANDS = {};\nexport const HELP = "usage: x";\n');
  write(root, "scripts/lib.mjs", "export const lib = () => 2;\n");
  return root;
}

function run(cwd, args) {
  const r = spawnSync(process.execPath, [ENTRY, "--base", "main", ...args], { cwd, encoding: "utf8", timeout: 60000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

test("a module named by more than half of the test files is unselective; exactly half is not", () => {
  assert.equal(NAMED_ONLY_MAX_SHARE, 0.5);
  const named = (n) => Array.from({ length: n }, (_, i) => ({ file: "t" + i, why: ["cli.mjs named"] }));
  assert.deepEqual(unselectiveModules(named(3), ["scripts/cli.mjs"], 4),
    [{ module: "scripts/cli.mjs", named: 3, of: 4 }]);
  assert.deepEqual(unselectiveModules(named(2), ["scripts/cli.mjs"], 4), []);
  // A file chosen for another reason does not count as naming the module.
  const other = [{ file: "t", why: ["lib.mjs named"] }, { file: "u", why: ["lib.mjs named"] }];
  assert.deepEqual(unselectiveModules(other, ["scripts/cli.mjs", "scripts/lib.mjs"], 2),
    [{ module: "scripts/lib.mjs", named: 2, of: 2 }]);
});

test("--named-only over a cli.mjs change refuses before Stryker and names the cause", () => {
  const root = fixture(3);
  try {
    write(root, "scripts/extra.mjs", "export const extra = 1;\n");
    for (const extra of [["--plan"], ["--json"], []]) {
      const r = run(root, ["--named-only", "--changed-lines", ...extra]);
      assert.equal(r.code, 1, extra.join(" ") + ": " + r.out + r.err);
      assert.match(r.err, /--named-only does not narrow the tests for scripts\/cli\.mjs$/m);
      assert.match(r.err, /^  scripts\/cli\.mjs is named by 3 of 4 test files, more than 50% of the suite$/m);
      assert.match(r.err, /^  That selection is close to the whole suite: neither fast nor a lower bound/m);
      assert.match(r.err, /^  outlasts Stryker's dry-run timeout, so no mutant would be judged\. Stryker was not started\.$/m);
      assert.match(r.err, /^  Name the tests that exercise the changed lines with --tests, or leave the module out with --files\.$/m);
      assert.match(r.err, /mutation-run\.mjs --changed-lines --tests/, "a --base of main was repeated in the next command");
      assert.match(r.err, /--changed-lines --tests scripts\/tests\/<file>\.test\.mjs$/m);
      assert.match(r.err, /--changed-lines --named-only --files scripts\/extra\.mjs,scripts\/lib\.mjs$/m,
        "the refusal does not offer the run without the unselective module");
      assert.doesNotMatch(r.err, /DryRunExecutor|Stryker produced no report|is not installed/,
        "Stryker was consulted before the refusal");
      assert.equal(r.out, "", "a refused run printed something that could be read as a result");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("every unselective module is named, the base is carried over, and no empty --files is offered", () => {
  const root = fixture(3);
  try {
    sh(root, "git", ["branch", "trunk", "main"]);
    // Every test file now names lib.mjs too: nothing is left to run --named-only over.
    for (let i = 0; i < 3; i++) write(root, "scripts/tests/e2e-" + i + ".test.mjs", SPAWN_CLI + '\nimport "../lib.mjs";\n');
    const r = spawnSync(process.execPath, [ENTRY, "--base", "trunk", "--named-only", "--plan"], { cwd: root, encoding: "utf8" });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /does not narrow the tests for scripts\/cli\.mjs, scripts\/lib\.mjs$/m);
    assert.match(r.stderr, /^  scripts\/lib\.mjs is named by 4 of 4 test files/m);
    assert.match(r.stderr, /mutation-run\.mjs --base trunk --tests scripts\/tests\/<file>\.test\.mjs$/m);
    assert.doesNotMatch(r.stderr, /--named-only --files/, "a --files with no module left was offered as the next command");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the refusal applies only where --named-only selects and the module is named by most of the suite", () => {
  const root = fixture(2);
  try {
    // Positive control: 2 of 4 is not more than half, so the narrow run proceeds.
    const narrow = run(root, ["--named-only", "--plan", "--json"]);
    assert.equal(narrow.code, 0, narrow.err);
    const p = JSON.parse(narrow.out);
    assert.deepEqual(p.unselective, []);
    assert.deepEqual(p.tests.map((t) => t.file), [
      "scripts/tests/e2e-0.test.mjs", "scripts/tests/e2e-1.test.mjs", "scripts/tests/lib.test.mjs",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  const wide = fixture(3);
  try {
    // An explicit --tests is the caller's selection, and the honest set is not --named-only's promise.
    const explicit = run(wide, ["--named-only", "--tests", "scripts/tests/lib.test.mjs", "--plan", "--json"]);
    assert.equal(explicit.code, 0, explicit.err);
    assert.equal(JSON.parse(explicit.out).unselective, undefined);
    const honest = run(wide, ["--plan", "--json"]);
    assert.equal(honest.code, 0, honest.err);
    assert.equal(JSON.parse(honest.out).unselective, undefined);
  } finally {
    rmSync(wide, { recursive: true, force: true });
  }
});

// Through the exported selection, not `git`: a mutation run copies this tree
// into a sandbox with no `.git`, and the refusal is about the tests, not the diff.
test("in this repository cli.mjs is unselective under --named-only, and a narrow module is not", async () => {
  const candidates = candidateTestCount(REPO_ROOT);
  const cliModule = "scripts/" + CLI;
  const cli = unselectiveModules(await selectTests(REPO_ROOT, [cliModule], { namedOnly: true }), [cliModule], candidates);
  assert.equal(cli.length, 1, "cli.mjs is narrowed by --named-only here, which TL-661 measured it is not");
  assert.equal(cli[0].module, cliModule);

  const narrowModule = "scripts/task-id.mjs";
  const tests = await selectTests(REPO_ROOT, [narrowModule], { namedOnly: true });
  assert.ok(tests.length > 0, "the positive control selected no test at all");
  assert.deepEqual(unselectiveModules(tests, [narrowModule], candidates), []);
});
