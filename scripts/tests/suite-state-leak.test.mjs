/**
 * A test run writes no lock state for a fixture tree into the state directory
 * the developer's own sessions use (TL-735).
 *
 * THE DEFECT. `scripts/lock.mjs` keeps reservations in the per-user state
 * directory (`BACKLOG_STATE_DIR`, else `$XDG_STATE_HOME`, else
 * `~/.local/state`), one directory per tree, and nothing removes the directory
 * a fixture repository's locks were written to. Measured on 2026-11-14 with
 * `XDG_STATE_HOME` pointed at an empty directory: one run of the default suite
 * left 64 lock directories there, every one naming a tree under the OS
 * temporary directory. TL-432 had closed the same leak only for the tests that
 * start a server.
 *
 * THE FIX IT GUARDS. `fixtureDir` (./_fixture-dir.mjs) points
 * `BACKLOG_STATE_DIR` at a directory of its own the first time a process makes
 * a fixture, and removes it at exit. A command the test starts with the
 * process environment locks there; a command handed an environment built from
 * scratch has to carry the variable itself.
 *
 * HOW. A file cannot observe what the rest of the suite leaves behind, so each
 * case runs a child `node --test` with `HOME` and `XDG_STATE_HOME` pointed at
 * a guarded directory and `BACKLOG_STATE_DIR` removed — the developer's
 * environment, moved somewhere this file can read — and then lists the locks
 * under it that name a tree under the temporary directory. One case runs a
 * test file of the suite that leaked before the fix, so the guard is about the
 * suite and not only about a child written for it.
 *
 * POSITIVE CONTROL. A child that hands the CLI an environment without the
 * variable DOES leave a lock in the guarded directory; without it, an empty
 * guarded directory is also what a scan of the wrong path reports.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { fixtureDir } from "./_fixture-dir.mjs";
import { SCRIPTS_DIR, isolateHome } from "./_repo.mjs";
import { STATE_DIR_ENV, stateRoot } from "../lock.mjs";

isolateHome("suite-state-leak");

const TESTS_DIR = join(SCRIPTS_DIR, "tests");
const CLI = join(SCRIPTS_DIR, "cli.mjs");
const HELPER = pathToFileURL(join(TESTS_DIR, "_fixture-dir.mjs")).href;
const STATE_DIRNAME = basename(stateRoot({ XDG_STATE_HOME: "/x" }));

/** Every spelling of the temporary directory a lock's `origin` may carry. */
function tmpRoots() {
  const roots = new Set([tmpdir()]);
  try { roots.add(realpathSync(tmpdir())); } catch { /* the plain spelling is still checked */ }
  return [...roots].map((r) => (r.endsWith(sep) ? r : r + sep));
}

/**
 * The lock directories under `root` whose `origin` names a tree under the
 * temporary directory — what a fixture leaves behind.
 */
export function fixtureLocks(root, roots = tmpRoots()) {
  const locks = join(root, "locks");
  if (!existsSync(locks)) return [];
  return readdirSync(locks).flatMap((key) => {
    let origin;
    try { origin = readFileSync(join(locks, key, "origin"), "utf8").trim(); } catch { return []; }
    return roots.some((r) => origin.startsWith(r)) ? [origin] : [];
  });
}

/**
 * Run `source` as a test file under a guarded home and state directory, and
 * return what it left there. Both default locations are read: the XDG one the
 * environment names, and the one under `HOME` a child that drops
 * `XDG_STATE_HOME` would fall back to.
 */
function runGuarded(args, source) {
  const guard = fixtureDir(join(tmpdir(), "branchling-state-leak-guard-"));
  const home = join(guard, "home");
  const xdg = join(guard, "xdg");
  mkdirSync(home);
  mkdirSync(xdg);
  if (source !== undefined) {
    const file = join(guard, "child.test.mjs");
    writeFileSync(file, source, "utf8");
    args = [file];
  }
  const env = { ...process.env, HOME: home, XDG_STATE_HOME: xdg, NO_COLOR: "1" };
  delete env[STATE_DIR_ENV];
  // An inherited marker would make the child report upwards instead of running.
  delete env.NODE_TEST_CONTEXT;
  delete env.FORCE_COLOR;
  delete env.NODE_OPTIONS;
  const r = spawnSync(process.execPath, ["--test", ...args], { encoding: "utf8", env, timeout: 300_000 });
  const left = [
    ...fixtureLocks(join(xdg, STATE_DIRNAME)),
    ...fixtureLocks(join(home, ".local", "state", STATE_DIRNAME)),
  ];
  return { status: r.status, output: (r.stdout || "") + (r.stderr || ""), left };
}

/** A child that makes a fixture backlog and takes a task in it through the CLI. */
function writerChild(envExpression) {
  return `import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureDir } from ${JSON.stringify(HELPER)};

const CLI = ${JSON.stringify(CLI)};
test("takes a task", () => {
  const dir = fixtureDir(join(tmpdir(), "branchling-state-leak-child-"));
  const env = ${envExpression};
  for (const args of [["init", "--dir", dir, "--no-example"], ["new", "--dir", dir, "--title", "A task"],
    ["take", "TASK-1", "--dir", dir, "--actor", "agent:state-leak"]]) {
    const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  }
  // The take did lock SOMEWHERE: without this, a CLI that stopped locking
  // would leave the guarded directory empty for the wrong reason.
  const own = process.env.${STATE_DIR_ENV};
  if (own && env.${STATE_DIR_ENV} === own) {
    assert.ok(existsSync(join(own, "locks")) && readdirSync(join(own, "locks")).length > 0,
      "the take left no lock in the fixture's own state directory");
  }
});
`;
}

test("a CLI spawned with the test's environment locks in the fixture's state, not the developer's", () => {
  const r = runGuarded(null, writerChild("{ ...process.env, NO_COLOR: \"1\" }"));
  assert.equal(r.status, 0, r.output);
  assert.deepEqual(r.left, [], "locks naming fixture trees were left in the guarded state directory");
});

test("positive control: a CLI handed an environment without the variable is detected", () => {
  const r = runGuarded(null, writerChild(
    `(() => { const e = { ...process.env, NO_COLOR: "1" }; delete e.${STATE_DIR_ENV}; return e; })()`));
  assert.equal(r.status, 0, r.output);
  assert.equal(r.left.length, 1, "the deliberate write was not seen in the guarded state directory: " + r.output);
});

test("a test file of the suite that leaked before the fix leaves nothing", () => {
  // It spawns the CLI with `process.env` against fixtures it makes through
  // `fixtureDir`, and never states a state directory: the lock is a side
  // effect of what it tests. Run under this guard with the helper as it was
  // before TL-735, this case fails; that measurement is what chose the file.
  const r = runGuarded([join(TESTS_DIR, "manual-refusal-residue.test.mjs")]);
  assert.equal(r.status, 0, r.output);
  assert.deepEqual(r.left, []);
});
