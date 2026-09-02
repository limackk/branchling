/**
 * The agent instructions travel to the user (TL-54).
 *
 * WHAT THIS FILE IS PROTECTING, AND IT IS NOT A COPY OPERATION. Three claims,
 * each of which is easy to break silently:
 *
 *   1. THE SKILL IS IN THE TARBALL. It works in this repository whether or not
 *      `files` carries `skills/`, so nothing here would notice its absence — and
 *      the failure is invisible until somebody installs the package and the one
 *      argument the tool has over a hosted tracker turns out not to ship.
 *   2. NOTHING IS OVERWRITTEN. `.claude/` is the user's own directory and the
 *      file may be their edit of this very skill. Replacing it silently takes
 *      back a decision they made in their own repository, and no error says so.
 *   3. THE SKILL CARRIES NO VOCABULARY. A skill listing statuses is a second
 *      truth about a vocabulary that belongs to `config.yaml` (Law 3), and it is
 *      wrong the moment a project renames one — quietly, in somebody else's
 *      editor, where nobody here will ever see it. That assertion is read out of
 *      the FILE rather than trusted, because it is a promise about content.
 *
 * AND ONE COPY IN THE TREE, NOT TWO. This repository's own `.claude/skills/`
 * points at the packaged directory through a symlink. Two copies of one skill
 * is the defect this project has been paying for since its vocabularies were
 * split out of the code, and it would be worse here: the divergence would be
 * between what this repository's agent reads and what a user's agent reads.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PACKAGED_SKILLS, USER_SKILLS, installSkills, skillsTarget } from "../install-skills.mjs";
import { REPO_ROOT } from "./_repo.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");

let counter = 0;
function tmp(prefix) {
  return mkdtempSync(join(tmpdir(), "worktrail-" + prefix + "-" + (counter++) + "-"));
}

function run(args, cwd, env) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 30_000, input: "", cwd,
    env: env || { ...process.env, NO_COLOR: "1" },
  });
}

function fixture() {
  const dir = tmp("skills");
  const backlog = join(dir, "backlog");
  const env = { ...process.env, NO_COLOR: "1", BACKLOG_STATE_DIR: join(dir, "state") };
  return { dir, backlog, env };
}

const SKILL = join("backlog-workflow", "SKILL.md");

// ── it ships ──────────────────────────────────────────────────────────────

test("the skill is in the tarball", () => {
  // It works in this repository regardless, so nothing else would notice it
  // missing — and the failure is invisible until somebody installs the package.
  const packed = spawnSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000,
  });
  assert.equal(packed.status, 0, packed.stderr);
  const files = JSON.parse(packed.stdout)[0].files.map((f) => f.path);
  assert.ok(files.includes("skills/backlog-workflow/SKILL.md"),
    "the packaged skill is not in `files`:\n  " + files.filter((f) => f.includes("skill")).join("\n  "));
});

test("only the user-facing skill ships — not the ones about developing the tool", () => {
  // `worktrail-cli`, `worktrail-release` and `worktrail-viewer` are this
  // project's own development procedure. In somebody else's editor they are
  // noise at best.
  assert.deepEqual(USER_SKILLS, ["backlog-workflow"]);
  const packed = spawnSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000,
  });
  const shipped = JSON.parse(packed.stdout)[0].files
    .map((f) => f.path).filter((f) => f.startsWith("skills/"));
  for (const path of shipped) {
    assert.ok(USER_SKILLS.some((name) => path.startsWith("skills/" + name + "/")),
      "a skill about developing this tool is in the tarball: " + path);
  }
});

// ── one copy in the tree ──────────────────────────────────────────────────

test("this repository reads the SAME file it ships, through a symlink", () => {
  const linked = join(REPO_ROOT, ".claude", "skills", "backlog-workflow");
  assert.equal(lstatSync(linked).isSymbolicLink(), true,
    "`.claude/skills/backlog-workflow` is a real directory — that is a second copy");
  assert.equal(
    readFileSync(join(linked, "SKILL.md"), "utf8"),
    readFileSync(join(PACKAGED_SKILLS, "backlog-workflow", "SKILL.md"), "utf8")
  );
});

// ── installing ────────────────────────────────────────────────────────────

test("install creates the file in the target repository", () => {
  const fx = fixture();
  const result = installSkills(fx.dir);
  assert.equal(result.ok, true);
  assert.deepEqual(result.created, [SKILL]);
  assert.equal(existsSync(join(fx.dir, ".claude", "skills", SKILL)), true);
  assert.equal(result.target, skillsTarget(fx.dir));
});

test("a second install overwrites nothing and SAYS so", () => {
  const fx = fixture();
  installSkills(fx.dir);

  // The file is now the user's: they edited it.
  const path = join(fx.dir, ".claude", "skills", SKILL);
  writeFileSync(path, "# my own version\n", "utf8");

  const again = installSkills(fx.dir);
  assert.deepEqual(again.created, []);
  assert.deepEqual(again.skipped, [SKILL]);
  assert.equal(readFileSync(path, "utf8"), "# my own version\n",
    "the user's own edit was replaced — silently taking back a decision they made");
});

test("--dry-run reports what it would write and writes nothing", () => {
  const fx = fixture();
  const result = installSkills(fx.dir, { dryRun: true });
  assert.deepEqual(result.created, [SKILL]);
  assert.equal(existsSync(join(fx.dir, ".claude")), false,
    "a dry run created a directory in somebody else's repository");
});

test("a missing packaged directory is a refusal, not a silent success", () => {
  // A tarball built without `skills/` in `files` produces exactly this, and it
  // must not look like "nothing to install".
  const fx = fixture();
  const result = installSkills(fx.dir, { source: join(fx.dir, "nowhere") });
  assert.equal(result.ok, false);
  assert.match(result.message, /not in this installation/);
});

// ── through the commands ──────────────────────────────────────────────────

test("`init --skills` installs it, and plain `init` does not", () => {
  // `.claude/` is the user's own directory; writing into it unasked is a
  // surprise, which is why this is a flag and not a default.
  const quiet = fixture();
  assert.equal(run(["init", "--dir", quiet.backlog, "--no-example"], quiet.dir, quiet.env).status, 0);
  assert.equal(existsSync(join(quiet.dir, ".claude")), false,
    "a plain `init` wrote into .claude/ without being asked");

  const asked = fixture();
  const r = run(["init", "--dir", asked.backlog, "--no-example", "--skills"], asked.dir, asked.env);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(existsSync(join(asked.dir, ".claude", "skills", SKILL)), true);
  assert.match(r.stdout, /skills:/);
});

test("`skills install` works in a repository whose backlog already exists", () => {
  const fx = fixture();
  assert.equal(run(["init", "--dir", fx.backlog, "--no-example"], fx.dir, fx.env).status, 0);

  const r = run(["skills", "install", "--dir", fx.backlog], fx.dir, fx.env);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(existsSync(join(fx.dir, ".claude", "skills", SKILL)), true);

  const again = run(["skills", "install", "--dir", fx.backlog], fx.dir, fx.env);
  assert.equal(again.status, 0);
  assert.match(again.stdout, /skipped/);
});

test("it lands at the REPOSITORY root, not inside the backlog", () => {
  // A skill is a fact about the repository; an editor looks for `.claude/` at
  // the top, and one buried in `backlog/` would be read by nothing.
  const fx = fixture();
  assert.equal(spawnSync("git", ["init", "-q", "-b", "main"], { cwd: fx.dir }).status, 0);
  const nested = join(fx.dir, "deep", "nest", "backlog");
  mkdirSync(dirname(nested), { recursive: true });
  assert.equal(run(["init", "--dir", nested, "--no-example", "--skills"], fx.dir, fx.env).status, 0);

  assert.equal(existsSync(join(fx.dir, ".claude", "skills", SKILL)), true, "not at the repository root");
  assert.equal(existsSync(join(nested, ".claude")), false, "a .claude/ inside the backlog is read by nothing");
});

test("an unknown flag and an unknown subcommand both fail", () => {
  const fx = fixture();
  assert.equal(run(["skills", "install", "--frobnicate"], fx.dir, fx.env).status, 2);
  assert.equal(run(["skills", "uninstall"], fx.dir, fx.env).status, 2);
  assert.equal(run(["init", "--dir", fx.backlog, "--skill"], fx.dir, fx.env).status, 2);
});

// ── the content is portable ───────────────────────────────────────────────

test("the skill states no vocabulary and no path from this repository", () => {
  // The assertion is read out of the FILE, because it is a promise about
  // content: a skill that named statuses would be a second truth about them,
  // wrong the moment a project renamed one — quietly, in somebody else's
  // editor, where nobody here would ever see it.
  const file = readFileSync(join(PACKAGED_SKILLS, "backlog-workflow", "SKILL.md"), "utf8");

  // THE BODY, NOT THE FRONTMATTER. The `description:` is matched against what a
  // PERSON says — "what's blocked", "mark this done" — and those are English
  // phrases, not a claim about anybody's `config.yaml`. Judging them by the same
  // rule would force the trigger list to avoid the ordinary words users
  // actually type, which is the opposite of what a description is for.
  const text = file.split(/^---$/m).slice(2).join("---");
  assert.ok(text.length > 200, "the body was not separated from the frontmatter");

  for (const value of ["pending", "in_progress", "P0", "P1", "cancelled", "blocked"]) {
    assert.equal(new RegExp("\\b" + value + "\\b").test(text), false,
      "the skill names this project's vocabulary: " + value);
  }
  for (const path of ["backlog/tasks/", "docs/", "/Users/", "origin"]) {
    assert.equal(text.includes(path), false, "the skill carries a path from this repository: " + path);
  }
  // The positive control: it DOES send the reader to the command that renders
  // the procedure with their own configuration.
  assert.match(text, /instructions overview/);
  // …and the description shows the id shape under TWO different prefixes, which
  // is how it says the prefix is configuration without naming anybody's.
  assert.match(file, /TL-1234/);
  assert.match(file, /BL-42/);
});

test("the README says the skill exists — otherwise nobody will know", () => {
  const readme = readFileSync(join(REPO_ROOT, "README.md"), "utf8");
  assert.match(readme, /skills install/);
  assert.match(readme, /never overwrites?/i);
});
