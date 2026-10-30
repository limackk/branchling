/**
 * A run whose queue is held in other trees says so, and `--wait` keeps it in
 * the foreground until a task is free (TL-491).
 *
 * WHAT HAPPENED. Three loops, one per worktree of one clone. Every pass ended
 * with `stopped: the queue is empty` while the other loops held the remaining
 * tasks, so the supervisor relaunched `run` every five minutes under a new
 * actor. `next --json` already named the held tasks in `skippedElsewhere`;
 * the run threw that away and printed the empty-queue sentence.
 *
 * THE FIXTURE. A second worktree of the same clone claims the task, which is
 * exactly the observation the cross-tree scan makes of a parallel loop. The
 * release that frees it is made by the `--before-next` gate on a chosen call,
 * so "a task is freed while the run waits" happens at a known poll rather than
 * after a sleep a loaded machine may outrun. `--wait 1` keeps the interval to
 * a second.
 *
 * THE POSITIVE CONTROLS. A queue that is merely empty still stops at once under
 * `--wait` (a wait with nothing to wait for would hang an unattended loop), and
 * `--wait-max` ends a wait nothing answers, with the reason.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { isolateHome, posixPath } from "./_repo.mjs";

isolateHome("run-wait");

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");
const RUN_ACTOR = "agent:worker";
const OTHER_ACTOR = "agent:other";

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

function git(cwd, args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, "git " + args.join(" ") + ": " + r.stderr);
  return r.stdout;
}

function taskFile(backlog, id) {
  return join(backlog, "tasks", readdirSync(join(backlog, "tasks")).find((f) => f.startsWith(id + "-")));
}

function statusOf(backlog, id) {
  return (readFileSync(taskFile(backlog, id), "utf8").match(/^status: ([a-z_]+)/m) || [])[1];
}

/**
 * A committed clone with one task, and a second worktree in which another
 * actor has claimed it. `held: false` leaves the claim out — the empty queue.
 */
function fixture({ held = true } = {}) {
  const dir = tmp("wait");
  const repo = join(dir, "repo");
  mkdirSync(repo, { recursive: true });
  git(repo, ["init", "-q"]);
  const backlog = join(repo, "backlog");
  const env = { BACKLOG_STATE_DIR: join(dir, "state") };
  assert.equal(cli(["init", "--dir", backlog, "--no-example"], env, { cwd: repo }).status, 0);
  const cfg = join(backlog, "config.yaml");
  writeFileSync(cfg, readFileSync(cfg, "utf8")
    .replace(/^owners:.*$/m, "owners: [unassigned, " + RUN_ACTOR + ", " + OTHER_ACTOR + "]"), "utf8");
  const r = cli(["new", "--dir", backlog, "--title", "Task another tree holds", "--priority", "P1"], env);
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
  const other = join(dir, "other");
  git(repo, ["worktree", "add", "-q", "-b", "other", other]);
  const otherBacklog = join(other, "backlog");
  if (held) {
    const took = cli(["take", id, "--dir", otherBacklog, "--actor", OTHER_ACTOR], env);
    assert.equal(took.status, 0, took.stdout + took.stderr);
  }
  return { dir, repo, backlog, otherBacklog, env, id };
}

function script(dir, name, body) {
  const p = join(dir, name);
  writeFileSync(p, "#!/bin/sh\n" + body + "\n", "utf8");
  chmodSync(p, 0o755);
  return posixPath(p);
}

function worker(dir) {
  return script(dir, "agent.sh", [
    'id=$(grep -m1 "^id: " | sed "s/^id: //")',
    'touch "$id.done"',
    'echo "worked $id"',
  ].join("\n"));
}

/** A gate that releases the other tree's claim on its `on`-th call. */
function releasingGate(dir, otherBacklog, env, id, on) {
  const calls = posixPath(join(dir, "calls"));
  return script(dir, "gate.sh", [
    "echo x >> " + JSON.stringify(calls),
    "n=$(wc -l < " + JSON.stringify(calls) + " | tr -d ' ')",
    'if [ "$n" -eq ' + on + " ]; then",
    "  BACKLOG_STATE_DIR=" + JSON.stringify(posixPath(env.BACKLOG_STATE_DIR)) + " " +
      JSON.stringify(posixPath(process.execPath)) + " " + JSON.stringify(posixPath(CLI)) +
      " release " + id + " --dir " + JSON.stringify(posixPath(otherBacklog)) +
      " --actor " + OTHER_ACTOR + ' --reason "the other loop paused" >/dev/null 2>&1 || exit 9',
    "fi",
  ].join("\n"));
}

