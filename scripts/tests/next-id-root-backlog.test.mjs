/**
 * next-backlog-id.mjs — a backlog AT THE ROOT of a git repository (BL-1418).
 *
 * Found while writing the tests for BL-1417, separately from flag validation.
 * `BACKLOG_REL` computes the backlog path relative to the repository root
 * (`relative`) and rejects it when it is "invalid" (starting with `..`, outside
 * the repo). But `relative` returns an EMPTY STRING for the same directory, and
 * an empty string is falsy in JS, so the ternary confuses "the path is empty"
 * with "the path is invalid" and quietly substitutes the default
 * `'backlog'`. The script then looks for `<root>/backlog/tasks`, which does not
 * exist, because the tasks are in `<root>/tasks`.
 *
 * That is exactly the layout after `worktrail init --dir .` in a fresh repository,
 * where the backlog IS the whole repository — not a subdirectory of a larger
 * workspace. Both layouts have a test, so that fixing one does not break the other.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_TASK_ID_PREFIX as P } from "../task-id.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(HERE, "..");

function run(script, args, opts) {
  return spawnSync(process.execPath, [join(SCRIPTS, script)].concat(args), {
    encoding: "utf8", timeout: 30_000, ...opts,
  });
}

function vcs(cwd, ...args) {
  return execFileSync("git",
    ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf8" });
}

/** The backlog is the ROOT of the git repo — exactly `worktrail init --dir .`. */
function backlogAtRepoRoot() {
  const dir = mkdtempSync(join(tmpdir(), "worktrail-root-"));
  const r = run("init-backlog.mjs", ["--dir", dir]);
  assert.equal(r.status, 0, r.stderr);
  vcs(dir, "init", "-q", "-b", "main");
  writeFileSync(join(dir, "tasks", `${P}-1-x.md`), `id: ${P}-1\n`, "utf8");
  vcs(dir, "add", "-A");
  vcs(dir, "commit", "-qm", "seed");
  return dir;
}

/** The backlog in a SUBDIRECTORY of the repo — the other layout. A positive control. */
function backlogInSubdir() {
  const repoRoot = mkdtempSync(join(tmpdir(), "worktrail-sub-"));
  const dir = join(repoRoot, "backlog");
  const r = run("init-backlog.mjs", ["--dir", dir]);
  assert.equal(r.status, 0, r.stderr);
  vcs(repoRoot, "init", "-q", "-b", "main");
  writeFileSync(join(dir, "tasks", `${P}-1-x.md`), `id: ${P}-1\n`, "utf8");
  vcs(repoRoot, "add", "-A");
  vcs(repoRoot, "commit", "-qm", "seed");
  return dir;
}

test("backlog AT THE ROOT of a git repo: next-backlog-id finds the tasks and counts correctly", () => {
  const dir = backlogAtRepoRoot();
  try {
    const r = run("next-backlog-id.mjs", ["--dir", dir, "--explain"], { cwd: dir });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp("^maximum: " + P + "-1\\b", "m"), "it did not find the committed task 1");
    assert.match(r.stdout, /^2$/m, "the next number has to be 2");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("POSITIVE CONTROL: a backlog in a SUBDIRECTORY of the repo is untouched", () => {
  const dir = backlogInSubdir();
  try {
    const r = run("next-backlog-id.mjs", ["--dir", dir, "--explain"], { cwd: dir });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp("^maximum: " + P + "-1\\b", "m"));
    assert.match(r.stdout, /^2$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("backlog at the root: the number sees tasks from OTHER branches, not just the current one", () => {
  // The point of this script (see its own header): a union across every branch,
  // not "max+1 from this tree". Without the BACKLOG_REL fix that would never have
  // worked in the "backlog is the root" layout, because the first step (seeing
  // OUR OWN branch) would already have failed.
  const dir = backlogAtRepoRoot();
  try {
    vcs(dir, "checkout", "-q", "-b", "other");
    writeFileSync(join(dir, "tasks", `${P}-9-y.md`), `id: ${P}-9\n`, "utf8");
    vcs(dir, "add", "-A");
    vcs(dir, "commit", "-qm", "another branch");
    vcs(dir, "checkout", "-q", "main");

    const r = run("next-backlog-id.mjs", ["--dir", dir, "--explain"], { cwd: dir });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp("^maximum: " + P + "-9\\b", "m"), "it did not see the task from the other branch");
    assert.match(r.stdout, /^10$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("`worktrail new` in a repo whose backlog is the root does NOT warn about a local scan", () => {
  // The warning "NOTE: the number comes from a LOCAL scan" is meant to appear only
  // when next-backlog-id.mjs REALLY cannot scan the branches — not on every call
  // in this one, entirely ordinary repository layout.
  const dir = backlogAtRepoRoot();
  try {
    const r = run("new-task.mjs", ["--dir", dir, "--title", "Kolejny task"], { cwd: dir });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!/LOKALNEGO skanu/.test(r.stdout + r.stderr),
      "new-task.mjs fell back to the local scan despite an available repository");
    assert.ok(existsSync(join(dir, "tasks", `${P}-2-kolejny-task.md`)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
