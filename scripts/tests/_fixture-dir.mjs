/**
 * A temporary directory for a test fixture, removed when the test file ends
 * (TL-575).
 *
 * WHY THIS EXISTS. On 2026-11-05 four parallel loops ran the suite several
 * times per task, and the volume ran out of INODES, not bytes: about 110,000
 * `branchling-*` directories, most of them git repositories, were left at the
 * top of the temporary directory. One further run consumed about 116,000
 * inodes and returned none of them. A test file that called `mkdtempSync` and
 * removed the result only at the end of a passing test — or never — is
 * invisible on one developer run and decisive under a fleet.
 *
 * WHY A PROCESS `exit` HOOK AND NOT `t.after`. `node --test` runs every file
 * in its own process, so the end of the process IS the end of the file's
 * suite, on a pass and on a failure alike. Fixtures are made at module scope,
 * in `before` hooks, inside tests and inside helpers that are handed no test
 * context; node:test's `after` binds to whichever test is current when it is
 * CALLED, so registering it lazily from here would bind the removal of every
 * later directory to the first test that happened to ask. One exit hook does
 * not depend on where it is called from.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It never sweeps the temporary directory by
 * pattern: a concurrent run in another worktree owns directories with the
 * same prefixes, and a sweep would also hide which test leaks. It removes
 * exactly what this process created through it.
 *
 * `scripts/tests/fixture-dir.test.mjs` holds the rule that a test file never
 * calls `mkdtempSync` itself.
 *
 * A FIXTURE TREE'S LOCK STATE IS A FIXTURE TOO (TL-735). `scripts/lock.mjs`
 * keeps reservations in the per-user state directory, keyed by the tree they
 * belong to, and nothing ever removes the directory a fixture repository's
 * locks were written to. Measured on 2026-11-14: one run of the suite left 64
 * of those directories in the developer's real state directory, the one the
 * developer's own sessions read their locks from. The first fixture this
 * process makes therefore also points `BACKLOG_STATE_DIR` at a directory of
 * its own, removed with the rest at exit, so every fixture tree a test makes
 * through here — and every CLI the test spawns with `process.env` — locks
 * there instead. It is done HERE and not in a helper each file has to call,
 * because the leak came from the files for which the lock was a side effect,
 * which are exactly the ones that would not have called it. A variable the
 * test already set (`isolateState`, or the environment the suite was started
 * with) is left alone; `scripts/tests/suite-state-leak.test.mjs` is the guard.
 *
 * A PROCESS STOPPED BY A SIGNAL CLEANS UP TOO, AND ONE THAT CANNOT LEAVES ONE
 * ENTRY (TL-745). Measured on 2026-11-14 after three supervised loops: 393
 * `branchling-*` directories in /tmp, every one made through this helper. A
 * full suite run with a private TMPDIR left none; a test file stopped by
 * SIGTERM, SIGINT, SIGHUP or SIGKILL left every fixture it had made, because
 * Node emits `exit` for none of them. Two measures, one per kind of signal:
 *
 *   - SIGTERM, SIGINT and SIGHUP remove what this process made and are then
 *     raised again with no listener of ours, so the process still ends BY
 *     that signal and whoever stopped it sees the status it expects.
 *   - SIGKILL runs no code at all — the 4 GiB data cap, a Stryker timeout and
 *     `mutation-contain.mjs` reaping its group all end a test that way. A
 *     fixture asked for at the top of the temporary directory is therefore
 *     made inside ONE directory per process, `branchling-test-pid<PID>-*`, so
 *     what a killed process leaves is a single entry that names it, not
 *     hundreds. A prefix anywhere else is honoured as given. Inside a
 *     mutation run that entry goes too: the run gives every test command a
 *     temporary directory of its own and removes it (TL-746,
 *     `privateTmpEnv` in `mutation-run.mjs`).
 *
 * A third path was found by measurement, not by reading: a test file whose
 * RUNNER is killed (a session or a Bash call cut off kills `node --test`, not
 * its children) is orphaned, and its next report to the runner fails with
 * EPIPE on stdout. node:test rethrows that from its own uncaught-exception
 * handler, which ends the process with status 7 and, again, no `exit`. An
 * error on stdout therefore removes the fixtures first and is then thrown on
 * unchanged, so the process ends exactly as it did before.
 *
 * None of these measures sweeps: the per-process directory is still exactly what
 * this process created.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import { STATE_DIR_ENV } from "../lock.mjs";

const created = new Set();
/** The per-process directory made in each temporary directory, by its path. */
const parents = new Map();
let hooked = false;

/** The signals after which code still runs; SIGKILL is handled by `parentIn`. */
const CLEANUP_SIGNALS = ["SIGTERM", "SIGINT", "SIGHUP"];

function remove(dir) {
  try {
    rmSync(dir, { recursive: true, maxRetries: 3 });
  } catch {
    // An exit hook that throws would replace the suite's own exit status
    // with this one, and a fixture that cannot be removed is not a failure
    // of the test that made it.
  }
}

function removeAll() {
  for (const dir of created) remove(dir);
  created.clear();
  // Last, so that a fixture which could not be removed above is retried as
  // part of its parent rather than left with the parent already gone.
  for (const dir of parents.values()) remove(dir);
  parents.clear();
}

function onSignal(signal) {
  removeAll();
  for (const s of CLEANUP_SIGNALS) process.removeListener(s, onSignal);
  // Another listener means somebody else decided what this signal does; with
  // none left, raising it again ends the process the way it was asked to end.
  if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
}

function onStdoutError(err) {
  // Somebody else listening, before or after this listener, means the error
  // is handled and the process goes on; its fixtures are still in use. Only
  // an error nobody else handles was fatal, and throwing it keeps it so.
  if (process.stdout.listenerCount("error") > 1) return;
  removeAll();
  throw err;
}

/** This process's own directory inside `tmp`, made on first use. */
function parentIn(tmp) {
  let dir = parents.get(tmp);
  if (!dir) {
    dir = mkdtempSync(join(tmp, "branchling-test-pid" + process.pid + "-"));
    parents.set(tmp, dir);
  }
  return dir;
}

/** `prefix` moved into this process's directory when it names the top of `tmpdir()`. */
function placed(prefix) {
  const tmp = resolve(tmpdir());
  return resolve(dirname(prefix)) === tmp ? join(parentIn(tmp), basename(prefix)) : prefix;
}

/**
 * `mkdtempSync(prefix, options)`, and the directory is removed when this
 * process exits. A test that removes it earlier still may; removal is
 * idempotent.
 */
export function fixtureDir(prefix, options) {
  const dir = track(mkdtempSync(placed(prefix), options));
  isolateFixtureState();
  return dir;
}

function track(dir) {
  created.add(dir);
  hook();
  return dir;
}

function hook() {
  if (hooked) return;
  hooked = true;
  process.once("exit", removeAll);
  for (const s of CLEANUP_SIGNALS) process.on(s, onSignal);
  process.stdout.on("error", onStdoutError);
}

/**
 * Point this process, and every child that inherits its environment, at a
 * throwaway state directory — once, and only when nothing has chosen one yet.
 */
export function isolateFixtureState(env = process.env) {
  if (env[STATE_DIR_ENV]) return env[STATE_DIR_ENV];
  env[STATE_DIR_ENV] = track(mkdtempSync(placed(join(tmpdir(), "branchling-test-fixture-state-"))));
  return env[STATE_DIR_ENV];
}
