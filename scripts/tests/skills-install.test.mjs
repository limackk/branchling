/**
 * The agent instructions travel to the user (TL-54).
 *
 * WHAT THIS FILE IS PROTECTING, AND IT IS NOT A COPY OPERATION. Three claims,
 * each of which is easy to break silently:
 *
 *   1. THE SKILL IS IN THE TARBALL. It works in this repository whether or not
 *      `files` carries `.agents/skills/`, so nothing here would notice its absence — and
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
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { fixtureDir } from "./_fixture-dir.mjs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PACKAGED_SKILLS, SHIPPED_VERSIONS, USER_SKILLS, compareInstalled, contentHash, installSkills, renderInstall, skillsTarget } from "../install-skills.mjs";
import { isolateHome, REPO_ROOT, SHIM } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("skills-install");


const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");

let counter = 0;
function tmp(prefix) {
  return fixtureDir(join(tmpdir(), "branchling-" + prefix + "-" + (counter++) + "-"));
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

const SKILL = "backlog-workflow/SKILL.md";

// The command name a user types, written out: a test that took it from the
// constant the code prints would assert that the constant equals itself.
const CLI_NAME = "branchling";

// ── it ships ──────────────────────────────────────────────────────────────

test("the skill is in the tarball", () => {
  // It works in this repository regardless, so nothing else would notice it
  // missing — and the failure is invisible until somebody installs the package.
  const packed = spawnSync("npm", ["pack", "--dry-run", "--json"], {
    ...SHIM, cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000,
  });
  assert.equal(packed.status, 0, packed.stderr);
  const files = JSON.parse(packed.stdout)[0].files.map((f) => f.path);
  assert.ok(files.includes(".agents/skills/backlog-workflow/SKILL.md"),
    "the packaged skill is not in `files`:\n  " + files.filter((f) => f.includes("skill")).join("\n  "));
});

test("only the user-facing skill ships — not the ones about developing the tool", () => {
  // `branchling-cli`, `branchling-release` and `branchling-viewer` are this
  // project's own development procedure. In somebody else's editor they are
  // noise at best.
  assert.deepEqual(USER_SKILLS, ["backlog-workflow"]);
  const packed = spawnSync("npm", ["pack", "--dry-run", "--json"], {
    ...SHIM, cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000,
  });
  const shipped = JSON.parse(packed.stdout)[0].files
    .map((f) => f.path).filter((f) => f.startsWith(".agents/skills/"));
  for (const path of shipped) {
    assert.ok(USER_SKILLS.some((name) => path.startsWith(".agents/skills/" + name + "/")),
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
  // A tarball built without `.agents/skills/` in `files` produces exactly this, and it
  // must not look like "nothing to install".
  const fx = fixture();
  const result = installSkills(fx.dir, { source: join(fx.dir, "nowhere") });
  assert.equal(result.ok, false);
  assert.equal(result.kind, "no-source");
  assert.match(result.message, /not in this installation/);
  assert.match(result.details.join("\n"), /tarball/);
  for (const key of ["created", "skipped", "replaced", "kept", "blocked", "notDirectories"]) assert.deepEqual(result[key], [], key);
  assert.deepEqual(compareInstalled(fx.dir, { source: join(fx.dir, "nowhere") }).files, []);
});

test("a skill the package does not carry is a refusal that names it", () => {
  const fx = fixture();
  const result = installSkills(fx.dir, { skills: ["no-such-skill"] });
  assert.equal(result.ok, false);
  assert.equal(result.kind, "no-skill");
  assert.match(result.message, /no packaged skill called `no-such-skill`/);
  assert.equal(existsSync(join(fx.dir, ".claude")), false);
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

// ── refreshing a stale copy (TL-585) ──────────────────────────────────────
//
// `install` never overwrites, which freezes the skill's DESCRIPTION — the text
// that decides whether an editor loads it — on the day of the install. The
// refresh may replace a file only when it can prove the file holds no edit (it
// is a version the package shipped) or the user names it. Each case below has
// its counterpart where the same file is NOT replaced, so a refresh that
// replaced everything, or nothing, fails here.

/** A packaged source of one skill with two files, and a shipped-version list
 *  that knows an older SKILL.md. The real package has one file and its old
 *  versions live only in git history, which a shallow clone does not have. */
function source(fx) {
  const root = join(fx.dir, "pkg");
  mkdirSync(join(root, "demo", "refs"), { recursive: true });
  writeFileSync(join(root, "demo", "SKILL.md"), "---\ndescription: new\n---\n", "utf8");
  writeFileSync(join(root, "demo", "refs", "notes.md"), "packaged notes v2\n", "utf8");
  const old = join(fx.dir, "old.md");
  writeFileSync(old, "---\ndescription: old\n---\n", "utf8");
  const oldNotes = join(fx.dir, "old-notes.md");
  writeFileSync(oldNotes, "packaged notes v1\n", "utf8");
  return {
    source: root, skills: ["demo"],
    shipped: { "demo/SKILL.md": [contentHash(old)], "demo/refs/notes.md": [contentHash(oldNotes)] },
  };
}

