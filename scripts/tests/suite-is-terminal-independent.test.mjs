/**
 * The suite answers the same whether or not it is run in a terminal (TL-238).
 *
 * WHAT WENT WRONG. Every agent in this project runs `node --test` through a tool
 * whose stdout is a pipe: no TTY, no `FORCE_COLOR`, no colour, green. A person
 * ran the same command at a keyboard on 2026-09-04 and got twelve failures, all
 * of one shape — an assertion on rendered text meeting ANSI escapes. The suite
 * had been reporting the state of the observer, and so had every "green" this
 * project recorded, including the ones `done` writes into closing records.
 *
 * TWO CAUSES, BOTH FIXED, BOTH GUARDED HERE. The painter used to decide at
 * IMPORT, so a test's later declaration arrived after the decision; and
 * `next-id` printed its number through `console.log(<number>)`, letting
 * `util.inspect` paint it yellow — the one value that command exists to hand to
 * `$(…)`.
 *
 * A THIRD CAUSE, FOUND WHEN CI STARTED MEASURING OLDER RUNTIMES (TL-434). The
 * declaration `plainOutput()` makes was half a declaration: it set `NO_COLOR`
 * and left `FORCE_COLOR` standing, and Node 18 and 20 warn about that pair on
 * the stderr of every child. The suite below was green on the newest Node and
 * red on the two oldest ones the manifest claims — reporting the runtime where
 * it used to report the terminal. `plainOutput()` now deletes the counter-
 * declaration, and the case further down holds that.
 *
 * WHY IT RUNS THE FILES AGAIN rather than inspecting them. What a test asserts
 * is not visible in its source: the dependence lives in a painter three modules
 * away and in Node's own formatting of a value. Running them under the variable
 * a terminal implies is the only reading that cannot be fooled.
 *
 * THE POSITIVE CONTROL is a fixture test written to depend on colour. If the
 * runner below cannot make that one fail, it is not exercising anything and
 * every other assertion in this file is worthless.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { isolateHome, plainOutput } from "./_repo.mjs";

isolateHome("terminal-independent");
plainOutput();

const HERE = dirname(fileURLToPath(import.meta.url));

const SELF = "suite-is-terminal-independent.test.mjs";

/**
 * Find tests that can observe human-facing output rather than asking their
 * author to remember a second list. `plainOutput()` preserves every test that
 * already declares the contract explicitly; importing the painter or spawning
 * the CLI finds a new rendering test before that declaration has been added.
 *
 * This file is excluded because it deliberately starts a nested test runner.
 * Running it inside itself would recurse; that exclusion is about the runner,
 * not about which product output counts as rendered text.
 */
function discoverRenderingTests(testDir = HERE) {
  return readdirSync(testDir)
    .filter((name) => name.endsWith(".test.mjs") && name !== SELF)
    .filter((name) => {
      const source = readFileSync(join(testDir, name), "utf8");
      const declaresPlainOutput = source.includes("plainOutput(");
      const importsPainter = source.includes("../ui.mjs");
      const spawnsCli = source.includes("cli.mjs") &&
        /\b(?:spawn|spawnSync|execFile|execFileSync)\s*\(/.test(source);
      return declaresPlainOutput || importsPainter || spawnsCli;
    })
    .sort();
}

/** `node --test <files>` with colour forced on, as a terminal implies. */
function runInColour(files, cwd = HERE) {
  // The child must be an ORDINARY test run. `node --test` exports its own
  // context to children (`NODE_TEST_CONTEXT`), and a nested runner that inherits
  // it reports upwards instead of running, which exits 0 in milliseconds — a
  // green that means nothing. `NO_COLOR` has to go for the same reason it is set
  // everywhere else: here we WANT the colour.
  const env = { ...process.env, FORCE_COLOR: "1" };
  delete env.NO_COLOR;
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_OPTIONS;
  return spawnSync(process.execPath, ["--test"].concat(files), {
    cwd, encoding: "utf8", timeout: 600_000, env,
  });
}

test("the rendering tests pass with colour forced on", () => {
  const renderingTests = discoverRenderingTests();
  assert.ok(renderingTests.length > 0,
    "the discovery found no rendering tests, so a green nested run would prove nothing");
  const r = runInColour(renderingTests);
  assert.equal(r.status, 0,
    renderingTests.length + " rendering tests were discovered; the suite is green through a pipe " +
      "and red at a keyboard — it is reporting the observer\n" +
      String(r.stdout || "").split("\n").filter((l) => l.includes("not ok") || l.includes("✖")).slice(0, 12).join("\n"));
});

/**
 * A DECLARATION IS NOT A DECLARATION UNTIL THE CONTRARY ONE IS GONE (TL-434).
 *
 * `colorAllowed()` lets `NO_COLOR` win, so the painter obeyed the declaration
 * even with `FORCE_COLOR` still standing beside it — but an environment holding
 * both is a contradiction, and Node 18 and 20 print a warning about it on the
 * stderr of EVERY process that inherits the pair. A test that asserts a command
 * was silent then reads Node's sentence as the tool's, which is what turned
 * `next-id-empty-backlog` red on those two runtimes and green on 22 and 24.
 *
 * The case sets `FORCE_COLOR` FIRST, so it cannot pass by the variable never
 * having been there — that is its positive control.
 */
test("plainOutput() leaves ONE colour decision in the environment", () => {
  const before = process.env.FORCE_COLOR;
  try {
    process.env.FORCE_COLOR = "1";
    plainOutput();
    assert.equal(process.env.NO_COLOR, "1");
    assert.equal(process.env.FORCE_COLOR, undefined,
      "the environment declares plain output AND forced colour at once; Node 18 and 20 " +
        "say so on the stderr of every child, and a test asserting silence reads that as the tool speaking");
  } finally {
    if (before === undefined) delete process.env.FORCE_COLOR;
    else process.env.FORCE_COLOR = before;
    plainOutput();
  }
});

test("POSITIVE CONTROL: a test that DOES depend on colour is caught by that runner", () => {
  const dir = mkdtempSync(join(tmpdir(), "branchling-colour-control-"));
  try {
    const tests = join(dir, "tests");
    const file = join(tests, "depends-on-colour.test.mjs");
    const fixtureUi = join(dir, "ui.mjs");
    const realUi = join(HERE, "..", "ui.mjs");
    // The relative import is the same signal a new repository test carries;
    // the re-export keeps the fixture about the real painter rather than a
    // hand-written imitation of it.
    mkdirSync(tests, { recursive: true });
    writeFileSync(fixtureUi,
      'export { color } from "' + pathToFileURL(realUi).href + '";\n', "utf8");
    // It asserts that the painter does not paint — true through a pipe, false at
    // a keyboard. Exactly the defect, in one line.
    writeFileSync(file,
      'import { test } from "node:test";\n' +
      'import assert from "node:assert/strict";\n' +
      'import { color } from "../ui.mjs";\n' +
      'test("assumes no colour", () => { assert.equal(color.id("x"), "x"); });\n',
      "utf8");
    const discovered = discoverRenderingTests(tests);
    assert.deepEqual(discovered, ["depends-on-colour.test.mjs"],
      "a new rendering test was not selected until somebody edited a list");
    const r = runInColour(discovered, tests);
    assert.notEqual(r.status, 0,
      "the runner cannot make a colour-dependent test fail, so it proves nothing about the others");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
