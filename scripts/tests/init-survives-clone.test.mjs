/**
 * A backlog committed straight after `init` is found in a clone (TL-477).
 *
 * git carries files, not directories. `init` used to leave `tasks/` and
 * `history/` empty, so the commit carried neither, and in a clone detection —
 * which requires `tasks/` — answered "no backlog here". The test goes through a
 * real commit and a real clone, because only git decides what survives.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { KEEP_FILE, KEPT_DIRS } from "../init-backlog.mjs";
import { isolateHome, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("init-survives-clone");

const CLI = join(SCRIPTS_DIR, "cli.mjs");

function git(cwd, args) {
  const r = spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", ...args],
    { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, "git " + args.join(" ") + ": " + r.stderr);
}

function cli(cwd, args, env = {}) {
  return spawnSync(process.execPath, [CLI, ...args],
    { cwd, encoding: "utf8", timeout: 60_000, env: { ...process.env, ...env } });
}

/** init, commit everything, clone; returns the clone. */
function initCommitClone(...initFlags) {
  const base = mkdtempSync(join(tmpdir(), "branchling-clone-"));
  const origin = join(base, "origin");
  git(base, ["init", "-q", origin]);
  const r = cli(origin, ["init", "--dir", "backlog", ...initFlags]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  git(origin, ["add", "-A"]);
  git(origin, ["commit", "-q", "--no-verify", "-m", "init"]);
  const clone = join(base, "clone");
  git(base, ["clone", "-q", origin, clone]);
  return { base, clone };
}

test("a fresh backlog with no task survives the clone, and takes its first task there", () => {
  const { base, clone } = initCommitClone("--no-example");
  for (const sub of KEPT_DIRS) {
    assert.ok(existsSync(join(clone, "backlog", sub)), sub + "/ did not survive the clone");
  }
  const doctor = cli(clone, ["doctor"]);
  assert.equal(doctor.status, 0, "doctor in the clone: " + doctor.stdout + doctor.stderr);
  const created = cli(clone, ["new", "--title", "The first task"], { BACKLOG_STATE_DIR: join(base, "state") });
  assert.equal(created.status, 0, "new in the clone: " + created.stdout + created.stderr);
});

test("positive control: without the placeholder the clone really loses tasks/", () => {
  const base = mkdtempSync(join(tmpdir(), "branchling-clone-control-"));
  const origin = join(base, "origin");
  git(base, ["init", "-q", origin]);
  assert.equal(cli(origin, ["init", "--dir", "backlog", "--no-example"]).status, 0);
  for (const sub of KEPT_DIRS) rmSync(join(origin, "backlog", sub, KEEP_FILE));
  git(origin, ["add", "-A"]);
  git(origin, ["commit", "-q", "--no-verify", "-m", "init"]);
  const clone = join(base, "clone");
  git(base, ["clone", "-q", origin, clone]);
  assert.ok(!existsSync(join(clone, "backlog", "tasks")), "the control proves nothing: git kept an empty directory");
  assert.notEqual(cli(clone, ["doctor"]).status, 0, "the control proves nothing: the clone was found anyway");
});

test("a placeholder is not counted as a task", () => {
  const { clone } = initCommitClone("--no-example");
  const r = cli(clone, ["query", "--count"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^0\b/m, "the placeholder was read as a task: " + r.stdout);
});
