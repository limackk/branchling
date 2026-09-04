/**
 * Does `check` say when a task's state has not travelled with its branch? (TL-230)
 *
 * WHY THIS GUARD NEEDS A REAL REPOSITORY. Its question is `git show
 * HEAD:<path>`, so a fixture faking git would be a test of the fake. The
 * committed side has to be produced by an actual commit, and the diverging side
 * by an actual edit after it.
 *
 * THE FOUR THINGS THAT HAVE TO BE RULED OUT:
 *
 *   1. A REPORT NOBODY CAN ACT ON. Naming a count is not enough — the id and
 *      both sides of the disagreement are what a reader does something with.
 *   2. A GUARD THAT FAILS. An uncommitted state change is the NORMAL condition
 *      of a session still working, so the exit code has to be 0 while the report
 *      is printed. A non-zero here would fail every session mid-task.
 *   3. A DIVERGENCE INVENTED OUT OF AN ABSENCE. A task file git has never seen,
 *      and a backlog outside any repository, have no committed state to
 *      disagree with. Neither may be counted.
 *   4. A GUARD GREEN ON AN EMPTY SAMPLE. "0 diverged" over 0 files compared is
 *      not a pass; every green case here is paired with the change that turns
 *      it into a report.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { compareStates } from "../check-backlog-task-state-committed.mjs";

import { isolateHome } from "./_repo.mjs";

// The home is isolated for the whole file (TL-166): without it a test reads the
// developer's own configuration and the suite answers differently per machine.
isolateHome("task-state-committed");

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");

let counter = 0;
function tmp(prefix) {
  return mkdtempSync(join(tmpdir(), "branchling-" + prefix + "-" + (counter++) + "-"));
}

function run(args, cwd, env) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 30_000, input: "", cwd,
    env: env || { ...process.env, NO_COLOR: "1" },
  });
}

function git(cwd, args) {
  return spawnSync("git", args, {
    cwd, encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.com",
    },
  });
}

/** A real repository with a backlog and one task, nothing committed yet — each
 *  case decides what reaches a commit, because that decision IS the subject. */
function fixture() {
  const dir = tmp("taskstate");
  const backlog = join(dir, "backlog");
  const env = { ...process.env, NO_COLOR: "1", BACKLOG_STATE_DIR: join(dir, "state") };
  assert.equal(git(dir, ["init", "-q", "-b", "main"]).status, 0);
  assert.equal(run(["init", "--dir", backlog, "--no-example"], dir, env).status, 0);

  const created = run(["new", "--dir", backlog, "--title", "A task whose closing may be left behind"], dir, env);
  assert.equal(created.status, 0, created.stderr);
  const id = (created.stdout.match(/([A-Z]+-\d+)/) || [])[1];
  return { dir, backlog, env, id };
}

const check = (fx) => run(["check", "--task-state", "--dir", fx.backlog], fx.dir, fx.env);

function taskFile(fx) {
  const dir = join(fx.backlog, "tasks");
  const name = readdirSync(dir).find((f) => f.startsWith(fx.id + "-"));
  assert.ok(name, "the fixture wrote no task file");
  return join(dir, name);
}

/** Commit everything the fixture has, so there is a committed side to disagree
 *  with. */
function commitAll(fx, message) {
  assert.equal(git(fx.dir, ["add", "-A"]).status, 0);
  assert.equal(git(fx.dir, ["commit", "-q", "-m", message]).status, 0);
}

// ── the divergence is named ───────────────────────────────────────────────

test("a committed task closed only on disk is REPORTED, with both sides named", () => {
  const fx = fixture();
  commitAll(fx, "the task, as it was taken");
  // Exactly the measured situation: the code was committed, the closing was not.
  const file = taskFile(fx);
  writeFileSync(file, readFileSync(file, "utf8").replace(/^status: .*$/m, "status: done"), "utf8");

  const r = check(fx);
  // A REPORT, not a failure. `take` writes this state at the start of every
  // session, so a guard that failed here would fail all of them.
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(r.stdout.includes(fx.id), "the task a person has to commit is not named");
  assert.match(r.stdout, /at HEAD/);
  assert.match(r.stdout, /on disk/);
  assert.match(r.stdout, /done/);
});

test("…and the same repository is quiet once the closing is committed", () => {
  // The positive control: without it the assertion above could be satisfied by
  // a report that names every task unconditionally.
  const fx = fixture();
  commitAll(fx, "the task, as it was taken");
  const file = taskFile(fx);
  writeFileSync(file, readFileSync(file, "utf8").replace(/^status: .*$/m, "status: done"), "utf8");
  assert.match(check(fx).stdout, /differ from HEAD/, "the control: it reported first");

  commitAll(fx, "the closing, with the work");
  const r = check(fx);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /each one agrees/);
  // The counts are what tell a reader this looked at something. "0 diverged"
  // over 0 files compared is a report that read nothing.
  assert.match(r.stdout, /1 task file\(s\) compared with HEAD/);
});

test("`owner:` counts too — a task handed over on disk only looks free elsewhere", () => {
  const fx = fixture();
  commitAll(fx, "the task, unowned");
  assert.equal(run(["take", fx.id, "--dir", fx.backlog, "--actor", "local:me"], fx.dir, fx.env).status, 0);

  const r = check(fx);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /owner:/);
  assert.ok(r.stdout.includes("local:me"), "the owner on disk is not named");
});

// ── an absence is not a divergence ────────────────────────────────────────

test("a task file git has never seen produces no report", () => {
  const fx = fixture();
  // The config is committed so the repository HAS a HEAD; the task is not, so
  // it has no committed state at all.
  assert.equal(git(fx.dir, ["add", "backlog/config.yaml"]).status, 0);
  assert.equal(git(fx.dir, ["commit", "-q", "-m", "the configuration only"]).status, 0);
  const file = taskFile(fx);
  writeFileSync(file, readFileSync(file, "utf8").replace(/^status: .*$/m, "status: done"), "utf8");

  const r = check(fx);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /differ from HEAD/);
  // …and it says so with a zero it earned: nothing was compared, and the line
  // must not read like a comparison that passed.
  assert.match(r.stdout, /0 task file\(s\) compared with HEAD/);
});

test("a backlog outside any repository says so, rather than printing a tick", () => {
  const dir = tmp("nogit");
  const backlog = join(dir, "backlog");
  const env = { ...process.env, NO_COLOR: "1", BACKLOG_STATE_DIR: join(dir, "state") };
  assert.equal(run(["init", "--dir", backlog, "--no-example"], dir, env).status, 0);

  const r = run(["check", "--task-state", "--dir", backlog], dir, env);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /not a git repository/);
  assert.doesNotMatch(r.stdout, /compared with HEAD/);
});

// ── the comparison itself, without a repository ───────────────────────────

test("compareStates counts only pairs that have a committed side", () => {
  const { diverged, compared } = compareStates([
    { id: "A-1", path: "a.md", tree: { status: "done", owner: "" }, head: { status: "pending", owner: "" } },
    { id: "A-2", path: "b.md", tree: { status: "done", owner: "" }, head: { status: "done", owner: "" } },
    { id: "A-3", path: "c.md", tree: { status: "done", owner: "" }, head: null },
  ]);
  assert.equal(compared, 2, "a file with no committed side was counted as compared");
  assert.deepEqual(diverged.map((d) => d.id), ["A-1"]);
  assert.deepEqual(diverged[0].fields, ["status"]);
});
