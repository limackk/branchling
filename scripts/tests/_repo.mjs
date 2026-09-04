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
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { HOME_ENV } from "../home.mjs";
import { loadConfig } from "../config.mjs";
import { templateDrift } from "../new-task.mjs";
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
/**
 * Assert against PLAIN text, whatever terminal the suite is run from (TL-238).
 *
 * WHY A DECLARATION AND NOT A STRIP. `colourAllowed()` reads `NO_COLOR`, then
 * `FORCE_COLOR`, then `isTTY`, and it is right to. A test that asserts on
 * human-facing output without saying which of those it means inherits the
 * observer: an agent runs the suite through a pipe and sees green, a person runs
 * it in a terminal and sees twelve failures. Measured on 2026-09-04, exactly
 * that way round. Stripping escapes at each assertion would fix the twelve and
 * leave the thirteenth free to inherit again.
 *
 * IT COVERS SUBPROCESSES TOO, and that is why it writes the environment rather
 * than a module flag: a spawned `cli.mjs` inherits `process.env`, so one call
 * settles the renderers this process calls AND the commands it starts.
 *
 * A test about COLOUR ITSELF must not call this — it has to state its own
 * expectation per case, which is the same rule seen from the other side.
 */
export function plainOutput() {
  process.env.NO_COLOR = "1";
}

export function isolateHome(label = "home") {
  const dir = mkdtempSync(join(tmpdir(), "branchling-test-" + label + "-"));
  process.env[HOME_ENV] = dir;
  isolateGit(dir);
  return dir;
}

/**
 * Point every `git` this process spawns at an EMPTY configuration (TL-174).
 *
 * THE SAME DEFECT AS THE HOME, ONE LAYER DOWN. `isolateHome` exists so the suite
 * answers the same on every machine; git's own configuration was never isolated,
 * so it did not. Measured on 2026-09-02: a global `commit.gpgsign=true` with an
 * ssh agent that declines to sign turned twelve tests in `activity.test.mjs` red
 * at the line that BUILDS the fixture — reported as `128 !== 0`, which names
 * none of the reasons that were true.
 *
 * BY ENVIRONMENT, NOT BY FLAGS ON EVERY CALL. Eight of the twenty test files
 * that shell out to git passed `-c commit.gpgsign=false` and the rest did not,
 * which is what an unenforced convention looks like — and even complete, that
 * convention would only cover signing. `GIT_CONFIG_GLOBAL` and
 * `GIT_CONFIG_SYSTEM` neutralise the WHOLE of the developer's configuration:
 * aliases, `core.hooksPath`, `init.defaultBranch`, a `commit.template`, and
 * whatever the next machine turns out to carry. It also reaches git processes
 * the TOOL spawns, which no flag in a test file ever could.
 *
 * IT DOES NOT TOUCH THE USER'S CONFIGURATION. Nothing is written outside the
 * throwaway home; signing stays on for their own commits, which is the point —
 * a fixture repository simply has no reason to be signed.
 *
 * The identity comes from `GIT_AUTHOR_*`/`GIT_COMMITTER_*` rather than from a
 * written config, because with the global file empty there is no identity at
 * all and every commit would fail for a second, unrelated reason.
 */
export function isolateGit(homeDir) {
  const config = join(homeDir, "gitconfig");
  writeFileSync(config, "", "utf8");
  Object.assign(process.env, {
    GIT_CONFIG_GLOBAL: config,
    GIT_CONFIG_SYSTEM: config,
    GIT_AUTHOR_NAME: "branchling tests",
    GIT_AUTHOR_EMAIL: "tests@example.invalid",
    GIT_COMMITTER_NAME: "branchling tests",
    GIT_COMMITTER_EMAIL: "tests@example.invalid",
    // Stated OUTRIGHT as well as by emptying the config, so the intent survives
    // somebody later pointing GIT_CONFIG_GLOBAL at a file with content in it.
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "commit.gpgsign",
    GIT_CONFIG_VALUE_0: "false",
    // A fixture must not depend on the machine's default branch name either —
    // the same class of dependency, and it would have been the next one found.
    GIT_CONFIG_KEY_1: "init.defaultBranch",
    GIT_CONFIG_VALUE_1: "main",
  });
  return config;
}


/**
 * Move a fixture's `_template.md` onto the vocabulary its `config.yaml` declares.
 *
 * WHY EVERY FIXTURE THAT REWRITES A VOCABULARY NEEDS THIS (TL-69). `init`
 * writes a template carrying the DEFAULT values, and a fixture that then
 * replaces `statuses:` has manufactured exactly the drift TL-69 made `new`
 * refuse: the template offers `pending` to a project that has never heard of
 * it. Before TL-69 those fixtures got away with it, and what they were
 * silently testing was the defect.
 *
 * It corrects the template rather than relaxing the rule, because that is what
 * the refusal tells a real user to do — a fixture that reached for an escape
 * hatch would be proving something no user can reproduce.
 *
 * The drift is MEASURED with the tool's own audit, not with a list of fields
 * written here: a field added to the vocabulary later would otherwise start
 * failing in three test files at once, for a reason none of them mentions.
 *
 * Scalar enums only — a list field has no single "first allowed value", and no
 * fixture needs one.
 */
export function alignTemplate(root) {
  const path = join(root, "_template.md");
  let text = readFileSync(path, "utf8");
  for (const d of templateDrift(text, loadConfig(root))) {
    if (!d.allowed.length) continue;
    text = text.replace(new RegExp("^" + d.field + ":.*$", "m"), d.field + ": " + d.allowed[0]);
  }
  writeFileSync(path, text, "utf8");
  return path;
}