const DEMO = "demo/SKILL.md";
const NOTES = "demo/refs/notes.md";

function installed(fx, file) {
  return join(fx.dir, ".claude", "skills", file);
}

test("the current packaged content is recorded as shipped, so the next release knows it", () => {
  // Without this the NEXT release would read today's copy as somebody's edit
  // and refuse to refresh it — the exact staleness this list exists to end.
  for (const name of USER_SKILLS) {
    const file = name + "/SKILL.md";
    const hash = contentHash(join(PACKAGED_SKILLS, name, "SKILL.md"));
    assert.ok((SHIPPED_VERSIONS[file] || []).includes(hash),
      "the packaged " + file + " is not in SHIPPED_VERSIONS — add this line to its list in scripts/install-skills.mjs:\n" +
      '    "' + hash + '",');
  }
});

test("every packaged file has a shipped-version list, and the list holds no duplicate", () => {
  const listed = Object.keys(SHIPPED_VERSIONS).sort();
  assert.deepEqual(listed, USER_SKILLS.map((n) => n + "/SKILL.md").sort());
  for (const [file, hashes] of Object.entries(SHIPPED_VERSIONS)) {
    assert.ok(hashes.length > 0, file + " has an empty list");
    assert.equal(new Set(hashes).size, hashes.length, file + " lists a version twice");
    for (const h of hashes) assert.match(h, /^[0-9a-f]{64}$/, file + ": not a SHA-256: " + h);
  }
});

test("compareInstalled tells missing, current, shipped and edited apart", () => {
  const fx = fixture();
  const opts = source(fx);
  assert.deepEqual(compareInstalled(fx.dir, opts).files.map((f) => f.state), ["missing", "missing"]);

  installSkills(fx.dir, opts);
  assert.deepEqual(compareInstalled(fx.dir, opts).files, [
    { file: DEMO, state: "current" }, { file: NOTES, state: "current" },
  ]);

  writeFileSync(installed(fx, DEMO), "---\ndescription: old\n---\n", "utf8");
  writeFileSync(installed(fx, NOTES), "my notes\n", "utf8");
  assert.deepEqual(compareInstalled(fx.dir, opts).files, [
    { file: DEMO, state: "shipped" }, { file: NOTES, state: "edited" },
  ]);
});

// ── something other than a file at a packaged path (TL-594) ──
//
// Hashing a directory throws EISDIR, and that throw took `doctor` and `skills
// install` down together. Each case keeps a regular file beside the directory
// as its control, so a state reported for EVERY path would fail too.

function blockWithDirectory(fx, file) {
  const path = installed(fx, file);
  rmSync(path, { force: true });
  mkdirSync(join(path, "inside"), { recursive: true });
  writeFileSync(join(path, "inside", "theirs.md"), "theirs\n", "utf8");
  return path;
}

test("compareInstalled reports a directory at a packaged path as blocked, beside a regular file", () => {
  const fx = fixture();
  const opts = source(fx);
  installSkills(fx.dir, opts);
  blockWithDirectory(fx, DEMO);
  assert.deepEqual(compareInstalled(fx.dir, opts).files, [
    { file: DEMO, state: "blocked" }, { file: NOTES, state: "current" },
  ]);
});

test("a blocked path is left alone by install, by --refresh, and even when named", () => {
  const fx = fixture();
  const opts = source(fx);
  installSkills(fx.dir, opts);
  const path = blockWithDirectory(fx, DEMO);
  rmSync(installed(fx, NOTES));

  const plain = installSkills(fx.dir, opts);
  assert.equal(plain.ok, true);
  assert.deepEqual(plain.blocked, [DEMO]);
  assert.deepEqual(plain.created, [NOTES], "the regular file beside it was not installed");
  assert.deepEqual(plain.skipped, [], "a blocked path is not something that is already there");

  const named = installSkills(fx.dir, { ...opts, refresh: true, named: ["demo/SKILL.md"] });
  assert.equal(named.ok, true);
  assert.deepEqual(named.blocked, [DEMO]);
  assert.deepEqual(named.replaced, []);
  assert.deepEqual(named.kept, []);
  assert.deepEqual(named.skipped, [NOTES]);
  assert.equal(lstatSync(path).isDirectory(), true);
  assert.equal(readFileSync(join(path, "inside", "theirs.md"), "utf8"), "theirs\n", "what the directory held was touched");
});

// ── something other than a directory where a skill's directory belongs (TL-603) ──
//
// The packaged file then reads as merely absent, and the install's mkdirSync
// threw EEXIST. Each case keeps a control: the same layout with the directory
// real, or a sibling path the obstruction does not cover.

function blockWithFile(fx, dir) {
  const path = installed(fx, dir);
  rmSync(path, { recursive: true, force: true });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "theirs\n", "utf8");
  return path;
}

