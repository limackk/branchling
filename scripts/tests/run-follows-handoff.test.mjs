/**
 * A run that serves two roles carries a task from one to the other (TL-271).
 *
 * WHAT WAS WRONG. The `spec` hand wrote a failing test and handed the task to
 * `dev`, exactly as the pipeline intends. The loop then ran `done` — which
 * refused, the test being red by design — counted that as a failed attempt,
 * retried the SPEC hand with the refusal as feedback, exhausted the attempt
 * count on a stage whose success IS a refusal, re-read the file, found the task
 * pending for `dev`, reported it as "held elsewhere — by nobody", and stopped
 * the plan with a `dev` hand idle. The pipeline had worked in earlier waves only
 * because every role was a separate `run`, launched in sequence by a person.
 *
 * THE DECISION THIS ENCODES. A change of `role:` under the loop's feet, with the
 * owner cleared, is a ROUTING event and not a loss of the claim: the hand did
 * what it was asked and gave the task back to the queue for a different hand.
 * The loop names it `handed-on`, runs no `done` (the handoff already said what
 * `done` would have discovered, at the cost of a whole suite), and lets `next`
 * hand the task out again to the role it now asks for — with a fresh attempt
 * count, because the attempts were that role's, not this task's.
 *
 * WHAT IT DOES NOT DECIDE. A task handed to a role this run does not serve is
 * still `held-elsewhere`; that ending is defensible there and is not touched.
 * And a task that arrives a second time under the SAME role still stops the
 * loop: that is the spin guard, and TL-277 is where the ping-pong itself lives.
 *
 * THE HAND IS TOLD WHO IT IS. The spec hand, told by its charter to act as
 * `agent:spec`, was refused by `handoff` because the run had claimed the task as
 * `agent:fleet`, and had to read the history file to learn that. The loop knows
 * both the actor and the role and exports them; the last test reads them back.
 *
 * POSITIVE CONTROLS. The first test fails against the loop as it was: the task
 * ends `pending` for the second role with the run reporting `held-elsewhere`.
 * The single-role test at the end is the regression guard for TL-192: a task
 * genuinely handed to a role nobody here serves is still not closed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PRODUCT_NAME } from "../product.mjs";
import { isolateHome } from "./_repo.mjs";

isolateHome("run-follows-handoff");

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");
const ENV_PREFIX = PRODUCT_NAME.toUpperCase().replace(/[^A-Z0-9]+/g, "_");

const FIRST = "maker";
const SECOND = "checker";
const PASSING = 'verification:\n  - id: it-runs\n    bash: "true"';

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

function field(backlog, id, name) {
  return (readFileSync(taskFile(backlog, id), "utf8").match(new RegExp("^" + name + ": *\"?([^\"\\n]*)", "m")) || [])[1];
}

function fixture() {
  const dir = tmp("handoff");
  const repo = join(dir, "repo");
  mkdirSync(repo, { recursive: true });
  const backlog = join(repo, "backlog");
  const env = { BACKLOG_STATE_DIR: join(dir, "state") };
  assert.equal(cli(["init", "--dir", backlog, "--no-example"], env).status, 0);
  const configPath = join(backlog, "config.yaml");
  writeFileSync(configPath, readFileSync(configPath, "utf8") +
    "\nroles: [" + FIRST + ", " + SECOND + "]\n", "utf8");
  assert.match(readFileSync(configPath, "utf8"), new RegExp("roles: \\[" + FIRST),
    "the fixture's own `roles:` line was not written — every assertion below would be vacuous");

  const add = (title, role) => {
    const r = cli(["new", "--dir", backlog, "--title", title, "--priority", "P1"], env);
    assert.equal(r.status, 0, r.stderr);
    const id = (r.stdout.match(/([A-Z]+-\d+)/) || [])[1];
    const file = taskFile(backlog, id);
    let text = readFileSync(file, "utf8")
      .replace(/verification:[\s\S]*?\n---/, PASSING + "\n---")
      .replace(/\[proof:[^\]]*\]/g, "[proof: it-runs]");
    if (role) text = text.replace(/^role: .*$/m, "role: " + role);
    writeFileSync(file, text, "utf8");
    cli(["build", "--dir", backlog], env);
    return id;
  };
  return { dir, repo, backlog, env, add };
}

/** A hand that does its stage and hands the task to the next role, under the
 *  actor the run claimed it with — read from the environment, not guessed. */
function handingHand(dir, name, toRole) {
  const p = join(dir, name);
  writeFileSync(p, [
    "#!/bin/sh",
    "cat >/dev/null",
    "echo 'stage one is done, the rest is another hand'",
    "exec " + JSON.stringify(process.execPath) + " " + JSON.stringify(CLI) +
      " handoff \"$" + ENV_PREFIX + "_TASK\" --to-role " + toRole +
      " --actor \"$" + ENV_PREFIX + "_ACTOR\" --dir \"$" + ENV_PREFIX + "_DIR\"" +
      " --reason 'the first stage is written; the second is another hand'",
    "",
  ].join("\n"), "utf8");
  chmodSync(p, 0o755);
  return p;
}

/** A hand that finishes, and writes down who the loop said it was. */
function closingHand(dir, name, witness) {
  const p = join(dir, name);
  writeFileSync(p, [
    "#!/bin/sh",
    "cat >/dev/null",
    "echo \"actor=$" + ENV_PREFIX + "_ACTOR role=$" + ENV_PREFIX + "_ROLE task=$" + ENV_PREFIX + "_TASK\" > " + JSON.stringify(witness),
    "echo 'the work is done'",
    "",
  ].join("\n"), "utf8");
  chmodSync(p, 0o755);
  return p;
}

