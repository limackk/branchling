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
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { STATE_DIR_ENV } from "../lock.mjs";

const created = new Set();
let hooked = false;

function removeAll() {
  for (const dir of created) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // An exit hook that throws would replace the suite's own exit status
      // with this one, and a fixture that cannot be removed is not a failure
      // of the test that made it.
    }
  }
  created.clear();
}

/**
 * `mkdtempSync(prefix, options)`, and the directory is removed when this
 * process exits. A test that removes it earlier still may; removal is
 * idempotent.
 */
export function fixtureDir(prefix, options) {
  const dir = track(mkdtempSync(prefix, options));
  isolateFixtureState();
  return dir;
}

function track(dir) {
  created.add(dir);
  if (!hooked) {
    hooked = true;
    process.once("exit", removeAll);
  }
  return dir;
}

/**
 * Point this process, and every child that inherits its environment, at a
 * throwaway state directory — once, and only when nothing has chosen one yet.
 */
export function isolateFixtureState(env = process.env) {
  if (env[STATE_DIR_ENV]) return env[STATE_DIR_ENV];
  env[STATE_DIR_ENV] = track(mkdtempSync(join(tmpdir(), "branchling-test-fixture-state-")));
  return env[STATE_DIR_ENV];
}
