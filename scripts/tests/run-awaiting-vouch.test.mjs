/**
 * A task worked to the end of a contract that asks a PERSON is parked as
 * AWAITING A VOUCH, not as failed (TL-212).
 *
 * WHAT WAS WRONG. `done` refuses to close a task whose `verification:` ends in a
 * `manual:` entry when there is nobody to ask, and it is right to. The loop had
 * exactly one place to put such a task: the status this project protects with a
 * reason, which means the work FAILED. So a run that did everything asked of it
 * ended with the agent's work on disk and the tree saying it had not been done —
 * and the person reading `Waiting on you` saw a whole task where thirty seconds
 * of checking was what was actually theirs.
 *
 * WHAT IS ASSERTED, and all of it against the TREE rather than the run's report
 * of itself: the status written into the task file, the reason written into
 * `backlog/history/`, that `next` will not hand the task out again, and that the
 * panel calls it its own kind and carries the `manual:` entry's own words.
 *
 * THE FIXTURE DECLARES ITS OWN VOCABULARY. `awaiting_vouch` is not a fact about
 * this tool and must not be read out of the repository's own config.yaml — the
 * rule AGENTS.md states for every test that needs a specific value.
 *
 * THE POSITIVE CONTROLS are the last two tests: the same fixture with the key
 * REMOVED still parks in the stuck status (so a green run here is not a run that
 * would park anything anywhere), and a contract that genuinely fails is still
 * parked as failed even though the vouch status exists.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { decisionPanel } from "../decision-panel.mjs";
import { queueStatuses } from "../next-task.mjs";
import { stuckStatus, vouchReason } from "../run-loop.mjs";

import { isolateHome } from "./_repo.mjs";

isolateHome("run-awaiting-vouch");

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");

// The fixture's own words, in one place so no assertion below quotes a literal
// twice and none of them is this repository's vocabulary.
const VOUCH = "awaiting_vouch";
const STUCK = "blocked";
const MANUAL = "a person opens the page and sees the badge turn green";
const CONTRACT = 'verification:\n  - id: a-person-looked\n    manual: "' + MANUAL + '"';
const FAILING = 'verification:\n  - id: it-is-done\n    bash: "test -f {id}.done"';

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

/** Every history record for one task, as objects. The FILE is the artefact —
 *  the run's own report of what it wrote proves only that it meant to. */
function history(backlog, id) {
  const dir = join(backlog, "history");
  const out = [];
  for (const f of existsSync(dir) ? readdirSync(dir) : []) {
    if (!f.endsWith(".jsonl")) continue;
    for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
      if (!line.trim()) continue;
      let e = null;
      try { e = JSON.parse(line); } catch { continue; }
      if (e && String(e.task || "").toUpperCase() === String(id).toUpperCase()) out.push(e);
    }
  }
  return out;
}

/**
 * A backlog with one task whose contract is `contract`, and — unless
 * `declareVouch` is false — a `statuses:` list and an `awaiting_vouch_status:`
 * of the fixture's own.
 */
function fixture(title, contract, proofId, declareVouch = true) {
  const dir = tmp("vouch");
  const repo = join(dir, "repo");
  mkdirSync(repo, { recursive: true });
  const backlog = join(repo, "backlog");
  const env = { BACKLOG_STATE_DIR: join(dir, "state") };
  assert.equal(cli(["init", "--dir", backlog, "--no-example"], env).status, 0);

  const configPath = join(backlog, "config.yaml");
  let config = readFileSync(configPath, "utf8")
    .replace(/^statuses:.*$/m, "statuses: [pending, in_progress, " + VOUCH + ", " + STUCK + ", done, cancelled]");
  assert.match(config, new RegExp("statuses: \\[pending, in_progress, " + VOUCH),
    "the fixture's own `statuses:` line was not written — every assertion below would be vacuous");
  if (declareVouch) config += "\nawaiting_vouch_status: " + VOUCH + "\n";
  writeFileSync(configPath, config, "utf8");

  const r = cli(["new", "--dir", backlog, "--title", title, "--priority", "P1"], env);
  assert.equal(r.status, 0, r.stderr);
  const id = (r.stdout.match(/([A-Z]+-\d+)/) || [])[1];
  const file = taskFile(backlog, id);
  writeFileSync(file, readFileSync(file, "utf8")
    .replace(/verification:[\s\S]*?\n---/, contract.split("{id}").join(id) + "\n---")
    .replace(/\[proof:[^\]]*\]/g, "[proof: " + proofId + "]"), "utf8");
  cli(["build", "--dir", backlog], env);
  return { dir, repo, backlog, env, id };
}