test("a run stopped by a queue held elsewhere counts what is held, and where it is not empty", () => {
  const { dir, repo, backlog, env, id } = fixture();
  try {
    const r = cli(["run", "--dir", backlog, "--actor", RUN_ACTOR, "--agent", worker(dir), "--json"], env, { cwd: repo });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const report = JSON.parse(r.stdout);
    assert.notEqual(report.stopped, "the queue is empty", "the held task was reported as an empty queue");
    assert.match(report.stopped, /every eligible task is held in another tree of this clone — 1 task\(s\)/, report.stopped);
    assert.deepEqual(report.heldInOtherTrees, { count: 1, ids: [id] });
    assert.equal(report.waited, null, "a run without --wait reported a wait");
    assert.equal(statusOf(backlog, id), "pending");

    const text = cli(["run", "--dir", backlog, "--actor", RUN_ACTOR, "--agent", worker(dir)], env, { cwd: repo });
    assert.match(text.stdout, new RegExp("stopped: every eligible task is held in another tree of this clone — 1 task\\(s\\): " + id));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("`--wait` resumes when the other tree releases the task", () => {
  const { dir, repo, backlog, otherBacklog, env, id } = fixture();
  try {
    // Call 1 finds the task held and the run waits; call 2 frees it first.
    const gate = releasingGate(dir, otherBacklog, env, id, 2);
    const r = cli(["run", "--dir", backlog, "--actor", RUN_ACTOR, "--agent", worker(dir),
      "--before-next", gate, "--wait", "1", "--wait-max", "60", "--json"], env, { cwd: repo });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const report = JSON.parse(r.stdout);
    assert.equal(report.tally.closed, 1, report.stopped);
    assert.equal(report.tasks[0].id, id);
    assert.equal(statusOf(backlog, id), "done");
    assert.equal(report.stopped, "the queue is empty");
    assert.equal(report.waited.polls, 1, "the run did not wait exactly once before the task was freed");
    assert.equal(report.waited.gaveUp, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("`--wait-max` ends a wait nothing answers, with the reason", () => {
  const { dir, repo, backlog, env, id } = fixture();
  try {
    const r = cli(["run", "--dir", backlog, "--actor", RUN_ACTOR, "--agent", worker(dir),
      "--wait", "1", "--wait-max", "2", "--json"], env, { cwd: repo });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const report = JSON.parse(r.stdout);
    assert.equal(report.tally.taken, 0);
    assert.match(report.stopped, /held in another tree of this clone — 1 task\(s\)/, report.stopped);
    assert.match(report.stopped, /waited 2s \(--wait-max\) and nothing was freed/, report.stopped);
    assert.equal(report.waited.gaveUp, true);
    assert.ok(report.waited.polls >= 1);
    assert.deepEqual(report.heldInOtherTrees, { count: 1, ids: [id] });
    assert.equal(statusOf(backlog, id), "pending");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("POSITIVE CONTROL: a queue that is merely empty stops at once under `--wait`", () => {
  const { dir, repo, backlog, env } = fixture({ held: false });
  try {
    const r = cli(["run", "--dir", backlog, "--actor", RUN_ACTOR, "--agent", worker(dir),
      "--wait", "30", "--json"], env, { cwd: repo });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const report = JSON.parse(r.stdout);
    assert.equal(report.tally.closed, 1);
    assert.equal(report.stopped, "the queue is empty");
    assert.equal(report.waited.polls, 0, "the run waited with nothing held anywhere");
    assert.deepEqual(report.heldInOtherTrees, { count: 0, ids: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("`--wait-max` needs `--wait`, and both take whole seconds", () => {
  const alone = cli(["run", "--wait-max", "10"]);
  assert.equal(alone.status, 2);
  assert.match(alone.stderr, /`--wait-max` bounds `--wait`/);
  const bad = cli(["run", "--wait", "0.5"]);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /`--wait 0\.5` is not a positive whole number/);
  const dry = cli(["run", "--dry-run", "--wait", "5"]);
  assert.equal(dry.status, 2);
  assert.match(dry.stderr, /`--dry-run` claims nothing/);
});
