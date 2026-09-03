/**
 * An agent that never STARTED costs the task nothing (TL-184).
 *
 * WHAT HAPPENED. On 2026-09-03, in the first unattended run of the new plan,
 * both attempts produced one line — `Failed to authenticate: OAuth session
 * expired and could not be refreshed` — on stderr, in 57 seconds each, and the
 * tree was untouched. The loop counted them as attempts, `done` refused for the
 * only reason it could, and TL-183 was parked as `blocked` with a reason
 * describing WORK — "no verification after 2 agent attempts" — when the fact was
 * about the machine. Restoring it took a hand edit and a history entry.
 *
 * WHAT THIS FILE RULES OUT. That the rule is a rule about exit codes. The agent
 * here exits non-zero, and so do both controls: what separates them is only
 * whether they SAID anything on stdout and whether they CHANGED anything. The
 * fixture repository is a real git repository because the second signal is
 * `git status --porcelain` — outside git the question cannot be asked, and the
 * loop then keeps its old behaviour by design.
 *
 * THE TWO POSITIVE CONTROLS are the important half. A detector that answered
 * "never ran" to everything would pass the first test alone while making
 * `--max-attempts` unreachable — a genuinely failing task would loop forever.
 * So the same fixture is run with an agent that speaks but changes nothing, and
 * with one that changes something but stays silent: both must still spend their
 * attempts and be parked in the protected status, with exit 0.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { neverRan } from "../run-loop.mjs";

import { isolateHome } from "./_repo.mjs";

isolateHome("run-agent-launch");

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

function git(repo, ...args) {
  const r = spawnSync("git", ["-C", repo].concat(args), { encoding: "utf8" });
  assert.equal(r.status, 0, args.join(" ") + ": " + r.stderr);
}

/** One task in a REAL git repository, with a contract a shell script can
 *  satisfy — the agent stays as replaceable as the design says it is. */
function fixture() {
  const dir = tmp("launch");
  const repo = join(dir, "repo");
  mkdirSync(repo, { recursive: true });
  git(repo, "init", "--quiet");
  const backlog = join(repo, "backlog");
  const env = { BACKLOG_STATE_DIR: join(dir, "state") };
  assert.equal(cli(["init", "--dir", backlog, "--no-example"], env).status, 0);

  const r = cli(["new", "--dir", backlog, "--title", "A task no agent reached", "--priority", "P1"], env);
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

// ── The rule itself, without a process ────────────────────────────────────

test("`neverRan` needs BOTH signals, and never reads an unknown tree as an unchanged one", () => {
  assert.equal(neverRan("", "M x\n", "M x\n"), true, "silent and unchanged is not an attempt");
  assert.equal(neverRan("   \n", "", ""), true, "whitespace on stdout is not speech");

  assert.equal(neverRan("working…", "", ""), false, "an agent that spoke was running");
  assert.equal(neverRan("", "", "?? new\n"), false, "an agent that changed the tree was running");

  // The unknown tree, twice over: outside a git repository the second signal
  // cannot be had, and a missing answer must never stand in for "nothing moved".
  assert.equal(neverRan("", null, null), false, "an unaskable question was read as evidence");
  assert.equal(neverRan("", "M x\n", null), false, "half an answer was read as evidence");
});

// ── The measured case, end to end ─────────────────────────────────────────

test("an agent that never started leaves the task exactly as it was, and the run exits non-zero", () => {
  const { dir, repo, backlog, env, id } = fixture();
  try {
    // The measurement, reduced: one line on stderr, a non-zero exit, an
    // untouched tree. Nothing here says WHICH failure it is — that is the point.
    const agent = agentScript(dir, "expired.sh", [
      "cat >/dev/null",
      'echo "Failed to authenticate: OAuth session expired and could not be refreshed" >&2',
      "exit 1",
    ].join("\n"));

    const r = cli(["run", "--dir", backlog, "--actor", "agent:worker", "--agent", agent,
      "--max-attempts", "2", "--json"], env, { cwd: repo });

    // THE EXIT CODE FIRST: in a cron entry this is the only thing anybody reads.
    assert.equal(r.status, 1, "the run reported success: " + r.stdout + r.stderr);

    // THE TREE SECOND. The task is back where it started — not `blocked`, not
    // left claimed in the in-progress status.
    assert.equal(statusOf(backlog, id), "pending",
      "the task did not get the status it was taken from back");

    // And no attempt was charged against it anywhere: nothing was parked, and
    // the reason the old loop wrote — one about the WORK — appears nowhere.
    const statuses = history(backlog, id).filter((e) => e.field === "status");
    assert.ok(!statuses.some((e) => e.to === "blocked"), "the task was parked in the protected status");
    assert.ok(!statuses.some((e) => /agent attempt/.test(String(e.reason || ""))),
      "the history blames the task for work nobody did");

    const report = JSON.parse(r.stdout);
    assert.equal(report.ok, false, "the report calls a run that could not start its agent ok");
    const row = report.tasks.find((t) => t.id === id);
    assert.equal(row.outcome, "agent-never-ran");
    assert.equal(row.attempts, 0, "an attempt nobody made was counted");

    // The fact about the machine, in the report and named: which command, what
    // it said, where the task was left.
    assert.equal(report.agentNeverRan.id, id);
    assert.match(report.agentNeverRan.command, /expired\.sh/, "the report does not name the command");
    assert.match(report.agentNeverRan.output, /OAuth session expired/,
      "the report does not carry what the agent said");
    assert.equal(report.agentNeverRan.restoredTo, "pending");
  } finally {
    cleanup(dir);
  }
});

test("the same run, read on the terminal, names the command and does not call the task blocked", () => {
  const { dir, repo, backlog, env, id } = fixture();
  try {
    const agent = agentScript(dir, "expired.sh", [
      "cat >/dev/null",
      'echo "Failed to authenticate: OAuth session expired" >&2',
      "exit 1",
    ].join("\n"));

    const r = cli(["run", "--dir", backlog, "--actor", "agent:worker", "--agent", agent,
      "--max-attempts", "2"], env, { cwd: repo });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /the agent command never ran/);
    assert.match(r.stdout, /expired\.sh/, "the reader is not told which command to try themselves");
    assert.match(r.stdout, /OAuth session expired/, "the reader is not told what it said");
    assert.match(r.stdout, new RegExp(id + " was left in `pending`"));
    assert.ok(!/ blocked\b/.test(r.stdout.replace(/\d+ blocked/, "")),
      "the terminal report calls the task blocked");
  } finally {
    cleanup(dir);
  }
});

