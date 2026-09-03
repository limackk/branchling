/**
 * The stuck-status write never overwrites an archived status (TL-191).
 *
 * WHAT HAPPENED. A run handed out TL-183, the agent did the work and closed it
 * with `done` (the contract ran and passed), the loop's own `done` was refused
 * as already-closed, and after the last attempt the loop wrote `status: blocked`
 * over work that was proven, committed and merged. The history now carries a
 * `done → blocked` transition that should never have been possible.
 *
 * WHAT THIS FILE RULES OUT. That the fix is a fix for ONE way of arriving at
 * that write. The guard is at the write itself: the file is re-read, and an
 * archived status stops it whatever the refusal was. So the fixture makes the
 * agent close the task itself — the cheapest way to have the task archived
 * between the take and the write — and then asserts on the TREE, not on the
 * loop's opinion of it.
 *
 * THE POSITIVE CONTROL is `writeStatus` on a task that is NOT archived, in the
 * same file: without it a guard that refused every write would pass here.
 *
 * AND THE SECOND REFUSAL AT THE SAME WRITE (TL-192). The re-read that answers
 * "is this closed" also answers "is this still ours": a task whose `owner:` no
 * longer names the run is not the run's to park either. It is a different
 * refusal, not a wider one — nothing proven is destroyed, the work is simply
 * somebody else's now — so the fixture below hands the task on and asserts that
 * the report says HELD elsewhere rather than closed, and names who holds it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { writeStatus } from "../run-loop.mjs";
import { loadConfig } from "../config.mjs";

import { isolateHome } from "./_repo.mjs";

isolateHome("run-stuck-status");

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");

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

/** One task whose contract is "the file `<id>.done` exists in the repository
 *  root" — a contract a shell script can satisfy, which is what keeps the agent
 *  in this test as replaceable as the design says it is. */
function fixture() {
  const dir = tmp("stuck");
  const repo = join(dir, "repo");
  mkdirSync(repo, { recursive: true });
  const backlog = join(repo, "backlog");
  const env = { BACKLOG_STATE_DIR: join(dir, "state") };
  assert.equal(cli(["init", "--dir", backlog, "--no-example"], env).status, 0);

  // The vocabulary this project uses for people (third law): `handoff` checks
  // `--to-owner` against it, so a fixture that hands work to somebody has to say
  // who that somebody is. Nothing in the code knows this value.
  const cfg = join(backlog, "config.yaml");
  writeFileSync(cfg, readFileSync(cfg, "utf8")
    .replace(/^owners:.*$/m, "owners: [unassigned, user:someone]"), "utf8");

  const r = cli(["new", "--dir", backlog, "--title", "Task the agent closes itself", "--priority", "P1"], env);
  assert.equal(r.status, 0, r.stderr);
  const id = (r.stdout.match(/([A-Z]+-\d+)/) || [])[1];
  const file = taskFile(backlog, id);
  writeFileSync(file, readFileSync(file, "utf8")
    .replace(/verification:[\s\S]*?\n---/,
      'verification:\n  - id: it-is-done\n    bash: "test -f ' + id + '.done"\n---')
    .replace(/\[proof:[^\]]*\]/g, "[proof: it-is-done]"), "utf8");
  cli(["build", "--dir", backlog], env);
  return { dir, repo, backlog, env, id };
}

function taskFile(backlog, id) {
  return join(backlog, "tasks", readdirSync(join(backlog, "tasks")).find((f) => f.startsWith(id + "-")));
}

function statusOf(backlog, id) {
  return (readFileSync(taskFile(backlog, id), "utf8").match(/^status: ([a-z_]+)/m) || [])[1];
}

function ownerOf(backlog, id) {
  return (readFileSync(taskFile(backlog, id), "utf8").match(/^owner: (.*)$/m) || [])[1];
}

