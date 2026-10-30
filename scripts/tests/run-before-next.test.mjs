/**
 * `run --before-next <cmd>`: a gate that says no stops the run BEFORE a claim
 * (TL-489).
 *
 * WHAT HAPPENED. Three loops, one per worktree of one clone, each driven by a
 * wrapper that paused every loop on any failure. A pause noticed only after
 * `next` had claimed left a claim and its give-back in the tree, and the next
 * merge of the base branch failed on exactly those two files — which paused
 * every loop again. The gate is asked before `next`, so a refusal costs the
 * tree nothing.
 *
 * WHAT THIS FILE PINS DOWN. That a failing gate leaves the task file, its
 * history and the reservation exactly as they were, and that the report says
 * why the run stopped. The POSITIVE CONTROL is the same fixture with a gate
 * that passes: without it, a gate that stopped every run would pass the first
 * test. The third test is the one a wrapper meets: the gate passes once, the
 * task is worked, and the SECOND call refuses — nothing more is claimed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { isolateHome, posixPath } from "./_repo.mjs";

isolateHome("run-before-next");

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

function taskFile(backlog, id) {
  return join(backlog, "tasks", readdirSync(join(backlog, "tasks")).find((f) => f.startsWith(id + "-")));
}

function statusOf(backlog, id) {
  return (readFileSync(taskFile(backlog, id), "utf8").match(/^status: ([a-z_]+)/m) || [])[1];
}

function historyText(backlog, id) {
  const f = join(backlog, "history", id + ".jsonl");
  return existsSync(f) ? readFileSync(f, "utf8") : "";
}

/** Tasks whose contract is "the file `<id>.done` exists in the repository root". */
function fixture(titles) {
  const dir = tmp("before-next");
  const repo = join(dir, "repo");
  mkdirSync(repo, { recursive: true });
  const backlog = join(repo, "backlog");
  const env = { BACKLOG_STATE_DIR: join(dir, "state") };
  assert.equal(cli(["init", "--dir", backlog, "--no-example"], env).status, 0);
  const ids = [];
  for (const title of titles) {
    const r = cli(["new", "--dir", backlog, "--title", title, "--priority", "P1"], env);
    assert.equal(r.status, 0, r.stderr);
    const id = (r.stdout.match(/([A-Z]+-\d+)/) || [])[1];
    const file = taskFile(backlog, id);
    writeFileSync(file, readFileSync(file, "utf8")
      .replace(/verification:[\s\S]*?\n---/,
        'verification:\n  - id: it-is-done\n    bash: "test -f ' + id + '.done"\n---')
      .replace(/\[proof:[^\]]*\]/g, "[proof: it-is-done]"), "utf8");
    ids.push(id);
  }
  cli(["build", "--dir", backlog], env);
  return { dir, repo, backlog, env, ids };
}

function script(dir, name, body) {
  const p = join(dir, name);
  writeFileSync(p, "#!/bin/sh\n" + body + "\n", "utf8");
  chmodSync(p, 0o755);
  return posixPath(p);
}

/** An agent that satisfies the contract and leaves the closing to the run. */
function worker(dir) {
  return script(dir, "agent.sh", [
    'id=$(grep -m1 "^id: " | sed "s/^id: //")',
    'touch "$id.done"',
    'echo "worked $id"',
  ].join("\n"));
}

