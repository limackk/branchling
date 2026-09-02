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
 * Exit: 0 installed or nothing to do · 1 the source is missing · 2 a usage error.
 *
 * Tests: `node --test scripts/tests/skills-install.test.mjs`
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { repositoryRoot, resolveBacklogDir, takeDirFlag } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { MARK, color, failure } from "./ui.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Where the packaged skills live inside the installation. One directory, and
 *  it is the SAME one this repository's own `.claude/skills/` points at through
 *  a symlink — two copies of one skill is the defect this project has been
 *  paying for since the vocabularies were split out. */
export const PACKAGED_SKILLS = join(HERE, "..", "skills");

/** Which skills a USER gets. A closed list rather than "everything in the
 *  directory": the others are about developing this tool. */
export const USER_SKILLS = ["backlog-workflow"];

/** Where they go in somebody else's repository. `.claude/skills/<name>/` is the
 *  convention the editor reads; the repository ROOT is the anchor, because a
 *  skill is a fact about the repository and not about the backlog inside it. */
export function skillsTarget(repoRoot) {
  return join(repoRoot, ".claude", "skills");
}

function filesUnder(dir, base = dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
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
 * Copy the user-facing skills into a repository.
 *
 * @param {string} repoRoot  the repository the skills are for
 * @param {{source?: string, skills?: string[], dryRun?: boolean}} opts
 * @returns {{ok: boolean, created: string[], skipped: string[], target: string}}
 */
export function installSkills(repoRoot, opts = {}) {
  const source = opts.source || PACKAGED_SKILLS;
  const wanted = opts.skills || USER_SKILLS;
  const target = skillsTarget(repoRoot);

  if (!existsSync(source)) {
    return {
      ok: false, kind: "no-source", target, created: [], skipped: [],
      message: "the packaged skills are not in this installation: " + source,
      details: ["A tarball built without `skills/` in `files` produces exactly this."],
    };
  }

  const created = [];
  const skipped = [];
  for (const name of wanted) {
    const from = join(source, name);
    if (!existsSync(from)) {
      return {
        ok: false, kind: "no-skill", target, created, skipped,
        message: "no packaged skill called `" + name + "` in " + source,
      };
    }
    for (const file of filesUnder(from)) {
      const destination = join(target, name, file);
      // SKIPPED, NEVER OVERWRITTEN. The file may be the user's own edit of this
      // very skill, and replacing it silently would take back a decision they
      // made in their own repository.
      if (existsSync(destination)) { skipped.push(join(name, file)); continue; }
      if (!opts.dryRun) {
        mkdirSync(dirname(destination), { recursive: true });
        copyFileSync(join(from, file), destination);
      }
      created.push(join(name, file));
    }
  }
  return { ok: true, created, skipped, target, dryRun: Boolean(opts.dryRun) };
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
  if (result.skipped.length) {
    out.push(paint.dim(MARK.bullet + " skipped (already there, left alone): " + result.skipped.join(", ")));
  }
  if (!result.created.length && !result.skipped.length) {
    out.push(paint.dim(MARK.bullet + " skills: nothing to install"));
  }
  if (result.created.length) {
    out.push("  " + paint.dim("The skill holds no procedure and no vocabulary — it tells an agent to run"));
    out.push("  " + paint.dim("`" + N + " instructions overview`, which is rendered with YOUR config.yaml."));
  }
  return out.join("\n");
}

const KNOWN_FLAGS = ["--dry-run", "--json", "--dir"];

export function main(argv) {
  const sub = argv[0];
  if (sub !== "install") {
    console.error(failure(N + " skills", sub ? "unknown subcommand: " + sub : "no subcommand",
      ["known: install"], [N + " skills --help"]));
    return 2;
  }
  const cli = takeDirFlag(argv.slice(1));
  const unknown = cli.argv.filter((a) => !KNOWN_FLAGS.includes(a));
  if (unknown.length) {
    console.error(failure(N + " skills install", "unexpected argument: " + unknown.join(" "), [],
      [N + " skills --help"]));
    return 2;
  }

  let backlog;
  try {
    backlog = resolveBacklogDir({ dir: cli.dir || undefined, moduleDir: HERE }).root;
  } catch (e) {
    console.error(failure(N + " skills install", e.message, []));
    return 2;
  }

  const result = installSkills(repositoryRoot(backlog), {
    dryRun: cli.argv.includes("--dry-run"),
  });
  if (!result.ok) {
    console.error(failure(N + " skills install", result.message, result.details || []));
    return 1;
  }
  if (cli.argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }
  console.log(renderInstall(result));
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("install-skills.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
