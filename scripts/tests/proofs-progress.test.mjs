/**
 * `check --proofs` says what it is doing while it does it (TL-265).
 *
 * WHAT IS UNDER TEST IS THE NARRATION, NOT THE VERDICT — `proofs.test.mjs` owns
 * the verdict. Measured on this repository the guard ran for 68 minutes and
 * printed nothing until the last command had finished, so a run that was
 * working and a run that was wedged were byte-identical from outside and the
 * operator had no basis for deciding whether to wait.
 *
 * WHY THE FIXTURE CARRIES TWO TASKS AND NOT ONE. The claim is a count that
 * MOVES — `[1/2]` then `[2/2]` — and a single closing would let a hard-coded
 * `[1/1]` pass. The contracts are `true` for the same reason as in the sibling
 * file: what is proved here is what the guard SAYS, and a real test suite would
 * only make this file slow.
 *
 * THE CHANNEL IS PART OF THE CLAIM. Progress belongs on stderr, because stdout
 * carries the report; a consumer reading the verdict must not have to sift a
 * running commentary out of it. So every assertion below names the stream.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { REASON_PROVEN, REASON_UNKNOWN } from "../history.mjs";

import { isolateHome } from "./_repo.mjs";

// The home is isolated for the whole file (TL-166): without it a test reads the
// developer's own configuration and the suite answers differently per machine.
isolateHome("proofs-progress");

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");

let counter = 0;

/** A backlog holding `n` closed tasks, each proven, each with a trivial contract. */
function backlog(n = 2, command = "true") {
  const dir = mkdtempSync(join(tmpdir(), "branchling-proofs-progress-" + counter++ + "-"));
  const init = spawnSync(process.execPath, [CLI, "init", "--dir", dir, "--no-example"], { encoding: "utf8" });
  assert.equal(init.status, 0, init.stderr);

  for (let i = 1; i <= n; i++) {
    const id = "TASK-" + i;
    writeFileSync(join(dir, "tasks", id + "-a-closed-task.md"), [
      "---", "id: " + id, 'title: "A closed task"', "type: task", "labels: []", "board: main",
      'epic: ""', "priority: P1", "status: done", "owner: local:test", "estimate: 2h",
      "created: 2026-08-01", "updated: 2026-08-01", "blocked_by: []", "blocks: []",
      "verification:", "  - id: runs", '    bash: "' + command + '"', "---", "", "## Goal", "",
      "Something proved once.", "",
    ].join("\n"), "utf8");

    mkdirSync(join(dir, "history"), { recursive: true });
    const row = (field, from, to, source, why) => JSON.stringify({
      id: "E" + Math.random().toString(36).slice(2), ts: "2026-08-02T10:00:00.000Z",
      task: id, field, from, to, actor: "local:closer", source, reason: why,
    });
    writeFileSync(join(dir, "history", id + ".jsonl"),
      row("status", "pending", "in_progress", "take", REASON_UNKNOWN) + "\n" +
      row("status", "in_progress", "done", "done", REASON_PROVEN) + "\n", "utf8");
  }
  return dir;
}

