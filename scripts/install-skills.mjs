#!/usr/bin/env node
/**
 * `skills install` — put the agent instructions in the user's repository (TL-54).
 *
 * WHY THIS SHIPS AT ALL. The tool competes for a developer's attention with
 * trackers that have whole companies behind them, and the one argument it has
 * that they do not is: install it, say "start TL-1234", and the agent already
 * knows what to do. That argument cannot be made if every user first has to
 * write their own instructions — so the instructions travel in the package.
 *
 * WHAT TRAVELS, AND WHAT DOES NOT. Only `backlog-workflow`. The other skills in
 * this repository are for developing the TOOL — its CLI surface, its viewer, its
 * release gate — and shipping them would put this project's development
 * procedure into somebody else's editor, where it is noise at best.
 *
 * THE SKILL HOLDS NO VOCABULARY AND NO PROCEDURE, and that is the whole design
 * rather than an omission. It says to run `instructions overview` and
 * stops. A skill that listed statuses would be a second truth about a
 * vocabulary that belongs to `config.yaml` (Law 3), and it would be wrong the
 * moment a project renamed one; a skill that carried the procedure would freeze
 * on the day it was written and then describe flags the tool no longer has.
 * Both failures are the same shape: still specific, still confident, no longer
 * true.
 *
 * WRITING IS EXPLICIT AND NEVER OVERWRITES. `.claude/` is the user's own
 * directory and may already hold their version of this file. Writing there
 * unasked is a surprise; writing OVER something is worse than a surprise. So it
 * takes a flag, it skips what exists, and it says what it skipped — the same
 * contract `init` holds to for every file it creates.
 *
 * REFRESHING IS A SECOND, NAMED ACT (TL-585). Never overwriting has a cost: the
 * skill's DESCRIPTION is what decides whether an editor loads it at all, and a
 * copy that is never replaced freezes that description on the day of the
 * install. The procedure stays current regardless — it lives in `instructions`
 * — but an improved trigger would reach nobody who upgrades. `--refresh` closes
 * that gap without reopening the first one: it replaces a file only when the
 * file is byte-for-byte a version this package once shipped (so nobody's edit
 * can be in it), or when the user names that file on the command line. A file
 * that matches no shipped version is the user's until they say otherwise, and
 * the refresh says that it left it alone and how to replace it.
 *
 * Exit: 0 installed or nothing to do · 1 the source is missing · 2 a usage
 * error, including a named file the package does not ship.
 *
 * Tests: `node --test scripts/tests/skills-install.test.mjs`
 */

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { repositoryRoot, BACKLOG_DIR_REFUSAL_EXIT, isBacklogDirRefusal, resolveBacklogDir, takeDirFlag } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { MARK, color, failure, refusal } from "./ui.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Where the packaged skills live inside the installation. One directory, and
 *  it is the SAME one this repository's own `.claude/skills/` points at through
 *  a symlink — two copies of one skill is the defect this project has been
 *  paying for since the vocabularies were split out. */
export const PACKAGED_SKILLS = join(HERE, "..", ".agents", "skills");

/** Which skills a USER gets. A closed list rather than "everything in the
 *  directory": the others are about developing this tool. */
export const USER_SKILLS = ["backlog-workflow"];

/** Where they go in somebody else's repository. `.claude/skills/<name>/` is the
 *  convention the editor reads; the repository ROOT is the anchor, because a
 *  skill is a fact about the repository and not about the backlog inside it. */
export function skillsTarget(repoRoot) {
  return join(repoRoot, ".claude", "skills");
}

/**
 * Every version of a packaged file that this package has ever shipped, as the
 * SHA-256 of its content with CRLF read as LF, keyed by its path under the
 * skills directory. A file in a user's repository that matches one of these is
 * known to carry no edit of theirs, so `--refresh` may replace it unasked.
 *
 * A HAND-KEPT LIST, BECAUSE AN INSTALLATION HAS NO GIT HISTORY. The versions
 * could be read out of `git log` here, but a user runs this from a tarball. The
 * current packaged content MUST be on the list, so that the NEXT release still
 * recognises it as shipped; `skills-install.test.mjs` fails with the line to
 * add when it is not.
 */
export const SHIPPED_VERSIONS = {
  "backlog-workflow/SKILL.md": [
    "afe1203969835a456a04760e20b966f47bbb74b14962db298fb6c1fc1ee28702", // 2026-08-30, before the rename
    "f52e6b78cb0e44f6416c82f1cc0484382a2231dd08a542ed8b8ca0de347b2761", // 2026-09-03, TL-20
    "8c871371c6e6d86d9efcb0276b7850dbd71f28e24af4d416916254aef389cfd3", // 2026-11-06, the description states what the skill does
  ],
};

