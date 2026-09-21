/**
 * A hand that repeats itself is reported as such, and its work is named (TL-283).
 *
 * WHAT HAPPENED. On 2026-09-05 the hand working TL-150 was cut off by its
 * vendor mid-task. Its whole transcript, twice, was one line — `You've hit your
 * session limit · resets 12:10pm` — and between the two the tree already held
 * the deliverable the hand had written and could not commit. The loop ran the
 * contract, an eighty-second suite, once per attempt to learn the same thing
 * twice, and then parked the task with `no verification after 2 agent attempts:
 * suite-green`. That sentence is a finding about the WORK, and it was false:
 * nothing about the work had been established.
 *
 * WHAT IS OBSERVED, AND WHAT IS NOT ACTED ON. The loop does not read the
 * vendor's wording — "session limit" is a literal about somebody else's product
 * and the next vendor phrases it differently. What it observes is that every
 * attempt on one task produced BYTE-IDENTICAL, NON-EMPTY output, which a hand
 * reacting to a tree the previous attempt moved does not do.
 *
 * IT IS REPORTED, NOT ACTED ON, and the reason is in this repository already:
 * `contract-scope.test.mjs` and `run-agent-launch.test.mjs` each pin a hand that
 * prints the same line on every attempt, fails its contract, and MUST keep every
 * attempt and be parked naming the entry it failed. A quota cut-off and a hand
 * that deterministically gives up are the same bytes, so an ending built on that
 * evidence would rename a real contract failure. The ending, the attempts and
 * the entry in the reason are therefore untouched; what changes is that the
 * reader is given the evidence and the hand's own words, and is told that the
 * work the hand left is uncommitted in the tree.
 *
 * THE POSITIVE CONTROL is the second test: a hand whose output DIFFERS between
 * attempts carries no such observation, so the flag cannot be something the loop
 * sets on every parked task.
 *
 * THE THIRD TEST guards the empty transcript, which belongs to TL-184: two
 * attempts that print NOTHING are identical too, and this observation must not
 * appear on a task the loop hands back rather than parks.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HOME_ENV } from "../home.mjs";
import { isolateHome, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("agent-refusal-not-an-attempt");

const CLI = join(SCRIPTS_DIR, "cli.mjs");
const ACTOR = "agent:worker";

/** The one line the cut-off hand printed, twice, on 2026-09-05. Quoted as a
 *  transcript, not matched as a pattern — nothing in the loop reads it. */
const CUT_OFF_LINE = "You've hit your session limit";

function cli(args, env, cwd) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    cwd, encoding: "utf8", timeout: 180_000, env,
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

/** The reason recorded with the park — the sentence a later reader meets. */
function parkReason(backlog, id) {
  const parks = history(backlog, id).filter((e) => e.field === "status" && e.to === "blocked");
  return parks.length ? String(parks[parks.length - 1].reason || "") : "";
}

/**
 * One task whose contract counts its own executions, so the cost of an attempt
 * is measurable rather than asserted.
 */
function fixture(title) {
  const root = mkdtempSync(join(tmpdir(), "branchling-repeat-"));
  const repo = join(root, "repo");
  const backlog = join(repo, "backlog");
  mkdirSync(repo, { recursive: true });
  // A REAL git repository: TL-184's second signal is `git status --porcelain`,
  // and outside git the question cannot be asked at all.
  const g = spawnSync("git", ["-C", repo, "init", "--quiet"], { encoding: "utf8" });
  assert.equal(g.status, 0, g.stderr);
  const env = {
    ...process.env, NO_COLOR: "1",
    [HOME_ENV]: join(root, "home"), BACKLOG_STATE_DIR: join(root, "state"),
  };
  assert.equal(cli(["init", "--dir", backlog, "--no-example"], env, root).status, 0);
  const cfg = join(backlog, "config.yaml");
  writeFileSync(cfg, readFileSync(cfg, "utf8")
    .replace(/^owners:.*$/m, "owners: [unassigned, " + ACTOR + "]"), "utf8");

  const created = cli(["new", "--dir", backlog, "--title", title, "--priority", "P1"], env, repo);
  assert.equal(created.status, 0, created.stderr);
  const id = created.stdout.match(/[A-Z]+-\d+/)[0];
  const witness = join(root, "contract-runs.txt");
  const file = taskFile(backlog, id);
  writeFileSync(file, readFileSync(file, "utf8")
    .replace(/verification:[\s\S]*?\n---/,
      'verification:\n  - id: it-is-done\n    bash: "echo ran >> ' + witness + ' && test -f ' + id + '.done"\n---')
    .replace(/\[proof:[^\]]*\]/g, "[proof: it-is-done]"), "utf8");
  assert.equal(cli(["build", "--dir", backlog], env, repo).status, 0);
  return { root, repo, backlog, env, id, witness };
}