test("compareInstalled reports a file in place of a skill directory as blocked, naming that file", () => {
  const fx = fixture();
  const opts = source(fx);
  blockWithFile(fx, "demo");
  assert.deepEqual(compareInstalled(fx.dir, opts).files, [
    { file: DEMO, state: "blocked", at: "demo" }, { file: NOTES, state: "blocked", at: "demo" },
  ]);

  // Control: with the directory real and empty, both are simply missing.
  rmSync(installed(fx, "demo"));
  mkdirSync(installed(fx, "demo"));
  assert.deepEqual(compareInstalled(fx.dir, opts).files, [
    { file: DEMO, state: "missing" }, { file: NOTES, state: "missing" },
  ]);
});

test("a file in place of a nested directory blocks only the files under it", () => {
  const fx = fixture();
  const opts = source(fx);
  installSkills(fx.dir, opts);
  blockWithFile(fx, "demo/refs");
  assert.deepEqual(compareInstalled(fx.dir, opts).files, [
    { file: DEMO, state: "current" }, { file: NOTES, state: "blocked", at: "demo/refs" },
  ]);
});

test("install does not throw on a file in place of the skill directory, and leaves it alone", () => {
  const fx = fixture();
  const opts = source(fx);
  const path = blockWithFile(fx, "demo");

  for (const extra of [{}, { refresh: true }, { refresh: true, named: [DEMO] }]) {
    const result = installSkills(fx.dir, { ...opts, ...extra });
    assert.equal(result.ok, true, JSON.stringify(extra));
    assert.deepEqual(result.blocked, [DEMO, NOTES], JSON.stringify(extra));
    assert.deepEqual(result.notDirectories, ["demo"], JSON.stringify(extra));
    assert.deepEqual(result.created, [], JSON.stringify(extra));
  }
  assert.equal(readFileSync(path, "utf8"), "theirs\n", "the file in the way was touched");

  // Positive control: once it is moved aside, the same call installs both.
  rmSync(path);
  const after = installSkills(fx.dir, opts);
  assert.deepEqual(after.created, [DEMO, NOTES]);
  assert.deepEqual(after.blocked, []);
  assert.deepEqual(after.notDirectories, []);
});

// ── a dangling link where a skill's directory belongs (TL-634) ──
//
// existsSync follows the link, so one whose target is gone read as absent and
// the install's mkdirSync threw ENOENT, uncaught. The control in each case is
// the same link pointed at a real directory, which is a directory.

function linkInPlace(fx, dir, to) {
  const path = installed(fx, dir);
  rmSync(path, { recursive: true, force: true });
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(to, path);
  return path;
}

test("compareInstalled reports a dangling link in place of a skill directory as blocked, naming the link", () => {
  const fx = fixture();
  const opts = source(fx);
  linkInPlace(fx, "demo", join(fx.dir, "moved-away"));
  assert.deepEqual(compareInstalled(fx.dir, opts).files, [
    { file: DEMO, state: "blocked", at: "demo" }, { file: NOTES, state: "blocked", at: "demo" },
  ]);

  // Control: the same link with its target present is a directory, and the
  // files under it are simply missing.
  mkdirSync(join(fx.dir, "moved-away"));
  assert.deepEqual(compareInstalled(fx.dir, opts).files, [
    { file: DEMO, state: "missing" }, { file: NOTES, state: "missing" },
  ]);
});

test("a dangling link in place of a nested directory blocks only the files under it", () => {
  const fx = fixture();
  const opts = source(fx);
  installSkills(fx.dir, opts);
  linkInPlace(fx, "demo/refs", join(fx.dir, "moved-away"));
  assert.deepEqual(compareInstalled(fx.dir, opts).files, [
    { file: DEMO, state: "current" }, { file: NOTES, state: "blocked", at: "demo/refs" },
  ]);
});

test("a link that cannot resolve because it points at itself is in the way too", () => {
  const fx = fixture();
  const opts = source(fx);
  const path = installed(fx, "demo");
  linkInPlace(fx, "demo", path);
  assert.deepEqual(compareInstalled(fx.dir, opts).files.map((f) => f.at), ["demo", "demo"]);
});

test("a link whose target passes through a file is in the way too", () => {
  const fx = fixture();
  const opts = source(fx);
  writeFileSync(join(fx.dir, "plain"), "plain\n", "utf8");
  linkInPlace(fx, "demo", join(fx.dir, "plain", "under"));
  assert.deepEqual(compareInstalled(fx.dir, opts).files.map((f) => f.at), ["demo", "demo"]);
});

