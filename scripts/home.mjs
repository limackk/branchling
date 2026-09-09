#!/usr/bin/env node
/**
 * The user's home directory: where the tool keeps facts about the PERSON (TL-34).
 *
 * WHY THIS EXISTS AT ALL. Until now there was not one `homedir()` in the module
 * — everything lived in the repository, which was right (the code knows the
 * shape, `config.yaml` knows the values) and left three things with nowhere to
 * live: who you are, what your machine prefers, and the fact that there can be
 * more than one project.
 *
 * THE BOUNDARY IS DISJOINT, NOT PRIORITISED, and this is the whole risk of the
 * feature — Law 3, §3 of docs/branchling-global-tool.md (product-name: allow)
 * Two layers that may both speak about the same thing
 * WILL drift. So the user layer may not override the project's vocabulary — not
 * "does not by default", may not: `statuses` in a user file FAILS, and the
 * message says which file it belongs in. If it could override, two people would
 * see different boards for the same repository, which is precisely the single
 * truth the vocabulary was moved into `config.yaml` to create.
 *
 * CONFIG AND DATA ARE SEPARATE DIRECTORIES (§5), and that is contract rather
 * than tidiness: preferences are a file a human edits and backs up, while the
 * activity log is machine data nobody wants sitting among their dotfiles — and
 * the two want opposite answers to "should this be synced between machines".
 *
 * WHY THE DIRECTORY NAME IS THE FROZEN MARKER AND NOT `PRODUCT_NAME`. It is a
 * path on disk holding a user's own files, so it is an ON-DISK KEY, exactly
 * like the lock directory and the block marker in somebody's `.gitignore`.
 * Derived from the display name, a rename would silently move a person's
 * preferences to a directory the tool then reports as empty — and their old one
 * would still be there, unreadable by anything. Display text may change; a key
 * that identifies existing data may not.
 *
 * Tests: `node --test scripts/tests/home.test.mjs`
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { BLOCK_MARKER_NAME } from "./product.mjs";
import { stripComment, unquote } from "./task-fields.mjs";

/** The directory name, in ONE place. See the header for why it is the frozen
 *  marker rather than the display name. */
const HOME_DIRNAME = BLOCK_MARKER_NAME;

/**
 * The explicit override, and the test hook the rest of this file is exercised
 * through. Named after the PRODUCT rather than after the data, unlike
 * `BACKLOG_DIR`: this directory holds the tool's own state about a person, and
 * it exists whether or not there is a backlog anywhere.
 *
 * SPELLED OUT RATHER THAN BUILT FROM `PRODUCT_NAME`, for the reason
 * `BLOCK_MARKER_NAME` is: an environment variable is a name a user types into
 * their shell profile and a CI file, so it is a KEY and not display text.
 * Derived from the display name it would stop working on a rename, in files we
 * cannot reach to fix — and it would stop working silently, by falling back to
 * the default directory.
 */
export const HOME_ENV = "BRANCHLING_HOME";  // product-name: allow

export const CONFIG_FILENAME = "config.yaml";
/** Local execution profiles. This is a user-owned file, never project data. */
export const AGENT_PROFILES_FILENAME = "agent-profiles.yaml";
/** Named local compositions of existing profiles, never repository data. */

/**
 * Where the home directory is, without touching the disk. PURE.
 *
 * The order is §5's, from the most explicit to the most implicit, and each
 * source is NAMED in the answer — `where` prints it, because "which of the four
 * rules produced this path" is a question a person asks exactly once and cannot
 * otherwise answer without reading the code.
 *
 * `home` COLLAPSES ONTO `config` WHEN THE TWO ARE SPLIT, and that is worth
 * saying out loud rather than leaving to be discovered: under XDG and under the
 * platform defaults there IS no single root the other two derive from, so the
 * one a person edits is reported as the home. Only an explicit
 * the variable above gives a real root, and then `config` and `data` sit under it.
 *
 * @param {object} env  process.env, injected so a test never touches a real one
 * @param {string} platform  `process.platform`, injected for the same reason:
 *        the Windows branch is the one rule this suite cannot otherwise reach,
 *        and a rule no test can run is a rule nobody has checked.
 * @returns {{home: string, config: string, data: string, source: string}}
 */
