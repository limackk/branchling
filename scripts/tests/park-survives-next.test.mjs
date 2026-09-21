/**
 * A task the run parked stays parked, and a loop that stops holds nothing
 * (TL-282).
 *
 * WHAT HAPPENED. Measured on 2026-09-05, one run, three seconds:
 *
 *     08:36:50  status  in_progress -> blocked
 *               "no verification after 2 agent attempts: suite-green: …"
 *     08:36:50  status  blocked -> in_progress
 *               "left `blocked`: every task it named is closed (TL-90)"
 *
 *     stopped: TL-150 was handed out twice to role `spec` …
 *
 * TWO MEANINGS SHARE ONE STATUS. `stuck_status` — where a run parks work it
 * could not verify — resolves to the same value a task waiting on `blocked_by`
 * sits in, and TL-127 dispatches the second kind on sight once every named
 * blocker is closed. So the run's park satisfied the unblocking rule the instant
 * it was written, the very next `next` took the task back, the spin guard
 * stopped the loop AFTER the claim had been written, and the run ended reporting
 * `1 blocked` over a task that was `in_progress`, owned, and holding a lock
 * naming a process that had exited.
 *
 * WHAT THE FIX RESTS ON. The park is a DECLARATION by the run and now says so
 * in the log: the status entry it writes carries `park: true`. `next` reads that
 * marker and leaves such a task alone, because "I could not verify this" was
 * never the sentence TL-127 was written to discharge. The marker travels with
 * the TRANSITION, so a person who later re-declares the status themselves is
 * unblocked again by the same rule as before.
 *
 * THE POSITIVE CONTROLS are the last two tests: a genuinely blocked task whose
 * blockers have closed is still dispatched, and a task blocked with nothing
 * named is still left alone. Without them a fix that simply switched TL-127 off
 * would pass the first test.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HOME_ENV } from "../home.mjs";
import { isolateHome, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("park-survives-next");

const CLI = join(SCRIPTS_DIR, "cli.mjs");
const ACTOR = "agent:worker";

function cli(args, env, cwd) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    cwd, encoding: "utf8", timeout: 180_000, env,
  });
}

function taskFile(backlog, id) {
  return join(backlog, "tasks", readdirSync(join(backlog, "tasks")).find((f) => f.startsWith(id + "-")));
}

function field(backlog, id, name) {
  return (readFileSync(taskFile(backlog, id), "utf8")
    .match(new RegExp("^" + name + ":\\s*(.*)$", "m")) || [])[1];
}

function history(backlog, id) {
  const f = join(backlog, "history", id + ".jsonl");
  if (!existsSync(f)) return [];
  return readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

function statusTrail(backlog, id) {
  return history(backlog, id).filter((e) => e.field === "status").map((e) => e.from + "->" + e.to);
}

/**
 * Every reservation this state directory is holding, named by the task it
 * names. `origin` is the directory's own note of which repository it belongs
 * to, not a claim on anything, so it is not one.
 */
function locksHeld(root) {
  const found = [];
  const walk = (dir) => {
    for (const ent of existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : []) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (/^[A-Z]+-\d+/.test(ent.name)) found.push(ent.name);
    }
  };
  walk(join(root, "state", "locks"));
  return found;
}

function base(title) {
  const root = mkdtempSync(join(tmpdir(), "branchling-park-"));
  const repo = join(root, "repo");
  const backlog = join(repo, "backlog");
  mkdirSync(repo, { recursive: true });
  const g = spawnSync("git", ["-C", repo, "init", "--quiet"], { encoding: "utf8" });
  assert.equal(g.status, 0, g.stderr);
  const env = {
    ...process.env, NO_COLOR: "1",
    [HOME_ENV]: join(root, "home"), BACKLOG_STATE_DIR: join(root, "state"),
  };
  assert.equal(cli(["init", "--dir", backlog, "--no-example"], env, root).status, 0);
  const cfg = join(backlog, "config.yaml");
  writeFileSync(cfg, readFileSync(cfg, "utf8")
    .replace(/^owners:.*$/m, "owners: [unassigned, user:someone, " + ACTOR + "]"), "utf8");
  return { root, repo, backlog, env, title };
}