function history(backlog, id) {
  const f = join(backlog, "history", id + ".jsonl");
  if (!existsSync(f)) return [];
  return readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

function agentScript(dir, name, body) {
  const p = join(dir, name);
  writeFileSync(p, "#!/bin/sh\n" + body + "\n", "utf8");
  chmodSync(p, 0o755);
  return p;
}

function cleanup(...dirs) {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

test("a task the agent closed itself is NOT written over by the stuck status", () => {
  const { dir, repo, backlog, env, id } = fixture();
  try {
    // The agent satisfies the contract and then closes the task through the very
    // gate the loop would have used. The loop's own `done` is refused after
    // that, which is the path into the stuck-status write.
    const agent = agentScript(dir, "closer.sh", [
      'id=$(grep -m1 "^id: " | sed "s/^id: //")',
      'touch "$id.done"',
      process.execPath + ' ' + JSON.stringify(CLI) +
        ' done "$id" --dir ' + JSON.stringify(backlog) + ' --actor user:someone >/dev/null 2>&1',
    ].join("\n"));

    const r = cli(["run", "--dir", backlog, "--actor", "agent:worker", "--agent", agent,
      "--max-attempts", "1", "--json"], env, { cwd: repo });
    assert.equal(r.status, 0, r.stdout + r.stderr);

    // THE TREE FIRST. Whatever the run decided to say, the fact the gate proved
    // has to still be in the file.
    assert.equal(statusOf(backlog, id), "done",
      "the run wrote over a status the project counts as archived");

    // And no second status change from the run: the write was refused, not made
    // and undone.
    const written = history(backlog, id).filter((e) => e.source === "run" && e.field === "status");
    assert.equal(written.length, 0, "the run recorded a status change it must not have made");

    const report = JSON.parse(r.stdout);
    assert.equal(report.tally.blocked, 0, "the report called a closed task blocked");
    assert.equal(report.tally.closedElsewhere, 1, "the report does not count the task as closed elsewhere");
    const row = report.tasks.find((t) => t.id === id);
    assert.equal(row.outcome, "closed-elsewhere");
    assert.equal(row.status, "done", "the report does not say which status was found");
  } finally {
    cleanup(dir);
  }
});

test("the same run, read on the terminal, does not call it blocked", () => {
  const { dir, repo, backlog, env, id } = fixture();
  try {
    const agent = agentScript(dir, "closer.sh", [
      'id=$(grep -m1 "^id: " | sed "s/^id: //")',
      'touch "$id.done"',
      process.execPath + ' ' + JSON.stringify(CLI) +
        ' done "$id" --dir ' + JSON.stringify(backlog) + ' --actor user:someone >/dev/null 2>&1',
    ].join("\n"));

    const r = cli(["run", "--dir", backlog, "--actor", "agent:worker", "--agent", agent,
      "--max-attempts", "1"], env, { cwd: repo });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /0 blocked/, "the terminal report counted a blocked task");
    assert.match(r.stdout, /1 closed elsewhere/, "the terminal report is silent about what happened");
    assert.match(r.stdout, new RegExp(id + "\\s+closed-elsewhere"));
  } finally {
    cleanup(dir);
  }
});

test("POSITIVE CONTROL: the same write still lands on a task that is NOT archived", () => {
  // Without this, a `writeStatus` that refused everything would pass above.
  const { dir, backlog, env, id } = fixture();
  try {
    assert.equal(cli(["take", id, "--dir", backlog, "--actor", "agent:worker"], env).status, 0);
    const config = loadConfig(backlog);
    const done = writeStatus({
      root: backlog, config, id, actor: "agent:worker",
      reason: "1 agent attempt, and the contract did not pass", status: "blocked",
    });
    assert.equal(done.ok, true, done.message);
    assert.equal(statusOf(backlog, id), "blocked");
  } finally {
    cleanup(dir);
  }
});

test("the guard reads `archived_statuses`, not the word `done`", () => {
  // The vocabulary is the project's (third law). A backlog whose archived set
  // names a status of its own has to be protected by the same guard, and one
  // that does NOT archive `done` must not be.
  const { dir, backlog, env, id } = fixture();
  try {
    // Claimed first: this test is about WHICH statuses stop the write, so the
    // task has to be one the run may write to at all (TL-192).
    assert.equal(cli(["take", id, "--dir", backlog, "--actor", "agent:worker"], env).status, 0);
    const cfg = join(backlog, "config.yaml");
    writeFileSync(cfg, readFileSync(cfg, "utf8")
      .replace(/^statuses:.*$/m, "statuses: [pending, in_progress, blocked, done, cancelled, shipped]")
      .replace(/^archived_statuses:.*$/m, "archived_statuses: [shipped, cancelled]"), "utf8");
    const config = loadConfig(backlog);

    const file = taskFile(backlog, id);
    writeFileSync(file, readFileSync(file, "utf8").replace(/^status: .*$/m, "status: shipped"), "utf8");
    const refused = writeStatus({
      root: backlog, config, id, actor: "agent:worker", reason: "1 agent attempt", status: "blocked",
    });
    assert.equal(refused.ok, false);
    assert.equal(refused.reason, "closed-elsewhere");
    assert.equal(refused.status, "shipped");
    assert.equal(statusOf(backlog, id), "shipped");

    // `done` is not archived in THIS backlog, so nothing here may protect it.
    writeFileSync(file, readFileSync(file, "utf8").replace(/^status: .*$/m, "status: done"), "utf8");
    const written = writeStatus({
      root: backlog, config, id, actor: "agent:worker", reason: "1 agent attempt", status: "blocked",
    });
    assert.equal(written.ok, true, "the guard named `done` in the code instead of reading the vocabulary");
    assert.equal(statusOf(backlog, id), "blocked");
  } finally {
    cleanup(dir);
  }
});

test("a task handed on while the run worked is NOT parked by that run", () => {
  const { dir, repo, backlog, env, id } = fixture();
  try {
    // The agent does the one thing this test is about: it hands the task to a
    // person and leaves the contract unsatisfied. That is a LEGITIMATE act — the
    // agent judged the work needs somebody — and it is exactly the case where
    // the loop, one line later, would write `blocked` and a reason about its own
    // agents over work that is now theirs.
    const agent = agentScript(dir, "hander.sh", [
      'id=$(grep -m1 "^id: " | sed "s/^id: //")',
      process.execPath + " " + JSON.stringify(CLI) +
        ' handoff "$id" --dir ' + JSON.stringify(backlog) +
        ' --actor agent:worker --to-owner user:someone --reason "a person has to decide this one"',
    ].join("\n"));

    const r = cli(["run", "--dir", backlog, "--actor", "agent:worker", "--agent", agent,
      "--max-attempts", "1", "--json"], env, { cwd: repo });
    assert.equal(r.status, 0, r.stdout + r.stderr);

    // THE TREE FIRST, as above: the claim the agent handed over is still theirs.
    assert.equal(ownerOf(backlog, id), "user:someone",
      "the run wrote over a task somebody else now holds");
    assert.notEqual(statusOf(backlog, id), "blocked",
      "the run parked a task it no longer held");

    // Not "wrote and undid it": the write never happened. `handoff` is the only
    // source entitled to have moved this task after the take.
    const written = history(backlog, id).filter((e) => e.source === "run" && e.field === "status");
    assert.equal(written.length, 0, "the run recorded a status change it must not have made");

    const report = JSON.parse(r.stdout);
    assert.equal(report.tally.blocked, 0, "the report called somebody else's task blocked");
    assert.equal(report.tally.closedElsewhere, 0,
      "the report says the task was finished, when it was only handed on");
    assert.equal(report.tally.heldElsewhere, 1, "the report does not count the task as held elsewhere");
    const row = report.tasks.find((t) => t.id === id);
    assert.equal(row.outcome, "held-elsewhere");
    assert.match(String(row.detail), /user:someone/, "the report does not say who holds it");
  } finally {
    cleanup(dir);
  }
});

test("the terminal report tells `held elsewhere` from `closed elsewhere`", () => {
  const { dir, repo, backlog, env, id } = fixture();
  try {
    const agent = agentScript(dir, "hander.sh", [
      'id=$(grep -m1 "^id: " | sed "s/^id: //")',
      process.execPath + " " + JSON.stringify(CLI) +
        ' handoff "$id" --dir ' + JSON.stringify(backlog) +
        ' --actor agent:worker --to-owner user:someone --reason "a person has to decide this one"',
    ].join("\n"));

    const r = cli(["run", "--dir", backlog, "--actor", "agent:worker", "--agent", agent,
      "--max-attempts", "1"], env, { cwd: repo });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /0 blocked/, "the terminal report counted a blocked task");
    assert.match(r.stdout, /1 held elsewhere/, "the terminal report is silent about what happened");
    assert.doesNotMatch(r.stdout, /closed elsewhere/,
      "the terminal report calls a task that was handed on a task that was closed");
    assert.match(r.stdout, new RegExp(id + "\\s+held-elsewhere"));
  } finally {
    cleanup(dir);
  }
});