function check(dir, args = []) {
  const r = spawnSync(process.execPath, [CLI, "check", "--proofs", "--dir", dir, ...args],
    { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
}

function withBacklog(n, fn, command) {
  const dir = backlog(n, command);
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── The cost, before the first command ────────────────────────────────────

test("the audit states what it is about to cost before it runs anything", () => {
  withBacklog(2, (dir) => {
    const r = check(dir);
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.err, /re-running 2 verification command\(s\) from 2 proven closing\(s\)/,
      "the run began without saying how big it was: " + r.err);
    // The way out is named where the cost is named; an operator told only that
    // it is expensive has been told half of it.
    assert.match(r.err, /--since <sha>/, "the narrowing was not offered: " + r.err);
  });
});

// ── A line per task, with a count that moves ──────────────────────────────

test("the audit names each task as it reaches it, and how much is left", () => {
  withBacklog(2, (dir) => {
    const r = check(dir);
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.err, /\[1\/2\] TASK-1/, "the first task was not announced: " + r.err);
    assert.match(r.err, /\[2\/2\] TASK-2/, "the second task was not announced: " + r.err);
    // The commands remaining, not only the tasks: one task can carry a whole
    // suite, and "1 task left" says nothing about how long that is.
    assert.match(r.err, /2 command\(s\) left/);
    assert.match(r.err, /1 command\(s\) left/);
    // The command in flight is named BEFORE it runs — that is the line somebody
    // reads while it hangs.
    assert.match(r.err, /→ true/, "the entry in flight was not named: " + r.err);
  });
});

// ── The report is unchanged, and stays on its own stream ──────────────────

test("the narration is on stderr and the report on stdout, unchanged", () => {
  withBacklog(2, (dir) => {
    const r = check(dir);
    assert.match(r.out, /2 verification command\(s\) re-run across 2 proven closing\(s\)/, r.out);
    assert.doesNotMatch(r.out, /\[1\/2\]/, "the progress leaked into the report: " + r.out);
    assert.doesNotMatch(r.out, /re-running/, "the cost line leaked into the report: " + r.out);
  });
});

// ── One interrupt ends the audit ──────────────────────────────────────────

test("a single signal stops the walk, and it says where it stopped", async () => {
  // The measured failure this defends against: the audit died on the first
  // signal and left the contract it had in flight spawning into temporary
  // trees, so stopping the command took three kills. Here the signal arrives
  // during the first task's contract, the entry in flight is allowed to finish,
  // the second task is never reached, and the exit code is not the one a
  // complete green run owns.
  const dir = backlog(2, "sleep 2");
  try {
    const child = spawn(process.execPath,
      [join(HERE, "..", "check-backlog-proofs.mjs"), "--dir", dir],
      { env: { ...process.env, NO_COLOR: "1" } });
    let err = "";
    child.stderr.on("data", (d) => { err += d; });
    child.stdout.on("data", () => {});

    const finished = new Promise((resolve) => child.on("close", (code) => resolve(code)));
    await new Promise((r) => setTimeout(r, 700));
    child.kill("SIGTERM");
    const code = await finished;

    assert.equal(code, 130, "an interrupted run did not say so in its exit code: " + err);
    assert.match(err, /stopped by SIGTERM after 1 of 2 proven closing\(s\)/, err);
    assert.match(err, /nothing was left running/, err);
    assert.doesNotMatch(err, /\[2\/2\]/, "the walk carried on past the signal: " + err);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── POSITIVE CONTROL: the narration can be switched off ───────────────────

test("`--quiet` silences the narration and leaves the report alone", () => {
  withBacklog(2, (dir) => {
    const r = spawnSync(process.execPath,
      [CLI, "check", "--proofs", "--json", "--dir", dir],
      { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
    assert.equal(r.status, 0, (r.stdout || "") + (r.stderr || ""));
    const doc = JSON.parse(r.stdout);
    assert.deepEqual(doc.guards.map((g) => g.name), ["proofs"]);
    assert.doesNotMatch(doc.guards[0].output, /\[1\/2\]/,
      "the narration was captured into the JSON document: " + doc.guards[0].output);
    assert.match(doc.guards[0].output, /2 verification command\(s\) re-run/, doc.guards[0].output);

    // The control for the control: the same guard, asked directly with
    // `--quiet`, is silent on stderr — so the assertion above is testing the
    // flag and not the JSON capture swallowing everything.
    const direct = spawnSync(process.execPath,
      [join(HERE, "..", "check-backlog-proofs.mjs"), "--dir", dir, "--quiet"],
      { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
    assert.equal(direct.status, 0, direct.stderr);
    assert.equal((direct.stderr || "").trim(), "", "`--quiet` still narrated: " + direct.stderr);
  });
});