test("a failing gate stops the run before anything is claimed", () => {
  const { dir, repo, backlog, env, ids: [id] } = fixture(["Task the gate keeps"]);
  try {
    const before = readFileSync(taskFile(backlog, id), "utf8");
    const historyBefore = historyText(backlog, id);
    const gate = script(dir, "gate.sh", "echo 'paused by the wrapper' >&2\nexit 7");
    const r = cli(["run", "--dir", backlog, "--actor", RUN_ACTOR, "--agent", worker(dir),
      "--before-next", gate, "--json"], env, { cwd: repo });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const report = JSON.parse(r.stdout);

    assert.match(report.stopped, /`--before-next` exited 7 — nothing was claimed/, report.stopped);
    assert.equal(report.beforeNextRefused.exit, 7);
    assert.equal(report.beforeNextRefused.command, gate);
    assert.match(String(report.beforeNextRefused.output), /paused by the wrapper/);
    assert.equal(report.tally.taken, 0);

    // THE TREE: not a byte of the task or its history moved.
    assert.equal(readFileSync(taskFile(backlog, id), "utf8"), before, "the task file was written");
    assert.equal(historyText(backlog, id), historyBefore, "a claim or a give-back reached the history");
    assert.equal(statusOf(backlog, id), "pending");
    assert.ok(!existsSync(join(repo, id + ".done")), "the agent ran although the gate refused");
    // And no reservation is left behind: another actor is handed the task.
    const other = cli(["next", "--dir", backlog, "--actor", "agent:other", "--json"], env);
    assert.equal(other.status, 0, other.stdout + other.stderr);
    assert.equal(JSON.parse(other.stdout).id, id);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the terminal report names the gate as the reason", () => {
  const { dir, repo, backlog, env } = fixture(["Task the gate keeps"]);
  try {
    const gate = script(dir, "gate.sh", "exit 3");
    const r = cli(["run", "--dir", backlog, "--actor", RUN_ACTOR, "--agent", worker(dir),
      "--before-next", gate], env, { cwd: repo });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /stopped: `--before-next` exited 3 — nothing was claimed/);
    assert.match(r.stdout, /nothing was taken/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("POSITIVE CONTROL: a gate that passes lets the run work the queue", () => {
  const { dir, repo, backlog, env, ids: [id] } = fixture(["Task the gate lets through"]);
  try {
    const marker = join(dir, "calls");
    const gate = script(dir, "gate.sh", "echo x >> " + JSON.stringify(posixPath(marker)) + "\nexit 0");
    const r = cli(["run", "--dir", backlog, "--actor", RUN_ACTOR, "--agent", worker(dir),
      "--before-next", gate, "--json"], env, { cwd: repo });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const report = JSON.parse(r.stdout);
    assert.equal(report.stopped, "the queue is empty");
    assert.equal(report.beforeNextRefused, null);
    assert.equal(report.tally.closed, 1);
    assert.equal(statusOf(backlog, id), "done");
    // Asked before EVERY `next`: once for the task, once for the empty answer.
    assert.equal(readFileSync(marker, "utf8").split("\n").filter(Boolean).length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a gate that refuses on its second call ends the run after the first task", () => {
  const { dir, repo, backlog, env, ids: [first, second] } = fixture(["First task", "Second task"]);
  try {
    const marker = posixPath(join(dir, "calls"));
    const gate = script(dir, "gate.sh", [
      "if [ -f " + JSON.stringify(marker) + " ]; then exit 1; fi",
      "touch " + JSON.stringify(marker),
    ].join("\n"));
    const r = cli(["run", "--dir", backlog, "--actor", RUN_ACTOR, "--agent", worker(dir),
      "--before-next", gate, "--json"], env, { cwd: repo });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const report = JSON.parse(r.stdout);
    assert.equal(report.tally.taken, 1);
    assert.match(report.stopped, /`--before-next` exited 1 — nothing was claimed/);
    const worked = report.tasks[0].id;
    const left = worked === first ? second : first;
    assert.equal(statusOf(backlog, worked), "done");
    assert.equal(statusOf(backlog, left), "pending", "the task after the refusal was claimed");
    assert.equal(historyText(backlog, left).includes(RUN_ACTOR), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("`--before-next` and `--commit-state` are refused under `--dry-run`", () => {
  const r = cli(["run", "--dry-run", "--before-next", "true"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /`--dry-run` claims nothing/);
  const missing = cli(["run", "--before-next"]);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /`--before-next` with no value/);
});