// ── The controls: a real failure still costs the attempts ─────────────────

test("POSITIVE CONTROL: an agent that SPOKE and failed the contract is still parked after its attempts", () => {
  const { dir, repo, backlog, env, id } = fixture();
  try {
    // It changes nothing — one signal holds — but it reports on stdout, so it
    // ran. The contract then fails, which is a fact about the task.
    const agent = agentScript(dir, "talker.sh", [
      "cat >/dev/null",
      'echo "I looked at the task and could not do it"',
      "exit 1",
    ].join("\n"));

    const r = cli(["run", "--dir", backlog, "--actor", "agent:worker", "--agent", agent,
      "--max-attempts", "2", "--json"], env, { cwd: repo });
    assert.equal(r.status, 0, "a task that genuinely failed made the run exit non-zero");
    assert.equal(statusOf(backlog, id), "blocked", "the attempts were never spent");

    const report = JSON.parse(r.stdout);
    assert.equal(report.agentNeverRan, null);
    const row = report.tasks.find((t) => t.id === id);
    assert.equal(row.outcome, "exhausted");
    assert.equal(row.attempts, 2, "the attempt budget was not spent");
  } finally {
    cleanup(dir);
  }
});

test("POSITIVE CONTROL: a SILENT agent that changed the tree is still parked after its attempts", () => {
  const { dir, repo, backlog, env, id } = fixture();
  try {
    // The mirror image: it says nothing at all, but it works — badly. The
    // contract asks for `<id>.done` and it writes something else.
    const agent = agentScript(dir, "mute.sh", [
      "cat >/dev/null",
      'echo "half of it" > half-finished.txt',
      "exit 1",
    ].join("\n"));

    const r = cli(["run", "--dir", backlog, "--actor", "agent:worker", "--agent", agent,
      "--max-attempts", "2", "--json"], env, { cwd: repo });
    assert.equal(r.status, 0, "work that was really done made the run exit non-zero");
    assert.equal(statusOf(backlog, id), "blocked", "the attempts were never spent");

    const report = JSON.parse(r.stdout);
    assert.equal(report.agentNeverRan, null);
    assert.equal(report.tasks.find((t) => t.id === id).attempts, 2);
  } finally {
    cleanup(dir);
  }
});