function newTask(backlog, env, repo, title, contract) {
  const created = cli(["new", "--dir", backlog, "--title", title, "--priority", "P1"], env, repo);
  assert.equal(created.status, 0, created.stderr);
  const id = created.stdout.match(/[A-Z]+-\d+/)[0];
  const file = taskFile(backlog, id);
  writeFileSync(file, readFileSync(file, "utf8")
    .replace(/verification:[\s\S]*?\n---/,
      'verification:\n  - id: it-is-done\n    bash: ' + JSON.stringify(contract || ("test -f " + id + ".done")) + '\n---')
    .replace(/\[proof:[^\]]*\]/g, "[proof: it-is-done]"), "utf8");
  return id;
}

function setField(backlog, id, name, value) {
  const file = taskFile(backlog, id);
  writeFileSync(file, readFileSync(file, "utf8")
    .replace(new RegExp("^" + name + ":.*$", "m"), name + ": " + value), "utf8");
}

function agentScript(root, name, body) {
  const p = join(root, name);
  writeFileSync(p, "#!/bin/sh\n" + body + "\n", "utf8");
  chmodSync(p, 0o755);
  return p;
}

function cleanup(root) {
  rmSync(root, { recursive: true, force: true });
}

/**
 * TL-150's shape: one task whose only blocker is CLOSED, with a contract no
 * agent in this fixture can satisfy. The run must park it and the queue must
 * leave it parked.
 */
function parkFixture() {
  const fx = base();
  const blocker = newTask(fx.backlog, fx.env, fx.repo, "The blocker, long since closed");
  const work = newTask(fx.backlog, fx.env, fx.repo, "The work the run cannot verify");
  setField(fx.backlog, blocker, "status", "done");
  setField(fx.backlog, work, "blocked_by", "[" + blocker + "]");
  assert.equal(cli(["build", "--dir", fx.backlog], fx.env, fx.repo).status, 0);
  return { ...fx, blocker, work };
}

test("a task the run parked is not handed straight back by the next call", () => {
  const fx = parkFixture();
  try {
    // It speaks and it changes the tree, so neither TL-184 nor TL-283 applies:
    // this is an ordinary hand that cannot satisfy the contract.
    const agent = agentScript(fx.root, "tries.sh", [
      "cat >/dev/null",
      'printf "tried and failed\\n"',
      'date +%s%N > ' + JSON.stringify(join(fx.repo, "scratch.txt")),
    ].join("\n"));

    const r = cli(["run", "--dir", fx.backlog, "--actor", ACTOR, "--agent", agent,
      "--max-attempts", "1", "--json"], fx.env, fx.repo);
    assert.equal(r.status, 0, r.stdout + r.stderr);

    // THE TREE. The park stands: the status the run wrote is still there, and
    // the loop did not reclaim it.
    assert.equal(field(fx.backlog, fx.work, "status"), "blocked",
      "the dispatcher took the parked task straight back out");
    assert.deepEqual(statusTrail(fx.backlog, fx.work), ["pending->in_progress", "in_progress->blocked"],
      "the log records the park being undone in the same second it was made");

    // THE REPORT AGREES WITH THE TREE, which is the defect stated plainly: the
    // run said `1 blocked` over a task that was in progress.
    const report = JSON.parse(r.stdout);
    assert.equal(report.tally.blocked, 1);
    assert.equal(report.tasks.find((t) => t.id === fx.work).status, "blocked");
    assert.match(String(report.stopped), /queue is empty/,
      "the loop ended on the spin guard rather than on an empty queue");

    // NOTHING IS LEFT HELD. The run ended and no reservation names a process
    // that has exited.
    assert.deepEqual(locksHeld(fx.root), [], "the run ended holding a reservation");
  } finally {
    cleanup(fx.root);
  }
});

test("the park is a declaration by the run, and the log says so", () => {
  const fx = parkFixture();
  try {
    const agent = agentScript(fx.root, "tries.sh", [
      "cat >/dev/null",
      'printf "tried and failed\\n"',
      'date +%s%N > ' + JSON.stringify(join(fx.repo, "scratch.txt")),
    ].join("\n"));
    assert.equal(cli(["run", "--dir", fx.backlog, "--actor", ACTOR, "--agent", agent,
      "--max-attempts", "1", "--json"], fx.env, fx.repo).status, 0);

    const park = history(fx.backlog, fx.work)
      .filter((e) => e.field === "status" && e.to === "blocked").pop();
    assert.ok(park, "the run recorded no park at all");
    assert.equal(park.park, true,
      "the park is indistinguishable in the log from a person declaring the same status");
    assert.equal(park.source, "run");
  } finally {
    cleanup(fx.root);
  }
});

