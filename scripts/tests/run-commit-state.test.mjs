/**
 * `run --commit-state`: after each outcome the task file and its history are
 * committed, and nothing else (TL-489).
 *
 * WHAT HAPPENED. Loops in parallel worktrees of one clone left the claim
 * bookkeeping `next`, `done` and the park write — the task file and
 * `history/<ID>.jsonl` — uncommitted in each tree, and the wrapper's next merge
 * of the base branch failed on those two files.
 *
 * WHAT THIS FILE PINS DOWN. The commit holds exactly those two paths, whatever
 * else the hand left in the tree; a path somebody else staged stops the run
 * before the claim instead of being swept in; and without the flag no commit is
 * made — the POSITIVE CONTROL for the default TL-381 keeps with the caller.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { isolateHome, posixPath } from "./_repo.mjs";

isolateHome("run-commit-state");

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");
const RUN_ACTOR = "agent:worker";

let counter = 0;
function tmp(prefix) {
  return mkdtempSync(join(tmpdir(), "branchling-" + prefix + "-" + (counter++) + "-"));
}

function cli(args, env, opts = {}) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 120_000,
    env: { ...process.env, NO_COLOR: "1", ...(env || {}) },
    ...opts,
  });
}

function git(repo, args) {
  const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  assert.equal(r.status, 0, "git " + args.join(" ") + ": " + r.stderr);
  return r.stdout;
}

function taskFile(backlog, id) {
  return join(backlog, "tasks", readdirSync(join(backlog, "tasks")).find((f) => f.startsWith(id + "-")));
}

function statusOf(backlog, id) {
  return (readFileSync(taskFile(backlog, id), "utf8").match(/^status: ([a-z_]+)/m) || [])[1];
}

/** A committed repository with one task whose contract is "`<id>.done` exists". */
function fixture() {
  const dir = tmp("commit-state");
  const repo = join(dir, "repo");
  mkdirSync(repo, { recursive: true });
  git(repo, ["init", "-q"]);
  const backlog = join(repo, "backlog");
  const env = { BACKLOG_STATE_DIR: join(dir, "state") };
  assert.equal(cli(["init", "--dir", backlog, "--no-example"], env, { cwd: repo }).status, 0);
  const r = cli(["new", "--dir", backlog, "--title", "Task whose state is committed", "--priority", "P1"], env);
  assert.equal(r.status, 0, r.stderr);
  const id = (r.stdout.match(/([A-Z]+-\d+)/) || [])[1];
  const file = taskFile(backlog, id);
  writeFileSync(file, readFileSync(file, "utf8")
    .replace(/verification:[\s\S]*?\n---/,
      'verification:\n  - id: it-is-done\n    bash: "test -f ' + id + '.done"\n---')
    .replace(/\[proof:[^\]]*\]/g, "[proof: it-is-done]"), "utf8");
  cli(["build", "--dir", backlog], env);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "fixture"]);
  return { dir, repo, backlog, env, id, rel: "backlog/tasks/" + file.split(/[\\/]/).pop() };
}

function script(dir, name, body) {
  const p = join(dir, name);
  writeFileSync(p, "#!/bin/sh\n" + body + "\n", "utf8");
  chmodSync(p, 0o755);
  return posixPath(p);
}

/** Satisfies the contract and leaves a second, unrelated change in the tree. */
function worker(dir) {
  return script(dir, "agent.sh", [
    'id=$(grep -m1 "^id: " | sed "s/^id: //")',
    'touch "$id.done"',
    'echo "work of the hand" > notes.txt',
    'echo "worked $id"',
  ].join("\n"));
}

function commitsSinceFixture(repo) {
  return git(repo, ["rev-list", "--count", "HEAD^{/fixture}..HEAD"]).trim();
}