/** The hash `SHIPPED_VERSIONS` is written in. Line endings are normalised so a
 *  checkout with `core.autocrlf` does not turn a shipped copy into an "edit". */
export function contentHash(path) {
  const text = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** A path as `SHIPPED_VERSIONS` and the command line spell it, on any platform. */
function posix(path) {
  return path.split(sep).join("/");
}

/** One order on every platform: `readdirSync` returns the filesystem's own,
 *  which NTFS sorts case-insensitively and APFS does not, so the same skill
 *  listed its files differently in doctor's rows and in a refusal (TL-624). */
function byName(a, b) {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

function filesUnder(dir, base = dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort(byName)) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() || (entry.isSymbolicLink() && statSync(path).isDirectory())) {
      filesUnder(path, base, out);
    } else {
      out.push(relative(base, path));
    }
  }
  return out;
}

/**
 * How each installed packaged file compares with the one this installation
 * ships. Only PACKAGED paths are examined — a file the user added beside the
 * skill is not ours to judge, let alone to replace.
 *
 *   missing  not installed
 *   current  identical to the packaged file
 *   shipped  identical to an OLDER shipped version: safe to refresh
 *   edited   matches no shipped version: presumed to be the user's edit
 *   blocked  something that is not a regular file (a directory, a socket)
 *            stands at the path: it cannot be read, compared or replaced
 *
 * BLOCKED IS A STATE, NOT AN EXCEPTION (TL-594). Hashing a directory throws
 * EISDIR, and an uncaught throw here took `doctor` and `skills install` down
 * together, naming no path. Whatever stands there is the user's, and removing
 * it is not ours to do — so both commands name it and leave it alone.
 *
 * @returns {{ok: boolean, files: {file: string, state: string}[], target: string}}
 */
export function compareInstalled(repoRoot, opts = {}) {
  const source = opts.source || PACKAGED_SKILLS;
  const wanted = opts.skills || USER_SKILLS;
  const shipped = opts.shipped || SHIPPED_VERSIONS;
  const target = skillsTarget(repoRoot);
  if (!existsSync(source)) {
    return {
      ok: false, kind: "no-source", target, files: [],
      message: "the packaged skills are not in this installation: " + source,
      details: ["A tarball built without `skills/` in `files` produces exactly this."],
    };
  }
  const files = [];
  for (const name of wanted) {
    const from = join(source, name);
    if (!existsSync(from)) {
      return { ok: false, kind: "no-skill", target, files, message: "no packaged skill called `" + name + "` in " + source };
    }
    for (const file of filesUnder(from)) {
      const key = join(name, file);
      const installed = join(target, key);
      let state;
      if (!existsSync(installed)) state = "missing";
      else if (!statSync(installed).isFile()) state = "blocked";
      else {
        const hash = contentHash(installed);
        if (hash === contentHash(join(from, file))) state = "current";
        else if ((shipped[posix(key)] || []).includes(hash)) state = "shipped";
        else state = "edited";
      }
      // The name the package, SHIPPED_VERSIONS and `--refresh <file>` all use,
      // on every platform: a `\` here reached doctor's rows on Windows (TL-624).
      files.push({ file: posix(key), state });
    }
  }
  return { ok: true, files, target };
}

/**
 * Copy the user-facing skills into a repository.
 *
 * @param {string} repoRoot  the repository the skills are for
 * @param {{source?: string, skills?: string[], dryRun?: boolean, refresh?: boolean,
 *          named?: string[], shipped?: object}} opts
 *   `refresh` replaces files that are an older shipped version; `named` (with
 *   `refresh`) also replaces those files whatever they hold.
 * @returns {{ok: boolean, created: string[], skipped: string[], replaced: string[],
 *            kept: string[], blocked: string[], target: string}}
 */
export function installSkills(repoRoot, opts = {}) {
  const source = opts.source || PACKAGED_SKILLS;
  const named = (opts.named || []).map(posix);
  const state = compareInstalled(repoRoot, opts);
  const target = state.target;
  if (!state.ok) return { ...state, created: [], skipped: [], replaced: [], kept: [], blocked: [] };

  const known = state.files.map((f) => posix(f.file));
  const unknownName = named.find((f) => !known.includes(f));
  if (unknownName !== undefined) {
    return {
      ok: false, kind: "unknown-file", target, created: [], skipped: [], replaced: [], kept: [], blocked: [],
      message: "`" + unknownName + "` is not a packaged skill file",
      details: ["Name a path under " + target + " as the package ships it: " + known.join(", ")],
    };
  }

  const created = [];
  const skipped = [];
  const replaced = [];
  const kept = [];
  const blocked = [];
  for (const { file, state: now } of state.files) {
    const write = () => {
      if (opts.dryRun) return;
      const destination = join(target, file);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(join(source, file), destination);
    };
    if (now === "missing") { write(); created.push(file); continue; }
    // Not even when named: naming a file says "discard what it holds", and a
    // directory holds files nobody named.
    if (now === "blocked") { blocked.push(file); continue; }
    // SKIPPED, NEVER OVERWRITTEN, unless the refresh can prove the file holds
    // no edit or the user named it. The file may be the user's own edit of this
    // very skill, and replacing it silently would take back a decision they
    // made in their own repository.
    if (!opts.refresh || now === "current") { skipped.push(file); continue; }
    if (now === "shipped" || named.includes(posix(file))) { write(); replaced.push(file); continue; }
    kept.push(file);
  }
  return { ok: true, created, skipped, replaced, kept, blocked, target, dryRun: Boolean(opts.dryRun) };
}