test("POSITIVE CONTROL: a person's blocked task with closed blockers is still dispatched", () => {
  // TL-127 must keep working. The difference is WHO declared the status: this
  // one was not parked by a run, so nothing marks it, and the queue discharges
  // it exactly as before.
  const fx = base();
  try {
    const blocker = newTask(fx.backlog, fx.env, fx.repo, "The blocker, closed");
    const work = newTask(fx.backlog, fx.env, fx.repo, "Work somebody declared blocked");
    setField(fx.backlog, blocker, "status", "done");
    setField(fx.backlog, work, "blocked_by", "[" + blocker + "]");
    setField(fx.backlog, work, "status", "blocked");
    assert.equal(cli(["build", "--dir", fx.backlog], fx.env, fx.repo).status, 0);

    const r = cli(["next", "--dir", fx.backlog, "--actor", ACTOR, "--json"], fx.env, fx.repo);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(JSON.parse(r.stdout).id, work,
      "a blocked task whose every blocker is closed is no longer handed out");
  } finally {
    cleanup(fx.root);
  }
});

test("POSITIVE CONTROL: a task blocked with nothing named is still left alone", () => {
  const fx = base();
  try {
    const work = newTask(fx.backlog, fx.env, fx.repo, "Waiting on something outside the tree");
    setField(fx.backlog, work, "status", "blocked");
    assert.equal(cli(["build", "--dir", fx.backlog], fx.env, fx.repo).status, 0);
    const r = cli(["next", "--dir", fx.backlog, "--actor", ACTOR, "--json"], fx.env, fx.repo);
    assert.equal(r.status, 3, "a task blocked on nothing nameable was handed out");
  } finally {
    cleanup(fx.root);
  }
});

test("a loop stopped by the spin guard leaves no claim and no lock", () => {
  // The guard asks `seen` AFTER `next` has written the claim, so stopping used
  // to leave an owner, an `in_progress` status and a live reservation behind.
  // Two roles handing the task to each other is the shortest way to reach it.
  const fx = base();
  try {
    const cfg = join(fx.backlog, "config.yaml");
    writeFileSync(cfg, readFileSync(cfg, "utf8") + "\nroles: [spec, dev]\n", "utf8");
    const work = newTask(fx.backlog, fx.env, fx.repo, "Work the two roles keep passing on");
    setField(fx.backlog, work, "role", '"spec"');
    assert.equal(cli(["build", "--dir", fx.backlog], fx.env, fx.repo).status, 0);

    const handOn = (name, to) => agentScript(fx.root, name, [
      "cat >/dev/null",
      'printf "passing it on\\n"',
      process.execPath + " " + JSON.stringify(CLI) + " handoff " + work +
        " --dir " + JSON.stringify(fx.backlog) + " --to-role " + to +
        " --actor " + ACTOR + ' --reason "the next stage owns this" >/dev/null 2>&1',
    ].join("\n"));

    const r = cli(["run", "--dir", fx.backlog, "--actor", ACTOR,
      "--agent-for", "spec=" + handOn("to-dev.sh", "dev"),
      "--agent-for", "dev=" + handOn("to-spec.sh", "spec"),
      "--max-attempts", "1", "--json"], fx.env, fx.repo);
    assert.equal(r.status, 0, r.stdout + r.stderr);

    const report = JSON.parse(r.stdout);
    assert.match(String(report.stopped), /handed out twice/, "the spin guard never fired");
    assert.notEqual(field(fx.backlog, work, "status"), "in_progress",
      "the loop stopped leaving the task claimed by a run that has ended");
    assert.equal(String(field(fx.backlog, work, "owner")).trim().replace(/^"|"$/g, ""), "",
      "the loop stopped leaving an owner on a task nobody is working");
    assert.deepEqual(locksHeld(fx.root), [], "the loop stopped holding a reservation");
  } finally {
    cleanup(fx.root);
  }
});