test("install does not throw on a dangling link in place of the skill directory, and leaves it alone", () => {
  const fx = fixture();
  const opts = source(fx);
  const away = join(fx.dir, "moved-away");
  const path = linkInPlace(fx, "demo", away);

  for (const extra of [{}, { refresh: true }, { refresh: true, named: [DEMO] }]) {
    const result = installSkills(fx.dir, { ...opts, ...extra });
    assert.equal(result.ok, true, JSON.stringify(extra));
    assert.deepEqual(result.blocked, [DEMO, NOTES], JSON.stringify(extra));
    assert.deepEqual(result.notDirectories, ["demo"], JSON.stringify(extra));
    assert.deepEqual(result.created, [], JSON.stringify(extra));
  }
  assert.equal(lstatSync(path).isSymbolicLink(), true, "the link in the way was replaced");
  assert.equal(existsSync(away), false, "the install created the link's target");

  // Positive control: with the target back, the same call installs through the link.
  mkdirSync(away);
  const after = installSkills(fx.dir, opts);
  assert.deepEqual(after.created, [DEMO, NOTES]);
  assert.deepEqual(after.blocked, []);
  assert.deepEqual(after.notDirectories, []);
  assert.equal(readFileSync(join(away, "SKILL.md"), "utf8"), "---\ndescription: new\n---\n");
});

// ── a file in place of `.claude` or `.claude/skills` itself (TL-633) ──
//
// The walk above starts BELOW the skills target, so a file AT it made every
// packaged file look absent, and lstat and then mkdirSync threw ENOTDIR or
// EEXIST, uncaught. Nothing can be installed anywhere, so it is a refusal that
// names the path. The control in each case is the same directory made real.

for (const at of [".claude", ".claude/skills"]) {
  test("compareInstalled and install refuse a file in place of `" + at + "`, naming it, and leave it alone", () => {
    const fx = fixture();
    const opts = source(fx);
    const path = join(fx.dir, at);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "theirs\n", "utf8");

    const compared = compareInstalled(fx.dir, opts);
    assert.equal(compared.ok, false);
    assert.equal(compared.kind, "target-not-directory");
    assert.ok(compared.message.startsWith(path + " is not a directory"), compared.message);
    for (const extra of [{}, { dryRun: true }, { refresh: true }]) {
      const result = installSkills(fx.dir, { ...opts, ...extra });
      assert.equal(result.ok, false, JSON.stringify(extra));
      assert.equal(result.kind, "target-not-directory", JSON.stringify(extra));
      assert.deepEqual(result.created, [], JSON.stringify(extra));
    }
    assert.equal(readFileSync(path, "utf8"), "theirs\n", "the file in the way was touched");

    // Positive control: with the directory real, the same call installs both.
    rmSync(path);
    mkdirSync(path, { recursive: true });
    assert.equal(compareInstalled(fx.dir, opts).ok, true);
    const after = installSkills(fx.dir, opts);
    assert.equal(after.ok, true);
    assert.deepEqual(after.created, [DEMO, NOTES]);
  });
}

test("a dangling link in place of `.claude/skills` is refused too, and a resolving one is a directory", () => {
  const fx = fixture();
  const opts = source(fx);
  const path = join(fx.dir, ".claude", "skills");
  const away = join(fx.dir, "moved-away");
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(away, path);
  assert.equal(installSkills(fx.dir, opts).kind, "target-not-directory");
  assert.equal(lstatSync(path).isSymbolicLink(), true, "the link in the way was replaced");
  assert.equal(existsSync(away), false, "the install created the link's target");

  // Control: the same link with its target present installs through it.
  mkdirSync(away);
  assert.deepEqual(installSkills(fx.dir, opts).created, [DEMO, NOTES]);
});

test("a skill directory reached through a symlink is read through it", () => {
  // The repository's own `.claude/skills/*` are symlinks; a packaged skill
  // laid out the same way must not lose the files behind one.
  const fx = fixture();
  const opts = source(fx);
  mkdirSync(join(fx.dir, "shared"), { recursive: true });
  writeFileSync(join(fx.dir, "shared", "ref.md"), "shared\n", "utf8");
  symlinkSync(join(fx.dir, "shared"), join(opts.source, "demo", "linked"));
  // …and a link to a FILE is a file, not a directory to descend into.
  symlinkSync(join(fx.dir, "shared", "ref.md"), join(opts.source, "demo", "ref-link.md"));
  assert.deepEqual(compareInstalled(fx.dir, opts).files.map((f) => f.file).sort(),
    [DEMO, "demo/linked/ref.md", "demo/ref-link.md", NOTES].sort());
});

test("the files are listed in one order on every filesystem", () => {
  // readdirSync returns the filesystem's own order: NTFS sorts names
  // case-insensitively, so on Windows `refs/` came before `SKILL.md` and the
  // first row of doctor and of a refusal named a different file (TL-624).
  // APFS already returns this order, so on macOS the test passes without the
  // sort; the Windows CI job is the one that tells the two apart.
  const fx = fixture();
  const opts = source(fx);
  for (const name of ["zeta.md", "Beta.md", "alpha.md"]) {
    writeFileSync(join(opts.source, "demo", name), name + "\n", "utf8");
  }
  assert.deepEqual(compareInstalled(fx.dir, opts).files.map((f) => f.file),
    ["demo/Beta.md", DEMO, "demo/alpha.md", NOTES, "demo/zeta.md"]);
});