function cleanup(...dirs) {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

test("a handoff to a role this run serves is followed: the second hand closes the task", () => {
  const f = fixture();
  try {
    const id = f.add("Two stages of one task", FIRST);
    const witness = join(f.dir, "witness.txt");
    const r = cli(["run", "--dir", f.backlog, "--actor", "agent:fleet", "--max-attempts", "2", "--json",
      "--agent-for", FIRST + "=" + handingHand(f.dir, "first.sh", SECOND),
      "--agent-for", SECOND + "=" + closingHand(f.dir, "second.sh", witness)],
    f.env, { cwd: f.repo });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const report = JSON.parse(r.stdout);
    assert.equal(field(f.backlog, id, "status"), "done",
      "the task was handed to a role this run serves and nobody here picked it up — the run stopped because: " +
      report.stopped + " — legs: " + JSON.stringify(report.tasks.map((t) => [t.id, t.role, t.outcome])));
    const legs = report.tasks.filter((t) => t.id === id);
    assert.equal(legs.length, 2, "one task, two hands, two legs in the report: " + JSON.stringify(report.tasks));
    assert.equal(legs[0].outcome, "handed-on", "the first leg is a handoff, not a failure: " + JSON.stringify(legs[0]));
    assert.equal(legs[0].attempts, 1, "a handoff is that role's success, not a spent attempt");
    assert.equal(legs[0].toRole, SECOND, "the report says which role the task went to");
    assert.equal(legs[1].outcome, "closed");
    assert.equal(legs[1].attempts, 1, "the second hand starts with a fresh attempt count");
    assert.equal(report.tally.handedOn, 1);
    assert.equal(report.tally.closed, 1);
    assert.equal(report.tally.heldElsewhere || 0, 0, "a followed handoff is not `held elsewhere`");
    assert.ok(existsSync(witness), "the second hand never ran");
    // BOTH TRANSCRIPTS SURVIVE (TL-281). The first leg keeps the bare name and
    // the second carries its number and role, so neither erases the other.
    assert.notEqual(legs[0].log, legs[1].log, "both legs wrote to one file — the second erased the first");
    assert.match(legs[0].log, new RegExp(id + "\\.log$"), "a first leg must keep the plain name: " + legs[0].log);
    assert.match(legs[1].log, new RegExp(id + "\\.2-" + SECOND + "\\.log$"), legs[1].log);
    for (const leg of legs) {
      assert.ok(existsSync(leg.log), "the report names a log that is not there: " + leg.log);
      assert.ok(readFileSync(leg.log, "utf8").trim().length > 0, "an empty transcript: " + leg.log);
    }
    assert.match(readFileSync(legs[0].log, "utf8"), /stage one is done/,
      "the first hand's output was overwritten by the second");
    assert.match(readFileSync(witness, "utf8"), new RegExp("actor=agent:fleet role=" + SECOND + " task=" + id),
      "the loop did not tell the hand who it is");
  } finally {
    cleanup(f.dir);
  }
});

test("the handoff is reported by name, in the human report as well", () => {
  const f = fixture();
  try {
    const id = f.add("Two stages of one task", FIRST);
    const r = cli(["run", "--dir", f.backlog, "--actor", "agent:fleet", "--max-attempts", "2",
      "--agent-for", FIRST + "=" + handingHand(f.dir, "first.sh", SECOND),
      "--agent-for", SECOND + "=" + closingHand(f.dir, "second.sh", join(f.dir, "w.txt"))],
    f.env, { cwd: f.repo });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, new RegExp(id + "\\s+handed-on\\s+1 attempt"), r.stdout);
    assert.match(r.stdout, /1 handed on/, "the summary line does not count the handoff: " + r.stdout);
    assert.doesNotMatch(r.stdout, /held elsewhere/, r.stdout);
  } finally {
    cleanup(f.dir);
  }
});

test("POSITIVE CONTROL: a handoff to a role this run does NOT serve is still held elsewhere, and the task stays open", () => {
  const f = fixture();
  try {
    const id = f.add("A stage for a hand this run lacks", FIRST);
    const r = cli(["run", "--dir", f.backlog, "--actor", "agent:fleet", "--max-attempts", "2", "--json",
      "--agent-for", FIRST + "=" + handingHand(f.dir, "first.sh", SECOND)],
    f.env, { cwd: f.repo });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(field(f.backlog, id, "status"), "pending");
    assert.equal(field(f.backlog, id, "role"), SECOND);
    const report = JSON.parse(r.stdout);
    const leg = report.tasks.find((t) => t.id === id);
    assert.equal(leg.outcome, "held-elsewhere", JSON.stringify(leg));
    assert.equal(report.tally.handedOn || 0, 0, "a handoff nobody here can follow is not counted as followed");
  } finally {
    cleanup(f.dir);
  }
});

test("a task that comes back under the SAME role stops the loop instead of spinning", () => {
  const f = fixture();
  try {
    // Both hands hand off: first -> second -> first. The third arrival is the
    // first role's second turn on this task, and that is where the loop stops.
    const id = f.add("A task two hands pass back and forth", FIRST);
    const r = cli(["run", "--dir", f.backlog, "--actor", "agent:fleet", "--max-attempts", "2", "--json",
      "--agent-for", FIRST + "=" + handingHand(f.dir, "first.sh", SECOND),
      "--agent-for", SECOND + "=" + handingHand(f.dir, "second.sh", FIRST)],
    f.env, { cwd: f.repo });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const report = JSON.parse(r.stdout);
    assert.equal(report.tasks.filter((t) => t.id === id && t.outcome === "handed-on").length, 2,
      JSON.stringify(report.tasks));
    assert.match(String(report.stopped), /twice|spin/, "the loop did not name the spin: " + report.stopped);
    assert.notEqual(field(f.backlog, id, "status"), "done");
  } finally {
    cleanup(f.dir);
  }
});
