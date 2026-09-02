/**
 * Where is THIS repository, and where is ITS backlog? (BL-1448)
 *
 * WHY THIS FILE EXISTS. Five test files used to compute the backlog directory
 * by walking two levels up from themselves — the repository root. That is
 * co-location, and it holds only where the code sits DIRECTLY ABOVE the data,
 * which was true of
 * the repository this tool grew up in and is not true here (code in `scripts/`,
 * data in `backlog/`). It is the same defect BL-1445 fixed in build-backlog.mjs
 * and cli.mjs: a shortcut that stays silent about being an assumption.
 *
 * WHY NOT `resolveBacklogDir()` DIRECTLY. Its third source is discovery upward
 * from the CURRENT WORKING DIRECTORY, so a suite run from elsewhere would judge
 * a different repository's backlog and still look green. A test that asks about
 * "the real tree" has to mean THIS checkout, whatever the cwd — so the search
 * starts from this file's own location, not from cwd.
 *
 * WHAT IT DELIBERATELY KEEPS. Both layouts resolve: `<repo>/backlog` (this
 * repository) and `<repo>` itself (a co-located consumer). The tool supports
 * both, so its own tests must not hard-code either.
 */
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { HOME_ENV } from "../home.mjs";
import { looksLikeBacklogDir } from "../paths.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** `<repo>/scripts` — where the tool's code lives. */
export const SCRIPTS_DIR = join(HERE, "..");

/** `<repo>` — the checkout root. This one IS a fact about file layout. */
export const REPO_ROOT = join(SCRIPTS_DIR, "..");

/**
 * This repository's own backlog directory.
 *
 * Order is deliberate: the nested layout is checked FIRST. In a co-located
 * checkout both candidates can look valid at once, and `<repo>/backlog` is the
 * more specific answer — preferring the root would silently pick a parent that
 * merely happens to contain a `tasks/`.
 */
function findOwnBacklog() {
  for (const candidate of [join(REPO_ROOT, "backlog"), REPO_ROOT]) {
    if (looksLikeBacklogDir(candidate, existsSync)) return candidate;
  }
  throw new Error(
    "I did not find this repository's backlog — checked: " +
      [join(REPO_ROOT, "backlog"), REPO_ROOT].join(", ") + "\n" +
      "The tests about the real tree have nothing to ask. That is a failure of the " +
      "measurement, not a passing test — which is why this throws instead of returning null."
  );
}

export const BACKLOG_DIR = findOwnBacklog();

/** `<backlog>/tasks` — the only source of truth about tasks. */
export const TASKS_DIR = join(BACKLOG_DIR, "tasks");


/**
 * Point THIS TEST PROCESS at a throwaway home directory, and return it.
 *
 * WHY IT MUTATES `process.env` INSTEAD OF THREADING AN ARGUMENT. Since TL-35
 * the raw activity log lives in the user's DATA directory, and the functions
 * that write it take `env` with `process.env` as the default — which is right
 * for the tool and dangerous for a suite: one call that forgets to pass an env
 * writes a test's fixture rows into the machine's real log, where they are
 * indistinguishable from somebody's actual working calendar. Setting the
 * variable for the whole process closes that hole for every call, including the
 * ones a future test has not written yet.
 *
 * It also reaches spawned commands, because every `cli()` helper here spreads
 * `process.env` — so the in-process and out-of-process halves of a test agree
 * on where the data is, which they otherwise would not.
 *
 * Call it once, at the top of a test file that touches activity.
 */
export function isolateHome(label = "home") {
  const dir = mkdtempSync(join(tmpdir(), "worktrail-test-" + label + "-"));
  process.env[HOME_ENV] = dir;
  return dir;
}