/** An agent that works — it prints, so the loop does not read the attempt as one
 *  that never started — and can do nothing about a line asking for a person. */
function worker(dir, name) {
  const p = join(dir, name);
  writeFileSync(p, "#!/bin/sh\ncat >/dev/null\necho 'the work is done'\n", "utf8");
  chmodSync(p, 0o755);
  return p;
}

function runLoop(backlog, repo, env, agent, extra = []) {
  return cli(["run", "--dir", backlog, "--actor", "agent:worker", "--agent", agent,
    "--max-attempts", "3", "--json"].concat(extra), env, { cwd: repo });
}

function cleanup(...dirs) {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

test("a `manual:` contract parks the task in the vouch status, not the stuck one", () => {
  const { dir, repo, backlog, env, id } = fixture("Work only a person can sign for", CONTRACT, "a-person-looked");
  try {
    const r = runLoop(backlog, repo, env, worker(dir, "worker.sh"));
    assert.equal(r.status, 0, r.stdout + r.stderr);

    // THE TREE, first and last.
    assert.equal(statusOf(backlog, id), VOUCH,
      "the finished task was not parked where a person can vouch for it");

    const report = JSON.parse(r.stdout);
    const row = report.tasks.find((t) => t.id === id);
    assert.equal(row.outcome, "awaiting-vouch", "the run does not name this ending");
    assert.equal(row.status, VOUCH);
    assert.equal(report.tally.blocked, 0, "finished work was counted as blocked");
    assert.equal(report.tally.awaitingVouch, 1, "the run counts no task as awaiting a vouch");
  } finally {
    cleanup(dir);
  }
});

test("the recorded reason says the work stands, and does not call it a failure", () => {
  const { dir, repo, backlog, env, id } = fixture("Work waiting for a signature", CONTRACT, "a-person-looked");
  try {
    assert.equal(runLoop(backlog, repo, env, worker(dir, "worker.sh")).status, 0);

    const entries = history(backlog, id);
    const parked = entries.filter((e) => e.field === "status" && e.to === VOUCH).pop();
    assert.ok(parked, "nothing in `backlog/history/` records the park — the reason died with the run");
    assert.equal(parked.source, "run");
    assert.match(String(parked.reason), /work stands/,
      "the reason does not say the agent's work survived");
    assert.doesNotMatch(String(parked.reason), /no verification after/,
      "the reason blames the attempt count for a stop no attempt could have changed");

    // The `manual:` entry's own words are in the log too — that is where the
    // panel reads the thing to actually do from.
    const unverified = entries.filter((e) => e.field === "__unverified__").pop();
    assert.ok(unverified, "`done` recorded no unvouched entry");
    assert.equal(unverified.to, MANUAL);
  } finally {
    cleanup(dir);
  }
});

test("`next` does not hand a task awaiting a vouch back out", () => {
  const { dir, repo, backlog, env, id } = fixture("Work nobody may re-do", CONTRACT, "a-person-looked");
  try {
    assert.equal(runLoop(backlog, repo, env, worker(dir, "worker.sh")).status, 0);
    assert.equal(statusOf(backlog, id), VOUCH);

    const handed = cli(["next", "--dir", backlog, "--actor", "agent:second", "--json"], env, { cwd: repo });
    assert.equal(handed.status, 3, "the queue offered work that is finished: " + handed.stdout);
    assert.equal(statusOf(backlog, id), VOUCH, "a second dispatcher moved a task that is not work any more");
  } finally {
    cleanup(dir);
  }
});

test("`queueStatuses` drops the vouch status, and `--stuck-status` refuses it", () => {
  const config = {
    activeStatuses: ["pending", "in_progress", VOUCH, STUCK],
    statuses: ["pending", "in_progress", VOUCH, STUCK, "done", "cancelled"],
    archivedStatuses: ["done", "cancelled"],
    reasonRequiredStatuses: [STUCK, "cancelled"],
    inProgressStatus: "in_progress",
    awaitingVouchStatus: VOUCH,
  };
  // A positive control on the fixture: `pending` IS handed out, so an empty
  // answer below would not pass for a correct one.
  assert.deepEqual(queueStatuses(config), ["pending"]);
  assert.deepEqual(queueStatuses({ ...config, awaitingVouchStatus: null }), ["pending", VOUCH]);

  assert.deepEqual(stuckStatus(config, null), { status: STUCK },
    "the vouch status made the stuck status ambiguous");
  const refused = stuckStatus(config, VOUCH);
  assert.ok(refused.error, "a run was allowed to file failures where finished work waits");
  assert.match(refused.error, /awaiting_vouch_status/);
});

test("the panel calls it its own kind and carries the `manual:` entry's words", () => {
  const tasks = [
    { id: "T-1", title: "Signed off by a person", status: VOUCH, priority: "P1", owner: "agent:worker", blocked_by: [], blocks: [] },
    { id: "T-2", title: "Somebody has to do this", status: "pending", priority: "P1", executor: "human", blocked_by: [], blocks: [] },
  ];
  const hist = {
    "T-1": [{ id: "e1", ts: "2026-09-03T10:00:00.000Z", task: "T-1", field: "__unverified__",
      from: "", to: MANUAL, actor: "agent:worker", refusal: "json" }],
  };
  const rows = decisionPanel(tasks, hist, {
    archivedStatuses: ["done", "cancelled"],
    awaitingVouchStatus: VOUCH,
    now: Date.parse("2026-09-05T10:00:00.000Z"),
  });

  const vouch = rows.filter((r) => r.kind === "vouch");
  assert.equal(vouch.length, 1, "the panel does not distinguish a vouch from a task to do");
  assert.equal(vouch[0].id, "T-1");
  assert.equal(vouch[0].manual, MANUAL, "the row does not carry the thing to actually do");
  assert.equal(vouch[0].refusal, "json");
  assert.equal(vouch[0].ageDays, 2);
  // ONE row per task: the marked-task loop must not claim it as well.
  assert.equal(rows.filter((r) => r.id === "T-1").length, 1);
  // The positive control — the other task is still there, as the other kind.
  assert.deepEqual(rows.filter((r) => r.kind === "task").map((r) => r.id), ["T-2"]);

  // With the project declaring no such status there is no such kind, and the
  // same task falls back to whatever else the panel can say about it.
  const without = decisionPanel(tasks, hist, { archivedStatuses: ["done", "cancelled"] });
  assert.equal(without.filter((r) => r.kind === "vouch").length, 0);
});

test("vouchReason states both facts and keeps the entry that stopped the close", () => {
  const r = vouchReason("TL-9: `--json` cannot ask a person to vouch\nsecond line");
  assert.match(r, /work stands/);
  assert.match(r, /cannot ask a person to vouch/);
  assert.doesNotMatch(r, /second line/, "the whole refusal was pasted into a permanent record");
  assert.match(vouchReason(""), /work stands/, "an empty detail loses the sentence entirely");
});

test("POSITIVE CONTROL: with no `awaiting_vouch_status` the task is parked as before", () => {
  const { dir, repo, backlog, env, id } =
    fixture("Work in a backlog that declares nothing", CONTRACT, "a-person-looked", false);
  try {
    const r = runLoop(backlog, repo, env, worker(dir, "worker.sh"));
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(statusOf(backlog, id), STUCK,
      "a backlog that declared no vouch status had its behaviour changed under it");
    const report = JSON.parse(r.stdout);
    assert.equal(report.tally.awaitingVouch, 0);
    assert.equal(report.tally.blocked, 1);
    // And it is SAID, once, rather than filed under failure in silence.
    assert.match(r.stderr, /awaiting_vouch_status/,
      "the run parked finished work as failed and did not mention why");
  } finally {
    cleanup(dir);
  }
});

test("POSITIVE CONTROL: a contract that genuinely fails is still parked as failed", () => {
  const { dir, repo, backlog, env, id } = fixture("Work nobody finishes", FAILING, "it-is-done");
  try {
    const r = runLoop(backlog, repo, env, worker(dir, "idle.sh"));
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(statusOf(backlog, id), STUCK,
      "a task whose contract failed was filed where finished work waits for a signature");
    const report = JSON.parse(r.stdout);
    assert.equal(report.tally.blocked, 1);
    assert.equal(report.tally.awaitingVouch, 0);
  } finally {
    cleanup(dir);
  }
});