test("a copy differing only in CRLF line endings is current, not an edit", () => {
  // A checkout with `core.autocrlf` rewrites line endings; reading that as the
  // user's edit would refuse every refresh on Windows.
  const fx = fixture();
  const opts = source(fx);
  installSkills(fx.dir, opts);
  writeFileSync(installed(fx, DEMO), "---\r\ndescription: new\r\n---\r\n", "utf8");
  assert.equal(compareInstalled(fx.dir, opts).files[0].state, "current");
  writeFileSync(installed(fx, DEMO), "---\r\ndescription: old\r\n---\r\n", "utf8");
  assert.equal(compareInstalled(fx.dir, opts).files[0].state, "shipped");
});

test("without --refresh an older shipped version is skipped, as before", () => {
  const fx = fixture();
  const opts = source(fx);
  installSkills(fx.dir, opts);
  writeFileSync(installed(fx, DEMO), "---\ndescription: old\n---\n", "utf8");
  const again = installSkills(fx.dir, opts);
  assert.deepEqual(again.skipped, [DEMO, NOTES]);
  assert.deepEqual(again.replaced, []);
  assert.equal(readFileSync(installed(fx, DEMO), "utf8"), "---\ndescription: old\n---\n");
});

test("--refresh replaces a shipped version, keeps an edit, and touches no file of the user's", () => {
  const fx = fixture();
  const opts = source(fx);
  installSkills(fx.dir, opts);
  writeFileSync(installed(fx, DEMO), "---\ndescription: old\n---\n", "utf8");
  writeFileSync(installed(fx, NOTES), "my notes\n", "utf8");
  // Files the package never shipped: one beside the skill, one in another skill.
  const beside = installed(fx, join("demo", "mine.md"));
  writeFileSync(beside, "mine\n", "utf8");
  const other = installed(fx, join("theirs", "SKILL.md"));
  mkdirSync(dirname(other), { recursive: true });
  writeFileSync(other, "---\ndescription: old\n---\n", "utf8");

  const result = installSkills(fx.dir, { ...opts, refresh: true });
  assert.equal(result.ok, true);
  assert.deepEqual(result.replaced, [DEMO]);
  assert.deepEqual(result.kept, [NOTES]);
  assert.deepEqual(result.created, []);
  assert.deepEqual(result.skipped, []);
  assert.equal(readFileSync(installed(fx, DEMO), "utf8"), "---\ndescription: new\n---\n");
  assert.equal(readFileSync(installed(fx, NOTES), "utf8"), "my notes\n", "an edit was replaced unnamed");
  assert.equal(readFileSync(beside, "utf8"), "mine\n");
  assert.equal(readFileSync(other, "utf8"), "---\ndescription: old\n---\n",
    "a file in a skill the package does not ship was replaced");
});

test("--refresh replaces an edited file only when it is named", () => {
  const fx = fixture();
  const opts = source(fx);
  installSkills(fx.dir, opts);
  writeFileSync(installed(fx, DEMO), "my skill\n", "utf8");
  writeFileSync(installed(fx, NOTES), "my notes\n", "utf8");

  const result = installSkills(fx.dir, { ...opts, refresh: true, named: ["demo/refs/notes.md"] });
  assert.deepEqual(result.replaced, [NOTES]);
  assert.deepEqual(result.kept, [DEMO]);
  assert.equal(readFileSync(installed(fx, NOTES), "utf8"), "packaged notes v2\n");
  assert.equal(readFileSync(installed(fx, DEMO), "utf8"), "my skill\n");
});

test("--refresh leaves a current file alone and creates a missing one", () => {
  const fx = fixture();
  const opts = source(fx);
  installSkills(fx.dir, opts);
  rmSync(installed(fx, NOTES));
  const result = installSkills(fx.dir, { ...opts, refresh: true, named: ["demo/SKILL.md"] });
  assert.deepEqual(result.created, [NOTES]);
  assert.deepEqual(result.skipped, [DEMO]);
  assert.deepEqual(result.replaced, [], "a file identical to the packaged one counts as nothing done");
});

test("--refresh --dry-run reports the replacement and writes nothing", () => {
  const fx = fixture();
  const opts = source(fx);
  installSkills(fx.dir, opts);
  writeFileSync(installed(fx, DEMO), "---\ndescription: old\n---\n", "utf8");
  const result = installSkills(fx.dir, { ...opts, refresh: true, dryRun: true });
  assert.deepEqual(result.replaced, [DEMO]);
  assert.equal(readFileSync(installed(fx, DEMO), "utf8"), "---\ndescription: old\n---\n");
});