/** The lines `init` prints when it installs them, so the two commands say the
 *  same thing about the same act. */
export function renderInstall(result, opts = {}) {
  const paint = opts.color || color;
  const out = [];
  if (result.created.length) {
    out.push(paint.ok(MARK.ok) + " skills: " + result.created.length + " file(s) → " + result.target);
    for (const file of result.created) out.push("    " + file);
  }
  if (result.replaced.length) {
    out.push(paint.ok(MARK.ok) + " refreshed: " + result.replaced.length + " file(s) → " + result.target);
    for (const file of result.replaced) out.push("    " + file);
  }
  if (result.skipped.length) {
    out.push(paint.dim(MARK.bullet + " skipped (already there, left alone): " + result.skipped.join(", ")));
  }
  if (result.kept.length) {
    out.push(paint.warn(MARK.warn) + " kept (matches no shipped version — your edit?): " + result.kept.join(", "));
    out.push("  " + paint.dim("To replace it anyway, discarding what it holds, name it:"));
    out.push("  " + paint.dim("`" + N + " skills install --refresh " + result.kept.join(" ") + "`"));
  }
  const blocked = result.blocked || [];
  if (blocked.length) {
    out.push(paint.warn(MARK.warn) + " not a file, left alone: " + blocked.join(", "));
    out.push("  " + paint.dim("Something other than a file stands at that path, so the editor cannot read it."));
    out.push("  " + paint.dim("Move it aside, then run `" + N + " skills install` again."));
  }
  if (!result.created.length && !result.skipped.length && !result.replaced.length && !result.kept.length && !blocked.length) {
    out.push(paint.dim(MARK.bullet + " skills: nothing to install"));
  }
  if (result.created.length) {
    out.push("  " + paint.dim("The skill holds no procedure and no vocabulary — it tells an agent to run"));
    out.push("  " + paint.dim("`" + N + " instructions overview`, which is rendered with YOUR config.yaml."));
  }
  return out.join("\n");
}

const KNOWN_FLAGS = ["--dry-run", "--json", "--dir", "--refresh"];

export function main(argv) {
  const sub = argv[0];
  if (sub !== "install") {
    console.error(refusal(N + " skills", sub ? "unknown subcommand: " + sub : "no subcommand", "install"));
    return 2;
  }
  const cli = takeDirFlag(argv.slice(1));
  const refresh = cli.argv.includes("--refresh");
  const unknown = cli.argv.filter((a) => !KNOWN_FLAGS.includes(a) && (a.startsWith("-") || !refresh));
  if (unknown.length) {
    const problem = unknown[0].startsWith("-") ? "unknown flag: " : "unexpected argument: ";
    console.error(refusal(N + " skills install", problem + unknown.join(" "), KNOWN_FLAGS.join(" ") + " [<file>...]"));
    return 2;
  }
  // A file argument means "replace this one whatever it holds", which only
  // makes sense as part of a refresh — without one it is refused above.
  const named = cli.argv.filter((a) => !a.startsWith("-"));

  let backlog;
  try {
    backlog = resolveBacklogDir({ dir: cli.dir || undefined, moduleDir: HERE }).root;
  } catch (e) {
    if (!isBacklogDirRefusal(e)) throw e;
    console.error(failure(N + " skills install", e.message, e.details || []));
    return BACKLOG_DIR_REFUSAL_EXIT;
  }

  const result = installSkills(repositoryRoot(backlog), {
    dryRun: cli.argv.includes("--dry-run"),
    refresh,
    named,
  });
  if (!result.ok) {
    console.error(failure(N + " skills install", result.message, result.details || []));
    return result.kind === "unknown-file" ? 2 : 1;
  }
  if (cli.argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }
  console.log(renderInstall(result));
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("install-skills.mjs")) {
  process.exitCode = main(process.argv.slice(2));
}
