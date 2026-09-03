/**
 * A run whose own agent closed the task reports one closed, not zero (TL-200).
 *
 * WHAT HAPPENED. Five consecutive successful runs on 2026-09-03 summarised
 * themselves as `1 task(s) taken · 0 closed · 0 blocked · 1 closed elsewhere`.
 * Every one of them had done the work: `next` handed the task out, the run's
 * own agent closed it through `done`, the loop's own `done` was refused as
 * already-closed, and the counter an unattended caller reads said nothing
 * happened.
 *
 * WHAT THIS FILE PINS DOWN. That the distinction is made by WHO closed the
 * task and not by the shape of the refusal, which is identical in both cases.
 * The two tests below run the SAME fixture and the same agent script, and
 * differ in one argument: the actor the agent passes to `done`. That is the
 * whole hypothesis, and running it twice is what rules out a fix that simply
 * renamed `closed-elsewhere`.
 *
 * THE SECOND CASE IS THE POSITIVE CONTROL, and it is not decoration: an
 * implementation that counted every already-closed task as closed would pass
 * the first test and destroy the guard TL-191 and TL-192 built. It asserts the
 * collision still reads as a collision.
 *
 * The fixture is deliberately its own and NOT imported from
 * `run-stuck-status.test.mjs`: that file's fixture is the setup for a different
 * thesis, and a shared one would make either test's failure ambiguous. What is
 * shared is the technique — a contract a shell script can satisfy, so the agent
 * in this test stays as replaceable as the design says it is.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { isolateHome } from "./_repo.mjs";

isolateHome("run-closed-by-agent");

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");

/** The actor the run is given, and therefore the one it hands the task to. */
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

