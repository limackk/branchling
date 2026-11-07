/**
 * `doctor` reports the agent-facing setup — the instructions pointer, the
 * packaged skill and the git gates (TL-475).
 *
 * Each piece is optional, so none of these rows may ever be an error: the
 * assertions check the status AND that the exit code stays 0. Every absent
 * state has a positive control where the same row is green, so a row that
 * always printed one answer would fail here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fixtureDir } from "./_fixture-dir.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { canonicalPath } from "../canonical-path.mjs";
import { checkSkill } from "../doctor.mjs";
import { contentHash } from "../install-skills.mjs";
import { CLAUDE_IMPORT_LINE, NUDGE_CLOSE, NUDGE_OPEN_PREFIX, NUDGE_VERSION } from "../instructions.mjs";
import { isolateHome, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("doctor-agent-setup");

const CLI = join(SCRIPTS_DIR, "cli.mjs");

function run(cwd, args) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", timeout: 120_000 });
}

function repo(files = {}, ...initFlags) {
  const dir = fixtureDir(join(tmpdir(), "branchling-doctor-agent-"));
  assert.equal(spawnSync("git", ["init", "-q", "."], { cwd: dir }).status, 0);
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body, "utf8");
  const r = run(dir, ["init", "--dir", "backlog", "--no-example", ...initFlags]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return dir;
}

function rows(dir) {
  const r = run(dir, ["doctor", "--dir", "backlog", "--json"]);
  assert.equal(r.status, 0, "an optional piece of setup failed doctor: " + r.stdout + r.stderr);
  const byId = {};
  for (const c of JSON.parse(r.stdout).checks) byId[c.id] = c;
  return byId;
}

test("a repository with no agent file at all is warned, with the command that writes one", () => {
  const row = rows(repo({}, "--no-nudge"))["agent-pointer"];
  assert.equal(row.status, "warn");
  assert.match(row.fix, /instructions --update-nudge/);
});

test("a pointer from an older release is reported as stale", () => {
  const dir = repo();
  const path = join(dir, "AGENTS.md");
  writeFileSync(path, readFileSync(path, "utf8").replace(NUDGE_OPEN_PREFIX + " v" + NUDGE_VERSION, NUDGE_OPEN_PREFIX + " v0"), "utf8");
  const row = rows(dir)["agent-pointer"];
  assert.equal(row.status, "warn");
  assert.match(row.detail, /v0/);
});

test("a pointer only in AGENTS.md is named as invisible to Claude Code, without failing", () => {
  const dir = repo({ "AGENTS.md": "# Theirs\n" });
  const row = rows(dir)["agent-pointer"];
  assert.equal(row.status, "info");
  assert.ok(row.fix.includes(CLAUDE_IMPORT_LINE), "the remedy does not name the import line");
});

test("positive control: init from nothing leaves the pointer green", () => {
  const row = rows(repo())["agent-pointer"];
  assert.equal(row.status, "ok", JSON.stringify(row));
});

test("positive control: a pointer written into CLAUDE.md itself is green", () => {
  const dir = repo({ "CLAUDE.md": "# Theirs\n" });
  assert.ok(readFileSync(join(dir, "CLAUDE.md"), "utf8").includes(NUDGE_CLOSE));
  assert.equal(rows(dir)["agent-pointer"].status, "ok");
});

test("the packaged skill: absent names `skills install`, installed is green", () => {
  const absent = rows(repo())["agent-skill"];
  assert.equal(absent.status, "info");
  assert.match(absent.fix, /skills install/);
  assert.equal(rows(repo({}, "--skills"))["agent-skill"].status, "ok");
});

// ── a stale installed skill (TL-585) ──
//
// `skills install` never overwrites, so an installed copy keeps the description
// of its install day. Doctor reports a difference as INFO — it may be the
// user's own edit — and prints the command that matches what the copy is.

test("an edited installed skill is reported, with the refresh that names it", () => {
  const dir = repo({}, "--skills");
  writeFileSync(join(dir, ".claude", "skills", "backlog-workflow", "SKILL.md"), "# my own version\n", "utf8");
  const row = rows(dir)["agent-skill"];
  assert.equal(row.status, "info");
  assert.match(row.detail, /backlog-workflow\/SKILL\.md differs from every packaged version/);
  assert.match(row.fix, /skills install --refresh backlog-workflow\/SKILL\.md/);
});

test("positive control: the refresh it prints makes the row green again", () => {
  const dir = repo({}, "--skills");
  writeFileSync(join(dir, ".claude", "skills", "backlog-workflow", "SKILL.md"), "# my own version\n", "utf8");
  const r = run(dir, ["skills", "install", "--refresh", "backlog-workflow/SKILL.md", "--dir", "backlog"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const row = rows(dir)["agent-skill"];
  assert.equal(row.status, "ok", JSON.stringify(row));
  assert.equal(row.fix, null);
});

test("an older packaged version is reported with a plain refresh, which names no file", () => {
  // The real package's old versions live in git history, absent from a shallow
  // clone, so the comparison is given a fixture package with a known old one.
  const dir = repo();
  const pkg = join(dir, "pkg", "demo");
  mkdirSync(pkg, { recursive: true });
  writeFileSync(join(pkg, "SKILL.md"), "new\n", "utf8");
  const target = join(dir, ".claude", "skills", "demo");
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, "SKILL.md"), "old\n", "utf8");
  const opts = { source: join(dir, "pkg"), skills: ["demo"], shipped: { "demo/SKILL.md": [contentHash(join(target, "SKILL.md"))] } };

  const row = checkSkill(join(dir, "backlog"), opts);
  assert.equal(row.status, "info");
  assert.equal(row.title, "packaged skill");
  assert.equal(row.detail, "demo/SKILL.md" + " is an older packaged version — its description is not the one this release ships");
  assert.match(row.fix, / skills install --refresh$/, "a plain refresh must name no file: " + row.fix);

  writeFileSync(join(target, "SKILL.md"), "mine\n", "utf8");
  const edited = checkSkill(join(dir, "backlog"), opts);
  assert.equal(edited.title, "packaged skill");
  assert.match(edited.fix, / skills install --refresh demo\/SKILL\.md {3}# replaces your edit of it$/);

  writeFileSync(join(target, "SKILL.md"), "new\n", "utf8");
  const current = checkSkill(join(dir, "backlog"), opts);
  assert.equal(current.status, "ok");
  assert.equal(current.title, "packaged skill");
  // The repository root is canonical (macOS: /var is /private/var).
  assert.equal(current.detail, "demo in " + join(canonicalPath(dir), ".claude", "skills"));

  // A package that cannot be read is not a difference: `skills install` is
  // where a broken tarball is reported.
  const broken = checkSkill(join(dir, "backlog"), { ...opts, source: join(dir, "nowhere") });
  assert.equal(broken.status, "ok", JSON.stringify(broken));
});

test("several skills and files are each named, joined so they stay readable", () => {
  const dir = repo();
  const opts = { source: join(dir, "pkg"), skills: ["demo", "other"], shipped: {} };
  for (const name of opts.skills) {
    mkdirSync(join(dir, "pkg", name), { recursive: true });
    writeFileSync(join(dir, "pkg", name, "SKILL.md"), "new\n", "utf8");
  }
  const backlog = join(dir, "backlog");
  assert.match(checkSkill(backlog, opts).detail, /^not installed: demo, other — /);

  for (const name of opts.skills) {
    mkdirSync(join(dir, ".claude", "skills", name), { recursive: true });
    writeFileSync(join(dir, ".claude", "skills", name, "SKILL.md"), "mine\n", "utf8");
  }
  const edited = checkSkill(backlog, opts);
  assert.equal(edited.detail, "demo/SKILL.md" + " differs from every packaged version, " +
    "other/SKILL.md" + " differs from every packaged version — its description is not the one this release ships");
  assert.match(edited.fix, / skills install --refresh demo\/SKILL\.md other\/SKILL\.md {3}# replaces your edit of it$/);

  for (const name of opts.skills) writeFileSync(join(dir, ".claude", "skills", name, "SKILL.md"), "new\n", "utf8");
  assert.match(checkSkill(backlog, opts).detail, /^demo, other in /);
});

test("a skill directory without its SKILL.md counts as not installed", () => {
  const dir = repo();
  mkdirSync(join(dir, ".claude", "skills", "demo"), { recursive: true });
  const row = checkSkill(join(dir, "backlog"), { skills: ["demo"] });
  assert.equal(row.status, "info");
  assert.equal(row.title, "packaged skill");
  assert.match(row.detail, /^not installed: demo — an editor that loads skills will not know a backlog is here$/);
});

// ── something other than a file at the skill path (TL-594) ──

test("a directory in place of the installed SKILL.md is a warning that names it, not a crash", () => {
  const dir = repo({}, "--skills");
  const path = join(dir, ".claude", "skills", "backlog-workflow", "SKILL.md");
  rmSync(path);
  mkdirSync(path);
  const row = rows(dir)["agent-skill"];
  assert.equal(row.status, "warn", JSON.stringify(row));
  assert.equal(row.detail, "backlog-workflow/SKILL.md" + " is not a regular file — an editor cannot read the skill from it");
  // `rows()` runs doctor with `--dir backlog`, so the fix carries it (TL-615).
  assert.match(row.fix, / skills install --dir backlog {3}# after moving .*backlog-workflow[\\/]SKILL\.md aside$/);

  // Positive control: once the directory is gone, the command it names makes the row green.
  rmSync(path, { recursive: true });
  const r = run(dir, ["skills", "install", "--dir", "backlog"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(rows(dir)["agent-skill"].status, "ok");
});

test("only the paths that are not files are named, and a regular file beside them is not", () => {
  const dir = repo();
  const opts = { source: join(dir, "pkg"), skills: ["demo", "other", "plain"], shipped: {} };
  for (const name of opts.skills) {
    mkdirSync(join(dir, "pkg", name), { recursive: true });
    writeFileSync(join(dir, "pkg", name, "SKILL.md"), "new\n", "utf8");
    mkdirSync(join(dir, ".claude", "skills", name), { recursive: true });
  }
  mkdirSync(join(dir, ".claude", "skills", "demo", "SKILL.md"));
  mkdirSync(join(dir, ".claude", "skills", "other", "SKILL.md"));
  writeFileSync(join(dir, ".claude", "skills", "plain", "SKILL.md"), "new\n", "utf8");
  const row = checkSkill(join(dir, "backlog"), opts);
  assert.equal(row.status, "warn");
  assert.equal(row.title, "packaged skill");
  assert.equal(row.detail, "demo/SKILL.md" + ", " + "other/SKILL.md" +
    " are not regular files — an editor cannot read the skill from them");
  const target = join(canonicalPath(dir), ".claude", "skills");
  assert.ok(row.fix.endsWith("skills install   # after moving " + join(target, "demo", "SKILL.md") + " " +
    join(target, "other", "SKILL.md") + " aside"), row.fix);
});

test("the git gates: absent names `hooks print`, installed is green", () => {
  const dir = repo();
  const absent = rows(dir)["git-hooks"];
  assert.equal(absent.status, "info");
  assert.match(absent.fix, /hooks print/);
  const installed = run(dir, ["hooks", "install", "--dir", "backlog"]);
  assert.equal(installed.status, 0, installed.stdout + installed.stderr);
  assert.equal(rows(dir)["git-hooks"].status, "ok");
});