test("the owner guard: nobody holding it is not us either, and archived answers first", () => {
  const { dir, backlog, env, id } = fixture();
  try {
    assert.equal(cli(["take", id, "--dir", backlog, "--actor", "agent:worker"], env).status, 0);
    const config = loadConfig(backlog);
    const file = taskFile(backlog, id);
    const setOwner = (v) => writeFileSync(file, readFileSync(file, "utf8")
      .replace(/^owner: .*$/m, "owner: " + v), "utf8");

    // Somebody took it over: refused, and the refusal names them, because that
    // is the reader's next question.
    setOwner("user:someone");
    const taken = writeStatus({
      root: backlog, config, id, actor: "agent:worker", reason: "1 agent attempt", status: "blocked",
    });
    assert.equal(taken.ok, false);
    assert.equal(taken.reason, "held-elsewhere");
    assert.equal(taken.owner, "user:someone");
    assert.equal(statusOf(backlog, id), "in_progress");

    // A cleared owner — what `handoff --to-role` leaves behind — is refused by
    // the same line. Nobody is not us.
    setOwner('""');
    const nobody = writeStatus({
      root: backlog, config, id, actor: "agent:worker", reason: "1 agent attempt", status: "blocked",
    });
    assert.equal(nobody.ok, false);
    assert.equal(nobody.reason, "held-elsewhere");
    assert.equal(nobody.owner, "");

    // ORDER MATTERS. A task that was taken over AND closed is reported as
    // closed: "somebody finished it" is the stronger fact of the two, and the
    // one whose outcome reads as an ok.
    setOwner("user:someone");
    writeFileSync(file, readFileSync(file, "utf8").replace(/^status: .*$/m, "status: done"), "utf8");
    const closed = writeStatus({
      root: backlog, config, id, actor: "agent:worker", reason: "1 agent attempt", status: "blocked",
    });
    assert.equal(closed.ok, false);
    assert.equal(closed.reason, "closed-elsewhere");
  } finally {
    cleanup(dir);
  }
});
