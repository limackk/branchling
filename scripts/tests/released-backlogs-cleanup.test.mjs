/**
 * `released-backlogs.test.mjs` leaves the temporary directory as it found it
 * (TL-599).
 *
 * That file builds a git repository for every published release (four) and
 * three more for its controls, plus an isolated home and state directory.
 * Before this test it removed none of them, so every run of the suite left
 * nine directories behind — invisible on one run, and the kind
 * of leak that exhausted a volume's inodes under parallel loops (TL-575).
 *
 * A file cannot observe its own `after` hook, so this one runs it as a child
 * with a private `TMPDIR` and counts what is left once the child has exited.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

const TARGET = join(SCRIPTS_DIR, "tests", "released-backlogs.test.mjs");

const TEMP = [];
test.after(() => { for (const d of TEMP) rmSync(d, { recursive: true, force: true }); });
// The children inherit this home; the target isolates its own again, so it
// only keeps this file from ever reading the developer's.
TEMP.push(isolateHome("released-backlogs-cleanup"));

function privateTmp() {
  const dir = mkdtempSync(join(tmpdir(), "branchling-released-cleanup-"));
  TEMP.push(dir);
  return dir;
}

/** The environment of a child whose `os.tmpdir()` is `dir`. */
function envWithTmp(dir) {
  // The child must be an ORDINARY test run: one that inherits the parent's
  // `NODE_TEST_CONTEXT` reports upwards instead of running and exits 0 at once.
  // Colour is switched off so the summary line can be read with an anchor.
  // `NODE_OPTIONS` is the parent's launch configuration, not the child's: an
  // `--inspect` would collide on its port and a `--require` hook would run
  // twice, so the child starts as a plain `node --test` would.
  const env = { ...process.env, TMPDIR: dir, TEMP: dir, TMP: dir, NO_COLOR: "1" };
  delete env.FORCE_COLOR;
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_OPTIONS;
  return env;
}

test("positive control: a directory the child leaves in its TMPDIR is counted", () => {
  const dir = privateTmp();
  const r = spawnSync(process.execPath, ["-e",
    "const { mkdtempSync } = require('node:fs'); const { tmpdir } = require('node:os');" +
    "mkdtempSync(require('node:path').join(tmpdir(), 'branchling-released-leak-'));"],
  { encoding: "utf8", env: envWithTmp(dir) });
  assert.equal(r.status, 0, r.stderr);
  // Without this, an empty directory below would also be what a child that
  // ignored TMPDIR and leaked into the real one leaves here.
  assert.equal(readdirSync(dir).filter((f) => f.startsWith("branchling-released-leak-")).length, 1,
    "the child did not create its directory in the TMPDIR it was given");
});

test("a run of the released-backlog tests leaves its TMPDIR empty", () => {
  const dir = privateTmp();
  const r = spawnSync(process.execPath, ["--test", TARGET], { encoding: "utf8", timeout: 300_000, env: envWithTmp(dir) });
  assert.equal(r.status, 0, "released-backlogs.test.mjs failed:\n" + r.stdout + r.stderr);
  assert.match(r.stdout, /^(?:# |ℹ )pass [1-9]/m, "the child ran no test:\n" + r.stdout);
  assert.deepEqual(readdirSync(dir), [], "left behind by released-backlogs.test.mjs");
});