test("naming a file the package does not ship is a refusal", () => {
  const fx = fixture();
  const opts = source(fx);
  installSkills(fx.dir, opts);
  const result = installSkills(fx.dir, { ...opts, refresh: true, named: ["demo/mine.md"] });
  assert.equal(result.ok, false);
  assert.equal(result.kind, "unknown-file");
  assert.equal(result.message, "`demo/mine.md` is not a packaged skill file");
  assert.deepEqual(result.details, [
    "Name a path under " + skillsTarget(fx.dir) + " as the package ships it: demo/SKILL.md, demo/refs/notes.md",
  ]);
  for (const key of ["created", "skipped", "replaced", "kept", "blocked", "notDirectories"]) assert.deepEqual(result[key], [], key);
});

test("what the install prints names each outcome, and only the ones that happened", () => {
  const plain = { color: { ok: (s) => s, dim: (s) => s, warn: (s) => s } };
  const base = { target: "/t", created: [], skipped: [], replaced: [], kept: [], blocked: [] };
  const say = (over) => renderInstall({ ...base, ...over }, plain);

  assert.match(say({}), /skills: nothing to install/);
  for (const over of [{ created: ["a"] }, { skipped: ["a"] }, { replaced: ["a"] }, { kept: ["a"] }, { blocked: ["a"] }]) {
    assert.doesNotMatch(say(over), /nothing to install/, JSON.stringify(over));
  }

  // Whole strings, because every line of this is something a user reads.
  assert.equal(say({ replaced: ["demo/SKILL.md", "demo/b.md"] }),
    "✓ refreshed: 2 file(s) → /t\n    demo/SKILL.md\n    demo/b.md");
  assert.equal(say({ kept: ["demo/SKILL.md", "demo/b.md"] }), [
    "! kept (matches no shipped version — your edit?): demo/SKILL.md, demo/b.md",
    "  To replace it anyway, discarding what it holds, name it:",
    "  `" + CLI_NAME + " skills install --refresh demo/SKILL.md demo/b.md`",
  ].join("\n"));
  assert.equal(say({ blocked: ["demo/SKILL.md", "demo/b.md"] }), [
    "! not a file, left alone: demo/SKILL.md, demo/b.md",
    "  Something other than a file stands at that path, so the editor cannot read it.",
    "  Move it aside, then run `" + CLI_NAME + " skills install` again.",
  ].join("\n"));
  // The remedy names the path in the way, not the files that could not land.
  assert.equal(say({ blocked: ["demo/SKILL.md", "demo/refs/b.md", "other/SKILL.md"], notDirectories: ["demo"] }), [
    "! not a file, left alone: other/SKILL.md",
    "  Something other than a file stands at that path, so the editor cannot read it.",
    "  Move it aside, then run `" + CLI_NAME + " skills install` again.",
    "! not a directory, left alone: demo",
    "  Something other than a directory stands where the skill's directory belongs,",
    "  so nothing can be installed under it.",
    "  Move it aside, then run `" + CLI_NAME + " skills install` again.",
  ].join("\n"));
  assert.doesNotMatch(say({ notDirectories: ["demo"] }), /nothing to install/);
  assert.equal(say({ skipped: ["demo/SKILL.md", "demo/b.md"] }),
    "· skipped (already there, left alone): demo/SKILL.md, demo/b.md");
  assert.equal(say({ created: ["demo/SKILL.md"] }), [
    "✓ skills: 1 file(s) → /t",
    "    demo/SKILL.md",
    "  The skill holds no procedure and no vocabulary — it tells an agent to run",
    "  `" + CLI_NAME + " instructions overview`, which is rendered with YOUR config.yaml.",
  ].join("\n"));
});

test("`skills install --refresh` through the CLI: keeps an edit, then replaces it when named", () => {
  const fx = fixture();
  assert.equal(run(["init", "--dir", fx.backlog, "--no-example", "--skills"], fx.dir, fx.env).status, 0);
  const path = join(fx.dir, ".claude", "skills", SKILL);
  writeFileSync(path, "# my own version\n", "utf8");

  const kept = run(["skills", "install", "--refresh", "--dir", fx.backlog], fx.dir, fx.env);
  assert.equal(kept.status, 0, kept.stderr);
  assert.match(kept.stdout, /kept/);
  assert.ok(kept.stdout.includes("skills install --refresh backlog-workflow/SKILL.md"),
    "the remedy does not name the file:\n" + kept.stdout);
  assert.equal(readFileSync(path, "utf8"), "# my own version\n");

  const named = run(["skills", "install", "--refresh", "backlog-workflow/SKILL.md", "--dir", fx.backlog, "--json"], fx.dir, fx.env);
  assert.equal(named.status, 0, named.stderr);
  assert.equal(JSON.parse(named.stdout).kind, "skills-install");
  assert.equal(JSON.parse(named.stdout).ok, true);
  assert.deepEqual(JSON.parse(named.stdout).replaced, [SKILL]);
  assert.equal(readFileSync(path, "utf8"), readFileSync(join(PACKAGED_SKILLS, SKILL), "utf8"));

  const plain = run(["skills", "install", "--refresh", "--dir", fx.backlog], fx.dir, fx.env);
  assert.match(plain.stdout, /skipped/);
  assert.doesNotMatch(plain.stdout, /refreshed|kept/);

  writeFileSync(path, "# edited again\n", "utf8");
  const text = run(["skills", "install", "--refresh", "backlog-workflow/SKILL.md", "--dir", fx.backlog], fx.dir, fx.env);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /refreshed: 1 file\(s\)/);
  assert.ok(text.stdout.includes(SKILL), text.stdout);
});

