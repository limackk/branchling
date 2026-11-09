/**
 * A real mutation run limited to changed lines creates no mutant outside them
 * (TL-648).
 *
 * WHY THIS FILE IS OUTSIDE `scripts/tests/*.test.mjs`. It runs StrykerJS, a
 * devDependency, and the default suite is run by CI WITHOUT `npm install`. It
 * is run by name, as part of TL-648's verification:
 *
 *   node --test scripts/tests/mutation/changed-lines.test.mjs
 *
 * It does NOT skip when Stryker is missing: a skipped control is a green run
 * with no evidentiary force.
 *
 * HOW EVERY MUTANT BECOMES VISIBLE. The report lists the line of a SURVIVOR
 * only. The fixture's test therefore asserts nothing, so every mutant the run
 * creates survives and the survivors are the complete set. The same fixture
 * run without the flag is the negative control: it must create mutants in
 * the unchanged function, or "nothing outside the range" would say nothing.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fixtureDir } from "../_fixture-dir.mjs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { SCRIPTS_DIR, isolateHome } from "../_repo.mjs";

isolateHome("mutation-changed-lines-run");
const ENTRY = join(SCRIPTS_DIR, "mutation-run.mjs");

const BASE_LIB = `export function greet(name) {
  return "hello " + name;
}

export function shout(text) {
  return text;
}
`;
const CHANGED_LIB = `export function greet(name) {
  return "hello " + name;
}

export function shout(text) {
  const loud = text.toUpperCase();
  return loud + "!";
}
`;
const CHANGED_LINES = [6, 7];      // what the change wrote
const SHOUT_LINES = [5, 6, 7, 8];  // the changed function

const TEST = `import { test } from "node:test";
import { greet, shout } from "../lib.mjs";

test("runs both functions and asserts nothing", () => {
  greet("world");
  shout("unchecked");
});
`;

function sh(cwd, cmd, args) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, cmd + " " + args.join(" ") + ": " + r.stderr);
}

function write(root, rel, text) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}

function mutate(root, extra) {
  const r = spawnSync(process.execPath, [ENTRY, "--base", "main", "--json", "--concurrency", "2", ...extra], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stdout + r.stderr.slice(-3000));
  return JSON.parse(r.stdout);
}

test("Stryker is installed, so this control cannot pass by not running", () => {
  assert.doesNotThrow(
    () => createRequire(import.meta.url).resolve("@stryker-mutator/core/package.json"),
    "@stryker-mutator/core is missing — run `npm install`",
  );
});

test("a run limited to changed lines creates mutants inside them and nowhere else", { timeout: 300_000 }, () => {
  const root = fixtureDir(join(tmpdir(), "branchling-test-mutation-lines-run-"));
  try {
    write(root, "scripts/lib.mjs", BASE_LIB);
    write(root, "scripts/tests/lib.test.mjs", TEST);
    sh(root, "git", ["init", "-q"]);
    sh(root, "git", ["add", "-A"]);
    sh(root, "git", ["commit", "-q", "-m", "base"]);
    sh(root, "git", ["switch", "-q", "-c", "feature"]);
    write(root, "scripts/lib.mjs", CHANGED_LIB);

    const whole = mutate(root, []);
    assert.equal(whole.files["scripts/lib.mjs"].Killed, 0, "the fixture test kills nothing, or survivors are not every mutant");
    assert.ok(whole.survivors.some((s) => !SHOUT_LINES.includes(s.line)),
      "the negative control created no mutant outside shout(): " + JSON.stringify(whole.survivors));

    const narrow = mutate(root, ["--changed-lines"]);
    assert.deepEqual(narrow.mutate, ["scripts/lib.mjs:6-7"]);
    assert.equal(narrow.noCoverage, 0);
    assert.equal(narrow.files["scripts/lib.mjs"].Killed, 0);
    assert.ok(narrow.survivors.length > 0, "a run that created no mutant proves nothing about where it creates them");
    for (const s of narrow.survivors) {
      assert.ok(CHANGED_LINES.includes(s.line), "a mutant outside the changed lines: " + JSON.stringify(s));
    }
    assert.ok(narrow.survivors.length < whole.survivors.length);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