function history(backlog, id) {
  const f = join(backlog, "history", id + ".jsonl");
  if (!existsSync(f)) return [];
  return readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

/** One task whose contract is "the file `<id>.done` exists in the repository
 *  root" — satisfiable by a shell script, which is what keeps this test from
 *  needing an agent that thinks. */
function fixture() {
  const dir = tmp("closed-by");
  const repo = join(dir, "repo");
  mkdirSync(repo, { recursive: true });
  const backlog = join(repo, "backlog");
  const env = { BACKLOG_STATE_DIR: join(dir, "state") };
  assert.equal(cli(["init", "--dir", backlog, "--no-example"], env).status, 0);

  // The vocabulary this fixture needs for the OTHER closer (third law): the
  // second test's agent closes the task as somebody who is not this run.
  const cfg = join(backlog, "config.yaml");
  writeFileSync(cfg, readFileSync(cfg, "utf8")
    .replace(/^owners:.*$/m, "owners: [unassigned, user:someone, " + RUN_ACTOR + "]"), "utf8");

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

function agentScript(dir, name, body) {
  const p = join(dir, name);
  writeFileSync(p, "#!/bin/sh\n" + body + "\n", "utf8");
  chmodSync(p, 0o755);
  return p;
}

/** An agent that satisfies the contract and then closes the task itself, as
 *  `closer`. The only variable between the two tests. */
function closerAs(dir, name, backlog, closer) {
  return agentScript(dir, name, [
    'id=$(grep -m1 "^id: " | sed "s/^id: //")',
    'touch "$id.done"',
    process.execPath + " " + JSON.stringify(CLI) +
      ' done "$id" --dir ' + JSON.stringify(backlog) +
      " --actor " + closer + " >/dev/null 2>&1",
  ].join("\n"));
}

function cleanup(...dirs) {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

test("the run's own agent closed it: the summary says one closed", () => {
  const { dir, repo, backlog, env, id } = fixture();
  try {
    const agent = closerAs(dir, "ours.sh", backlog, RUN_ACTOR);
    const r = cli(["run", "--dir", backlog, "--actor", RUN_ACTOR, "--agent", agent,
      "--max-attempts", "1", "--json"], env, { cwd: repo });
    assert.equal(r.status, 0, r.stdout + r.stderr);

    // THE TREE FIRST: the guard TL-191 built is untouched by this counting
    // change — the proven status is still in the file and the run wrote no
    // status of its own over it.
    assert.equal(statusOf(backlog, id), "done");
    const written = history(backlog, id).filter((e) => e.source === "run" && e.field === "status");
    assert.equal(written.length, 0, "the run recorded a status change it must not have made");

    const report = JSON.parse(r.stdout);
    assert.equal(report.tally.closed, 1, "a run whose agent closed the task reported zero closed");
    assert.equal(report.tally.closedByAgent, 1,
      "`--json` does not say which hand closed it");
    assert.equal(report.tally.closedElsewhere, 0,
      "the success path is still reported as a collision");
    assert.equal(report.tally.blocked, 0);
    const row = report.tasks.find((t) => t.id === id);
    assert.equal(row.outcome, "closed-by-agent",
      "the per-task line no longer says which path the closure took");
    assert.equal(row.status, "done");
    assert.match(String(row.detail), new RegExp(RUN_ACTOR), "the detail does not name who closed it");
  } finally {
    cleanup(dir);
  }
});

test("the same run on the terminal: `1 closed`, and no `closed elsewhere`", () => {
  const { dir, repo, backlog, env, id } = fixture();
  try {
    const agent = closerAs(dir, "ours.sh", backlog, RUN_ACTOR);
    const r = cli(["run", "--dir", backlog, "--actor", RUN_ACTOR, "--agent", agent,
      "--max-attempts", "1"], env, { cwd: repo });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /1 closed ·/, "the first line of the report still says zero closed");
    assert.doesNotMatch(r.stdout, /closed elsewhere/,
      "the summary still calls the run's own work somebody else's");
    // The word survives where it is informative and nowhere else.
    assert.match(r.stdout, new RegExp(id + "\\s+closed-by-agent"));
  } finally {
    cleanup(dir);
  }
});

test("POSITIVE CONTROL: a DIFFERENT actor closing it is still `closed-elsewhere`", () => {
  // Without this, counting every already-closed task as closed would pass the
  // tests above and silently undo TL-191's distinction.
  const { dir, repo, backlog, env, id } = fixture();
  try {
    const agent = closerAs(dir, "theirs.sh", backlog, "user:someone");
    const r = cli(["run", "--dir", backlog, "--actor", RUN_ACTOR, "--agent", agent,
      "--max-attempts", "1", "--json"], env, { cwd: repo });
    assert.equal(r.status, 0, r.stdout + r.stderr);

    assert.equal(statusOf(backlog, id), "done");
    const report = JSON.parse(r.stdout);
    assert.equal(report.tally.closedElsewhere, 1,
      "a task somebody else closed is no longer counted as a collision");
    assert.equal(report.tally.closed, 0, "the run took credit for somebody else's closure");
    assert.equal(report.tally.closedByAgent, 0);
    const row = report.tasks.find((t) => t.id === id);
    assert.equal(row.outcome, "closed-elsewhere");
  } finally {
    cleanup(dir);
  }
});

test("an unattributed closure is not credited to the run", () => {
  // The log is the only witness to WHO closed a task. A closure it cannot
  // vouch for — a status set by hand, a history that predates the log — must
  // read as "not us": crediting a run that may have had no part in it would be
  // the same false report in the opposite direction.
  const { dir, repo, backlog, env, id } = fixture();
  try {
    // The agent satisfies the contract but does NOT close the task; the file is
    // moved to an archived status behind the tool's back, so no transition into
    // it is ever recorded.
    const agent = agentScript(dir, "silent.sh", [
      'id=$(grep -m1 "^id: " | sed "s/^id: //")',
      'touch "$id.done"',
      "sed -i.bak 's/^status: .*/status: cancelled/' " +
        JSON.stringify(join(backlog, "tasks")) + '/"$id"-*.md',
      "rm -f " + JSON.stringify(join(backlog, "tasks")) + '/"$id"-*.md.bak',
    ].join("\n"));

    const r = cli(["run", "--dir", backlog, "--actor", RUN_ACTOR, "--agent", agent,
      "--max-attempts", "1", "--json"], env, { cwd: repo });
    assert.equal(r.status, 0, r.stdout + r.stderr);

    assert.equal(statusOf(backlog, id), "cancelled");
    const report = JSON.parse(r.stdout);
    assert.equal(report.tally.closedByAgent, 0,
      "a closure nobody is recorded as having made was credited to this run");
    assert.equal(report.tally.closedElsewhere, 1);
  } finally {
    cleanup(dir);
  }
});