test("`skills install --dry-run` through the CLI writes nothing", () => {
  const fx = fixture();
  assert.equal(run(["init", "--dir", fx.backlog, "--no-example"], fx.dir, fx.env).status, 0);
  // From ANOTHER directory, so only --dir can find the backlog.
  const r = run(["skills", "install", "--dry-run", "--dir", fx.backlog], tmp("elsewhere"), fx.env);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes(SKILL), r.stdout);
  assert.equal(existsSync(join(fx.dir, ".claude")), false, "a dry run wrote into .claude/");
});

test("a file argument without --refresh, or naming no packaged file, is a usage error", () => {
  const fx = fixture();
  assert.equal(run(["init", "--dir", fx.backlog, "--no-example", "--skills"], fx.dir, fx.env).status, 0);
  const without = run(["skills", "install", "backlog-workflow/SKILL.md", "--dir", fx.backlog], fx.dir, fx.env);
  assert.equal(without.status, 2);
  assert.match(without.stderr, /unexpected argument/);
  const unknown = run(["skills", "install", "--refresh", "nope.md", "--dir", fx.backlog], fx.dir, fx.env);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /nope\.md/);
  assert.match(unknown.stderr, /skills install: `nope\.md` is not a packaged skill file/);
  assert.match(unknown.stderr, /as the package ships it/, "the refusal does not list what may be named");
  // Under --json the same refusal is a `skills-install` envelope on stdout,
  // with the exit code unchanged (TL-567).
  const json = run(["skills", "install", "--refresh", "nope.md", "--dir", fx.backlog, "--json"], fx.dir, fx.env);
  assert.equal(json.status, 2);
  assert.equal(json.stderr, "", json.stderr);
  const refused = JSON.parse(json.stdout);
  assert.deepEqual([refused.kind, refused.ok, refused.refusalKind], ["skills-install", false, "unknown-file"]);
  assert.match(refused.refusal, /`nope\.md` is not a packaged skill file/);
  assert.match(refused.details.join("\n"), /as the package ships it/);
  // A flag is never read as a file name, with or without --refresh.
  for (const args of [["--frobnicate"], ["--refresh", "--frobnicate"]]) {
    const flag = run(["skills", "install", ...args, "--dir", fx.backlog], fx.dir, fx.env);
    assert.equal(flag.status, 2, args.join(" "));
    assert.match(flag.stderr, /unknown flag: --frobnicate/, args.join(" "));
    assert.match(flag.stderr, /skills install: unknown flag: --frobnicate$/m, args.join(" "));
    assert.match(flag.stderr, /available: --dry-run --json --dir --refresh \[<file>\.\.\.\]$/m, "the usage line does not offer a file");
  }
  const two = run(["skills", "install", "a.md", "b.md", "--dir", fx.backlog], fx.dir, fx.env);
  assert.match(two.stderr, /skills install: unexpected argument: a\.md b\.md$/m);
});

test("the subcommand refusals say what was wrong", () => {
  const fx = fixture();
  assert.match(run(["skills", "uninstall"], fx.dir, fx.env).stderr, /skills: unknown subcommand: uninstall\n\s*available: install$/m);
  assert.match(run(["skills"], fx.dir, fx.env).stderr, /skills: no subcommand\n/);
});

