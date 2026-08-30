/**
 * `worktrail init` — does git REALLY ignore the views (TL-59).
 *
 * WHAT IS BEING TESTED. Not "was a `.gitignore` created", but whether the rule is
 * IN FORCE — because those are two different things, and they differ in exactly
 * the layout where the defect sat. `init` never overwrites an existing file (and
 * it is meant to stay that way), so in the CO-LOCATED layout inside a repository
 * that already had its own `.gitignore`, the rules were never created at all. The
 * consequence: a committed `INDEX.yaml`, an aggregate of every task, which
 * conflicts between branches that share no task.
 *
 * WHICH IS WHY WE ASK GIT, NOT THE DISK. `git check-ignore` also knows about
 * `.git/info/exclude`, files in parent directories and negating entries — an
 * assertion on the file's content would pass for a rule that does not work.
 *
 * THE POSITIVE CONTROL is mandatory here: without it this whole file would pass
 * even if `check-ignore` answered affirmatively for any reason at all. So the
 * first test proves that the measurement CAN say "no".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { BLOCK_OPEN, IGNORE_RULES } from "../git-rules.mjs";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "cli.mjs");

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "worktrail-gitignore-"));
  const r = spawnSync("git", ["init", "-q", "."], { cwd: dir, encoding: "utf8" });
  assert.equal(r.status, 0, "git init: " + r.stderr);
  return dir;
}

function init(cwd, args) {
  return spawnSync(process.execPath, [CLI, "init"].concat(args), { cwd, encoding: "utf8", timeout: 30_000 });
}

/** true = git ignores this path. */
function ignored(cwd, rel) {
  return spawnSync("git", ["check-ignore", "-q", "--", rel], { cwd }).status === 0;
}

function unionMerge(cwd) {
  const r = spawnSync("git", ["check-attr", "merge", "--", "history/x.jsonl"], { cwd, encoding: "utf8" });
  return /merge:\s*union/.test(String(r.stdout || ""));
}

// ── Kontrola pozytywna ────────────────────────────────────────────────────

test("positive control: with no rules git does NOT ignore the views", () => {
  const dir = repo();
  writeFileSync(join(dir, ".gitignore"), "node_modules/\n", "utf8");
  assert.equal(ignored(dir, "INDEX.yaml"), false,
    "the measurement cannot answer in the negative — the rest of this file would be green with no evidential force");
});

// ── Both directory layouts ────────────────────────────────────────────────

test("nested layout: after init the views are ignored", () => {
  const dir = repo();
  assert.equal(init(dir, ["--dir", "./backlog"]).status, 0);
  const backlog = join(dir, "backlog");
  for (const rel of ["INDEX.yaml", "NOW.yaml", "viewer.html"]) {
    assert.equal(ignored(backlog, rel), true, rel + " is not ignored");
  }
});

test("co-location in a repo with its OWN .gitignore: after init the views are ignored", () => {
  // This is the layout the defect sat in: the file exists, so `init` skips it, and
  // without appending the rules the views end up in the commit.
  const dir = repo();
  writeFileSync(join(dir, ".gitignore"), "node_modules/\n", "utf8");
  assert.equal(init(dir, ["--dir", "."]).status, 0);
  for (const rel of ["INDEX.yaml", "NOW.yaml", "archive/done.yaml", "viewer.html"]) {
    assert.equal(ignored(dir, rel), true, rel + " is not ignored");
  }
});

test("appending does NOT touch what the user had in the file", () => {
  const dir = repo();
  writeFileSync(join(dir, ".gitignore"), "node_modules/\n*.log\n", "utf8");
  init(dir, ["--dir", "."]);
  const after = readFileSync(join(dir, ".gitignore"), "utf8");
  assert.ok(after.startsWith("node_modules/\n*.log\n"), "the original content stopped being at the start");
  assert.equal(ignored(dir, "app.log"), true, "the user's own rule stopped working");
});

test("appending is idempotent — a second init does not add a second block", () => {
  const dir = repo();
  writeFileSync(join(dir, ".gitignore"), "node_modules/\n", "utf8");
  init(dir, ["--dir", "."]);
  init(dir, ["--dir", "."]);
  const blocks = readFileSync(join(dir, ".gitignore"), "utf8").split(BLOCK_OPEN).length - 1;
  assert.equal(blocks, 1, "the worktrail block appeared " + blocks + " times");
});

// ── Rezygnacja ────────────────────────────────────────────────────────────

test("--no-gitignore: the file is untouched, but the user gets the rules to paste", () => {
  const dir = repo();
  writeFileSync(join(dir, ".gitignore"), "node_modules/\n", "utf8");
  const r = init(dir, ["--dir", ".", "--no-gitignore"]);
  assert.equal(r.status, 0);
  assert.equal(readFileSync(join(dir, ".gitignore"), "utf8"), "node_modules/\n", "the file was changed despite --no-gitignore");
  for (const rule of IGNORE_RULES) {
    assert.ok(r.stdout.includes(rule), "the rule `" + rule + "` is missing from the hint");
  }
});

// ── .gitattributes ────────────────────────────────────────────────────────

test("co-location with an OWN .gitattributes: history gets merge=union", () => {
  const dir = repo();
  writeFileSync(join(dir, ".gitattributes"), "*.png binary\n", "utf8");
  assert.equal(init(dir, ["--dir", "."]).status, 0);
  assert.equal(unionMerge(dir), true, "history/*.jsonl without merge=union — an append-only log will conflict");
});

// ── States that have to be said out loud, not passed over ─────────────────

test("a view already tracked: init mentions `git rm --cached`", () => {
  const dir = repo();
  writeFileSync(join(dir, ".gitignore"), "node_modules/\n", "utf8");
  writeFileSync(join(dir, "INDEX.yaml"), "tasks: []\n", "utf8");
  spawnSync("git", ["add", "INDEX.yaml"], { cwd: dir });
  spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "x"], { cwd: dir });
  const r = init(dir, ["--dir", "."]);
  assert.ok(r.stdout.includes("git rm --cached"), "it says nothing about a file the rule will no longer remove:\n" + r.stdout);
  assert.ok(r.stdout.includes("INDEX.yaml"), "it does not name the file");
});

test("outside a git repository: it says so once and does not pretend to be a crash", () => {
  const dir = mkdtempSync(join(tmpdir(), "worktrail-nogit-"));
  const r = init(dir, ["--dir", "."]);
  assert.equal(r.status, 0, "the absence of a repository is not an error");
  assert.ok(/not a repository/.test(r.stdout), "it did not say why it is not checking:\n" + r.stdout);
});

test("an unknown flag still fails", () => {
  const dir = repo();
  const r = init(dir, ["--dir", ".", "--no-gitignor"]);
  assert.equal(r.status, 2, "a typo in a flag went through");
});