function agentScript(root, name, body) {
  const p = join(root, name);
  writeFileSync(p, "#!/bin/sh\n" + body + "\n", "utf8");
  chmodSync(p, 0o755);
  return p;
}

function contractRuns(witness) {
  return existsSync(witness) ? readFileSync(witness, "utf8").split("\n").filter(Boolean).length : 0;
}

function withFixture(title, f) {
  const fx = fixture(title);
  try {
    return f(fx);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
}

test("byte-identical attempts are recorded, quoted, and change no ending", () => {
  withFixture("Task the hand was cut off in", ({ root, repo, backlog, env, id, witness }) => {
    // The hand of 2026-09-05: it writes a deliverable into the tree — so
    // TL-184's guard correctly does NOT fire — and then prints the same refusal
    // every time it is asked.
    const agent = agentScript(root, "cut-off.sh", [
      "cat >/dev/null",
      'printf "half the work\\n" > ' + JSON.stringify(join(repo, "deliverable.txt")),
      'printf "' + CUT_OFF_LINE + '\\n"',
    ].join("\n"));

    // Two attempts, as the run of 2026-09-05 was given.
    const r = cli(["run", "--dir", backlog, "--actor", ACTOR, "--agent", agent,
      "--max-attempts", "2", "--json"], env, repo);
    assert.equal(r.status, 0, r.stdout + r.stderr);

    const report = JSON.parse(r.stdout);
    const row = report.tasks.find((t) => t.id === id);
    // THE ENDING IS UNTOUCHED, deliberately: the contract really is red, the
    // attempts really were spent, and no cause is inferred from the bytes.
    assert.equal(row.outcome, "exhausted");
    assert.equal(row.attempts, 2);
    assert.equal(report.tally.blocked, 1);
    // WHAT IS NEW: the observation and the hand's own last line, in the one
    // field an unattended caller reads.
    assert.equal(row.repeatedOutput, true,
      "`--json` does not say the attempts were byte-identical");
    assert.match(String(row.said), new RegExp(CUT_OFF_LINE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      "`--json` does not carry what the hand actually said");

    // THE SENTENCE A LATER READER MEETS. It still names the entry that failed —
    // a red contract is a fact whatever the hand was doing — and it no longer
    // stops there.
    assert.equal(statusOf(backlog, id), "blocked");
    const reason = parkReason(backlog, id);
    assert.match(reason, /it-is-done/, "the park no longer names the entry that failed");
    assert.match(reason, /byte-identical/, "the park does not say what was observed");
    assert.match(reason, new RegExp(CUT_OFF_LINE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      "the park does not quote what the hand actually said");

    // The hand's half-written deliverable really is sitting in the tree — the
    // premise of the paragraph the terminal report adds below.
    assert.ok(existsSync(join(repo, "deliverable.txt")), "the fixture's hand wrote nothing");
  });
});

test("POSITIVE CONTROL: a hand whose output DIFFERS carries no such observation", () => {
  withFixture("Task nobody finishes", ({ root, repo, backlog, env, id, witness }) => {
    // Different bytes every time, and the contract genuinely red: the ordinary
    // failing run the retry exists for.
    const agent = agentScript(root, "working.sh", [
      "cat >/dev/null",
      'n=$(cat ' + JSON.stringify(join(root, "n")) + ' 2>/dev/null || echo 0)',
      "n=$((n+1))",
      'printf "%s" "$n" > ' + JSON.stringify(join(root, "n")),
      'printf "attempt %s did some work\\n" "$n"',
      'printf "%s" "$n" > ' + JSON.stringify(join(repo, "progress.txt")),
    ].join("\n"));

    const r = cli(["run", "--dir", backlog, "--actor", ACTOR, "--agent", agent,
      "--max-attempts", "2", "--json"], env, repo);
    assert.equal(r.status, 0, r.stdout + r.stderr);

    const report = JSON.parse(r.stdout);
    const row = report.tasks.find((t) => t.id === id);
    assert.equal(row.outcome, "exhausted", "a genuinely failing hand was cut short");
    assert.equal(row.attempts, 2);
    assert.equal(report.tally.blocked, 1);
    assert.notEqual(row.repeatedOutput, true,
      "the observation is set on every parked task, so it says nothing");
    // The baseline probe taken at the claim, plus — per attempt — the `done`
    // that refused and the probe behind it that asks whether the red was
    // inherited (TL-242). Five, and every one of them bought an answer.
    assert.equal(contractRuns(witness), 5, "the loop stopped running the contract it was told to run");
    assert.equal(statusOf(backlog, id), "blocked");
    const reason = parkReason(backlog, id);
    assert.match(reason, /it-is-done/,
      "a task whose contract really failed no longer names the entry that failed");
    assert.doesNotMatch(reason, /byte-identical/,
      "a hand that answered differently each time was still called a repeater");
  });
});

test("an EMPTY transcript is still TL-184's ending, not this one", () => {
  withFixture("Task whose hand says nothing", ({ root, repo, backlog, env, id }) => {
    // Two attempts printing nothing are byte-identical as well. They belong to
    // the guard that already answers them: nothing said and nothing changed is
    // `agent-never-ran`, the claim goes back, and the task is not parked.
    const agent = agentScript(root, "silent.sh", "cat >/dev/null");

    const r = cli(["run", "--dir", backlog, "--actor", ACTOR, "--agent", agent,
      "--max-attempts", "3", "--json"], env, repo);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    const report = JSON.parse(r.stdout);
    const row = report.tasks.find((t) => t.id === id);
    assert.equal(row.outcome, "agent-never-ran");
    assert.notEqual(row.repeatedOutput, true,
      "the observation took over the case TL-184 already answers");
    assert.equal(statusOf(backlog, id), "pending", "the claim was not given back");
  });
});

test("the terminal report quotes the hand and names the work it left", () => {
  withFixture("Task whose hand was cut off, read on the terminal", ({ root, repo, backlog, env, id }) => {
    const agent = agentScript(root, "cut-off.sh", [
      "cat >/dev/null",
      'printf "half the work\\n" > ' + JSON.stringify(join(repo, "deliverable.txt")),
      'printf "' + CUT_OFF_LINE + '\\n"',
    ].join("\n"));

    const r = cli(["run", "--dir", backlog, "--actor", ACTOR, "--agent", agent,
      "--max-attempts", "2"], env, repo);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /printed byte-identical output/,
      "the report does not say what it saw across the attempts");
    assert.match(r.stdout, new RegExp(CUT_OFF_LINE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      "the report does not quote the hand");
    assert.match(r.stdout, /STAYS IN YOUR TREE, uncommitted/,
      "the report does not say the hand's unfinished work is still here");
    // Pointed at, not duplicated: `resume` already reports the uncommitted half
    // of a task's work (TL-272).
    assert.match(r.stdout, new RegExp("resume " + id),
      "the report does not point at where that work is listed");
  });
});
