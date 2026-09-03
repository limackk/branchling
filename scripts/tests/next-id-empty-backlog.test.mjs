/**
 * The `next-id` warning is about the ABSENCE OF A REPOSITORY, not about an empty
 * result (TL-66).
 *
 * The set of number sources can be empty in two ways, and until TL-66 the
 * condition did not tell them apart:
 *
 *   a backlog outside git       — the answer really is narrower, the warning is due;
 *   a repo with a fresh backlog — the scan swept every branch and found nothing,
 *                                 so the answer is complete.
 *
 * The second case is the FIRST task of every new user. A warning that lies the
 * first time teaches people to ignore all the ones after it — and this one is
 * meant to save somebody one day from two tasks carrying the same number.
 *
 * HENCE BOTH SIDES. A test checking only for silence would also be green for a
 * fix that removes the warning entirely.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { isolateHome } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("next-id-empty-backlog");

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "cli.mjs");

function run(cwd, args) {
  return spawnSync(process.execPath, [CLI].concat(args), { cwd, encoding: "utf8", timeout: 30_000 });
}

function gitRepo() {
  const dir = mkdtempSync(join(tmpdir(), "branchling-nextid-"));
  spawnSync("git", ["init", "-q", "."], { cwd: dir });
  writeFileSync(join(dir, "a.txt"), "x\n", "utf8");
  spawnSync("git", ["add", "-A"], { cwd: dir });
  spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"], { cwd: dir });
  return dir;
}

test("an empty backlog INSIDE a repository: a number with no warning", () => {
  const dir = gitRepo();
  assert.equal(run(dir, ["init", "--dir", "./backlog", "--no-example"]).status, 0);
  const r = run(dir, ["next-id", "--dir", "./backlog"]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim().split("\n").pop(), "1");
  assert.equal(r.stderr, "", "it warns even though the branch scan ran in full:\n" + r.stderr);
});

test("the first task in a fresh repo: `new` is quiet too", () => {
  const dir = gitRepo();
  run(dir, ["init", "--dir", "./backlog", "--no-example"]);
  const r = run(dir, ["new", "--dir", "./backlog", "--title", "First task"]);
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stderr, /outside a repository|not in a git repository/,
    "first contact with the tool begins with an untrue warning:\n" + r.stderr);
});

test("a backlog OUTSIDE a repository: the warning stays", () => {
  const dir = mkdtempSync(join(tmpdir(), "branchling-nogit-"));
  assert.equal(run(dir, ["init", "--dir", ".", "--no-example"]).status, 0);
  const r = run(dir, ["next-id", "--dir", "."]);
  assert.equal(r.status, 0);
  assert.match(r.stderr, /not in a git repository/,
    "the narrower source stopped speaking up — a number from one directory now looks exactly as trustworthy as one from a scan of every branch");
});

test("the warning does not claim there is no repository when there is one", () => {
  const dir = gitRepo();
  run(dir, ["init", "--dir", "./backlog", "--no-example"]);
  const err = run(dir, ["next-id", "--dir", "./backlog"]).stderr;
  assert.doesNotMatch(err, /poza repozytorium git/);
});