test("with no backlog to anchor on, `skills install` refuses and says how to make one", () => {
  const fx = fixture();
  assert.equal(spawnSync("git", ["init", "-q"], { cwd: fx.dir }).status, 0);
  const r = run(["skills", "install"], fx.dir, fx.env);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /skills install: no backlog here/);
  assert.match(r.stderr, /init --dir <path>/, "the refusal lost its details");
  assert.equal(existsSync(join(fx.dir, ".claude")), false);
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
  for (const path of ["backlog/tasks/", "docs/", "/Users/", "another-workspace"]) {
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

test("`skills install` through the CLI names a directory at the skill path instead of crashing", () => {
  const fx = fixture();
  assert.equal(run(["init", "--dir", fx.backlog, "--no-example"], fx.dir, fx.env).status, 0);
  const path = join(fx.dir, ".claude", "skills", SKILL);
  mkdirSync(path, { recursive: true });

  for (const args of [[], ["--refresh"], ["--refresh", "backlog-workflow/SKILL.md"]]) {
    const text = run(["skills", "install", ...args, "--dir", fx.backlog], fx.dir, fx.env);
    assert.equal(text.status, 0, args.join(" ") + ": " + text.stderr);
    assert.ok(text.stdout.includes("not a file, left alone: " + SKILL), text.stdout);
  }
  const json = run(["skills", "install", "--json", "--dir", fx.backlog], fx.dir, fx.env);
  assert.equal(json.status, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout).blocked, [SKILL]);
  assert.equal(lstatSync(path).isDirectory(), true);

  // Positive control: the remedy it prints works.
  rmSync(path, { recursive: true });
  const after = run(["skills", "install", "--json", "--dir", fx.backlog], fx.dir, fx.env);
  assert.deepEqual(JSON.parse(after.stdout).created, [SKILL]);
  assert.deepEqual(JSON.parse(after.stdout).blocked, []);
});

test("`skills install` through the CLI names a file in place of the skill directory instead of crashing", () => {
  const fx = fixture();
  assert.equal(run(["init", "--dir", fx.backlog, "--no-example"], fx.dir, fx.env).status, 0);
  const path = join(fx.dir, ".claude", "skills", "backlog-workflow");
  rmSync(path, { recursive: true, force: true });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "theirs\n", "utf8");

  const text = run(["skills", "install", "--dir", fx.backlog], fx.dir, fx.env);
  assert.equal(text.status, 0, text.stderr);
  assert.ok(text.stdout.includes("not a directory, left alone: backlog-workflow\n"), text.stdout);
  assert.ok(!text.stdout.includes("not a file"), text.stdout);
  const json = run(["skills", "install", "--json", "--dir", fx.backlog], fx.dir, fx.env);
  assert.equal(json.status, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout).notDirectories, ["backlog-workflow"]);
  assert.deepEqual(JSON.parse(json.stdout).blocked, [SKILL]);
  assert.equal(readFileSync(path, "utf8"), "theirs\n");

  // Positive control: the remedy it prints works.
  rmSync(path);
  const after = run(["skills", "install", "--json", "--dir", fx.backlog], fx.dir, fx.env);
  assert.deepEqual(JSON.parse(after.stdout).created, [SKILL]);
});

test("`skills install` through the CLI names a dangling link in place of the skill directory instead of crashing", () => {
  const fx = fixture();
  assert.equal(run(["init", "--dir", fx.backlog, "--no-example"], fx.dir, fx.env).status, 0);
  const path = join(fx.dir, ".claude", "skills", "backlog-workflow");
  rmSync(path, { recursive: true, force: true });
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(join(fx.dir, "moved-away"), path);

  const text = run(["skills", "install", "--dir", fx.backlog], fx.dir, fx.env);
  assert.equal(text.status, 0, text.stderr);
  assert.doesNotMatch(text.stderr, /ENOENT/);
  assert.ok(text.stdout.includes("not a directory, left alone: backlog-workflow\n"), text.stdout);
  const json = run(["skills", "install", "--json", "--dir", fx.backlog], fx.dir, fx.env);
  assert.equal(json.status, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout).notDirectories, ["backlog-workflow"]);
  assert.deepEqual(JSON.parse(json.stdout).blocked, [SKILL]);
  assert.equal(lstatSync(path).isSymbolicLink(), true);

  // Positive control: the remedy it prints works.
  rmSync(path);
  const after = run(["skills", "install", "--json", "--dir", fx.backlog], fx.dir, fx.env);
  assert.deepEqual(JSON.parse(after.stdout).created, [SKILL]);
});

for (const at of [".claude", ".claude/skills"]) {
  test("`skills install` and `init --skills` through the CLI name a file in place of `" + at + "` instead of crashing", () => {
    const fx = fixture();
    const path = join(fx.dir, at);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "theirs\n", "utf8");
    const init = run(["init", "--dir", fx.backlog, "--no-example", "--skills"], fx.dir, fx.env);
    assert.equal(init.status, 0, init.stderr);
    assert.ok(init.stdout.includes("WARNING: " + path + " is not a directory"), init.stdout);

    const text = run(["skills", "install", "--dir", fx.backlog], fx.dir, fx.env);
    assert.equal(text.status, 1, text.stderr);
    assert.doesNotMatch(text.stderr, /ENOTDIR|EEXIST|at .*\.mjs/);
    assert.ok(text.stderr.includes(path + " is not a directory"), text.stderr);
    assert.ok(text.stderr.includes("Move it aside, then run `" + CLI_NAME + " skills install` again."), text.stderr);
    const json = run(["skills", "install", "--json", "--dir", fx.backlog], fx.dir, fx.env);
    assert.equal(json.status, 1, json.stderr);
    const parsed = JSON.parse(json.stdout);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.refusalKind, "target-not-directory");
    assert.deepEqual(parsed.created, []);
    assert.equal(readFileSync(path, "utf8"), "theirs\n");

    // Positive control: the remedy it prints works.
    rmSync(path);
    const after = run(["skills", "install", "--json", "--dir", fx.backlog], fx.dir, fx.env);
    assert.equal(after.status, 0, after.stderr);
    assert.deepEqual(JSON.parse(after.stdout).created, [SKILL]);
  });
}