export function homePaths(env = process.env, platform = process.platform) {
  const explicit = String(env[HOME_ENV] || "").trim();
  if (explicit) {
    const home = resolve(explicit);
    return { home, config: join(home, "config"), data: join(home, "data"), source: "env" };
  }

  // Windows before XDG: a Windows machine with XDG variables set is somebody
  // who asked for them, and a Windows machine without them has no `~/.config`
  // worth writing into. Roaming holds the preferences a person would want on
  // their other machine; local holds the data they would not.
  const appData = String(env.APPDATA || "").trim();
  if (appData && platform === "win32") {
    const local = String(env.LOCALAPPDATA || "").trim();
    const config = join(resolve(appData), HOME_DIRNAME);
    return {
      home: config,
      config,
      data: local ? join(resolve(local), HOME_DIRNAME) : join(config, "data"),
      source: "appdata",
    };
  }

  const xdgConfig = String(env.XDG_CONFIG_HOME || "").trim();
  const xdgData = String(env.XDG_DATA_HOME || "").trim();
  if (xdgConfig || xdgData) {
    const config = join(xdgConfig ? resolve(xdgConfig) : join(homedir(), ".config"), HOME_DIRNAME);
    const data = join(xdgData ? resolve(xdgData) : join(homedir(), ".local", "share"), HOME_DIRNAME);
    return { home: config, config, data, source: "xdg" };
  }

  const config = join(homedir(), ".config", HOME_DIRNAME);
  const data = join(homedir(), ".local", "share", HOME_DIRNAME);
  return { home: config, config, data, source: "default" };
}

/** The preferences file by path. It does not have to exist. */
export function userConfigPath(env = process.env) {
  return join(homePaths(env).config, CONFIG_FILENAME);
}


/** The provider-neutral profiles a person keeps on this machine. */
export function agentProfilesPath(env = process.env) {
  return join(homePaths(env).config, AGENT_PROFILES_FILENAME);
}

export function agentLaunchesPath(env = process.env) {
  return join(homePaths(env).config, AGENT_LAUNCHES_FILENAME);
}

/** Create the config directory on demand. Only the two commands that WRITE
 *  call this — reading must never create a directory, or `where` would leave a
 *  trail of empty folders on every machine it is run on. */
export function ensureHome(env = process.env) {
  const paths = homePaths(env);
  mkdirSync(paths.config, { recursive: true });
  return paths;
}

/**
 * The keys the user layer may hold, with their defaults.
 *
 * DECLARED AS A WHOLE SET NOW, although only some are read yet — the same
 * reasoning that put the five activity keys into `config.yaml` at once. An
 * unknown key FAILS, so adding them one command at a time would be five schema
 * changes, each of them rejecting a file written for the next.
 *
 * EVERY ONE OF THESE IS A FACT ABOUT A PERSON OR THEIR MACHINE. That is the
 * membership test, and it is the only one: if two people working on the same
 * repository could reasonably disagree about a value and both be right, it
 * belongs here; if their disagreeing would mean one of them is looking at the
 * wrong project, it belongs in `config.yaml`.
 */
export const USER_DEFAULTS = Object.freeze({
  // Who you are, for the history and for `--actor`. The namespace is mandatory
  // here exactly as it is on the flag.
  actor: "",
  // The command used to open a task file. A fact about a machine if ever there
  // was one.
  editor: "",
  // Names that must not appear in this repository's public documents, comma
  // separated — `check --foreign-context` reads them from here (TL-196).
  //
  // WHY THIS LAYER AND NOT THE PROJECT'S config.yaml. A list of names a
  // repository may not contain cannot live inside that repository: writing it
  // down is the disclosure it exists to prevent. It also is not the project's
  // vocabulary — it is a fact about the person running the guard, namely which
  // OTHER repository they also have open. A stranger who clones this gets an
  // empty list, which is the right answer for them: they have nothing to leak.
  foreign_context_words: "",
  // The viewer's appearance: `auto` follows the browser, the other two do not.
  theme: "auto",
  // The port the viewer prefers. Two people on one repository disagreeing about
  // this is normal; both are right.
  port: 4321,
  // How dates are rendered for a reader. `iso` is unambiguous everywhere and is
  // what the files themselves use; `local` follows the machine's locale.
  date_format: "iso",
  // ── The model that turns prose into a plan (TL-95) ──────────────────────
  // ALL FOUR ARE FACTS ABOUT A MACHINE, and that is why they are here rather
  // than in a project's config.yaml: two people working on one repository can
  // reasonably run a local model and a hosted one and both be right. A URL or a
  // model name written into the code would be this tool deciding whose machine
  // everybody has.
  //
  // Declared as a set now for the reason the block above gives: an unknown key
  // fails, so adding them one at a time would reject a file written for the next.
  //
  // Empty means "not configured", and the command says so with instructions
  // rather than falling back to somebody's default endpoint.
  llm_endpoint: "",
  // The model name as that endpoint spells it. There is no default: a wrong
  // guess here fails at the network with somebody else's error message.
  llm_model: "",
  // How many times the adapter may hand a REJECTED plan back to the model with
  // the errors attached. Zero means one attempt and no retry. It never fixes a
  // plan itself — see the adapter's header for why that would be the worst of
  // the three options.
  llm_retries: 2,
  // How long to wait for one answer, in seconds. A model on a laptop is slow in
  // a way a hosted one is not, so this is a fact about the machine too.
  llm_timeout_seconds: 120,
});