test("after a closed outcome only the task file and its history are committed", () => {
  const { dir, repo, backlog, env, id, rel } = fixture();
  try {
    const r = cli(["run", "--dir", backlog, "--actor", RUN_ACTOR, "--agent", worker(dir),
      "--max-attempts", "1", "--commit-state", "--json"], env, { cwd: repo });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const report = JSON.parse(r.stdout);
    assert.equal(report.tally.closed, 1, report.stopped);
    assert.equal(report.stateCommitRefused, null);
    const row = report.tasks.find((t) => t.id === id);
    assert.match(String(row.stateCommit), /^[0-9a-f]{40}$/, "no commit was reported for the outcome");
    assert.equal(git(repo, ["rev-parse", "HEAD"]).trim(), row.stateCommit);

    assert.equal(commitsSinceFixture(repo), "1", "one outcome, one commit");
    const files = git(repo, ["show", "--name-only", "--format=", "HEAD"]).split("\n").filter(Boolean).sort();
    assert.deepEqual(files, ["backlog/history/" + id + ".jsonl", rel].sort());
    assert.match(git(repo, ["log", "-1", "--format=%s"]), new RegExp("^" + id + " is done"));
    assert.equal(statusOf(backlog, id), "done");

    // The hand's work is the caller's and stays exactly where it was left.
    const status = git(repo, ["status", "--porcelain"]).split("\n").filter(Boolean).sort();
    assert.deepEqual(status, ["?? " + id + ".done", "?? notes.txt"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a parked outcome is committed the same way", () => {
  const { dir, repo, backlog, env, id, rel } = fixture();
  try {
    // Speaks and changes the tree, so it ran — but never satisfies the contract.
    const idle = script(dir, "idle.sh", 'echo "tried" > tried.txt\necho "could not finish"');
    const r = cli(["run", "--dir", backlog, "--actor", RUN_ACTOR, "--agent", idle,
      "--max-attempts", "1", "--commit-state", "--json"], env, { cwd: repo });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const report = JSON.parse(r.stdout);
    assert.equal(report.tally.blocked, 1, report.stopped);
    const files = git(repo, ["show", "--name-only", "--format=", "HEAD"]).split("\n").filter(Boolean).sort();
    assert.deepEqual(files, ["backlog/history/" + id + ".jsonl", rel].sort());
    assert.equal(git(repo, ["status", "--porcelain", "--", "backlog"]).trim(), "",
      "the park left task state uncommitted");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a path somebody else staged stops the run before anything is claimed", () => {
  const { dir, repo, backlog, env, id } = fixture();
  try {
    writeFileSync(join(repo, "staged.txt"), "the caller's half-made commit\n", "utf8");
    git(repo, ["add", "staged.txt"]);
    const before = readFileSync(taskFile(backlog, id), "utf8");
    const r = cli(["run", "--dir", backlog, "--actor", RUN_ACTOR, "--agent", worker(dir),
      "--commit-state", "--json"], env, { cwd: repo });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const report = JSON.parse(r.stdout);
    assert.match(report.stopped, /other paths are already staged: staged\.txt — nothing was claimed/, report.stopped);
    assert.deepEqual(report.stateCommitRefused, { id: null, message: "other paths are already staged: staged.txt" });
    assert.equal(report.tally.taken, 0);
    assert.equal(readFileSync(taskFile(backlog, id), "utf8"), before, "the task was claimed");
    assert.equal(commitsSinceFixture(repo), "0", "a commit was made over somebody else's staged path");
    assert.deepEqual(git(repo, ["diff", "--cached", "--name-only"]).split("\n").filter(Boolean), ["staged.txt"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a path the hand staged refuses the commit and stops the run", () => {
  const { dir, repo, backlog, env, id } = fixture();
  try {
    const stager = script(dir, "stager.sh", [
      'id=$(grep -m1 "^id: " | sed "s/^id: //")',
      'touch "$id.done"',
      'echo "work of the hand" > notes.txt',
      "git add notes.txt",
      'echo "worked $id"',
    ].join("\n"));
    const r = cli(["run", "--dir", backlog, "--actor", RUN_ACTOR, "--agent", stager,
      "--max-attempts", "1", "--commit-state", "--json"], env, { cwd: repo });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const report = JSON.parse(r.stdout);
    assert.equal(report.stateCommitRefused.id, id);
    assert.match(report.stopped, new RegExp("`--commit-state` did not commit " + id + ": other paths are already staged: notes\\.txt"));
    assert.equal(commitsSinceFixture(repo), "0", "the hand's staged path was swept into a state commit");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("outside a git work tree the flag is refused before the loop", () => {
  const dir = tmp("commit-state-nogit");
  try {
    const backlog = join(dir, "backlog");
    const env = { BACKLOG_STATE_DIR: join(dir, "state"), GIT_CEILING_DIRECTORIES: dir };
    assert.equal(cli(["init", "--dir", backlog, "--no-example"], env).status, 0);
    const r = cli(["run", "--dir", backlog, "--actor", RUN_ACTOR, "--agent", "true", "--commit-state"], env);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /`--commit-state` needs a git work tree/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("POSITIVE CONTROL: without the flag the run commits nothing", () => {
  const { dir, repo, backlog, env, id } = fixture();
  try {
    const r = cli(["run", "--dir", backlog, "--actor", RUN_ACTOR, "--agent", worker(dir),
      "--max-attempts", "1", "--json"], env, { cwd: repo });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const report = JSON.parse(r.stdout);
    assert.equal(report.tally.closed, 1);
    assert.equal(report.tasks[0].stateCommit, null);
    assert.equal(commitsSinceFixture(repo), "0");
    assert.match(git(repo, ["status", "--porcelain", "--", "backlog"]), new RegExp(id));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