export const USER_KEYS = Object.keys(USER_DEFAULTS);

const USER_NUMBER_KEYS = new Set(["port", "llm_retries", "llm_timeout_seconds"]);
const USER_ENUMS = { theme: ["auto", "light", "dark"], date_format: ["iso", "local"] };

/**
 * Read the preferences file. PURE — it is handed the text.
 *
 * A KEY THAT BELONGS TO THE OTHER LAYER GETS A DIAGNOSIS, NOT A LABEL. "Unknown
 * key `statuses`" is true and useless: the person did not misspell anything,
 * they put a real key in the wrong file, and the message that helps says which
 * file. `projectKeys` is injected so this module keeps no dependency on
 * `config.mjs` — the two layers must not be able to reach into each other, and
 * an import is a reach.
 *
 * @returns {{values: object, problems: string[]}}
 */
export function parseUserConfig(text, projectKeys = []) {
  const values = {};
  const problems = [];
  const lines = String(text || "").split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const raw = stripComment(lines[i]);
    if (!raw.trim()) continue;
    if (/^\s/.test(raw)) {
      problems.push(`line ${i + 1}: indented value — every user preference is a single scalar`);
      continue;
    }
    const m = raw.match(/^([a-z_][a-z0-9_]*):\s*(.*)$/);
    if (!m) {
      problems.push(`line ${i + 1}: cannot read \`${raw.trim()}\` (expecting \`key: value\`)`);
      continue;
    }
    const key = m[1];
    const value = unquote(m[2]);

    if (USER_KEYS.indexOf(key) < 0) {
      problems.push(projectKeys.indexOf(key) >= 0
        ? `line ${i + 1}: \`${key}\` is the PROJECT's vocabulary and belongs in the backlog's ` +
          `config.yaml, not here — the user layer may not override it, because then two ` +
          `people would see different values for the same repository`
        : `line ${i + 1}: unknown user preference \`${key}\` (allowed: ${USER_KEYS.join(", ")})`);
      continue;
    }

    if (USER_NUMBER_KEYS.has(key)) {
      const n = Number(value);
      if (!Number.isFinite(n)) { problems.push(`${key}: \`${value}\` is not a number`); continue; }
      values[key] = n;
      continue;
    }
    if (USER_ENUMS[key] && value && USER_ENUMS[key].indexOf(value) < 0) {
      problems.push(`${key}: \`${value}\` is not one of ${USER_ENUMS[key].join(", ")}`);
      continue;
    }
    if (key === "actor" && value && !/^(local|agent|user):.+/.test(value)) {
      problems.push("actor: `" + value + "` has no namespace — one of `local:`, `agent:` or `user:`");
      continue;
    }
    values[key] = value;
  }

  return { values, problems };
}

/**
 * The preferences on this machine, or the defaults. Reads the disk.
 *
 * A MISSING FILE IS THE NORMAL CASE and is not an error: nobody has to create
 * anything for the tool to work.
 * A file that exists and is WRONG is a different matter and throws — a
 * preference silently ignored is indistinguishable from one that had no effect.
 *
 * @returns {{values: object, path: string, exists: boolean, problems: string[]}}
 */
export function loadUserConfig(env = process.env, projectKeys = []) {
  const path = userConfigPath(env);
  if (!existsSync(path)) {
    return { values: { ...USER_DEFAULTS }, path, exists: false, problems: [] };
  }
  const { values, problems } = parseUserConfig(readFileSync(path, "utf8"), projectKeys);
  return { values: { ...USER_DEFAULTS, ...values }, path, exists: true, problems };
}
