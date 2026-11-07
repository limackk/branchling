/**
 * `check --proofs` runs a project `closing_contract` entry once per audit
 * (TL-497).
 *
 * WHAT HAS TO BE PROVED. Every proven closing's contract ends in the project's
 * entries (TL-495), and against one tree those entries give one answer. The
 * audit must therefore run each of them ONCE and reuse the result, and report a
 * red one ONCE, as a project finding naming the closings it would have failed.
 *
 * WHY THE COUNT IS READ FROM A FILE. The project entry appends a line to a file
 * each time it runs, so the number of lines is the number of runs — measured,
 * not inferred from what the report says about itself. The count is asserted to
 * be exactly one, which is also the positive control: a guard that skipped the
 * project entry altogether would leave zero lines, and fail here.
 *
 * Fixtures live in temporary directories with their own `config.yaml`; history
 * is written directly, because what is under test is what the audit makes of
 * closings that already exist.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fixtureDir } from "./_fixture-dir.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { REASON_PROVEN, REASON_UNKNOWN } from "../history.mjs";

import { isolateHome, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("proofs-project-once");

const CLI = join(SCRIPTS_DIR, "cli.mjs");

function closedTask(id, ownCommand) {
  return [
    "---", `id: ${id}`, 'title: "A closed task"', "type: task", "labels: []", "board: main", 'epic: ""',
    "priority: P1", "status: done", "owner: local:test", "estimate: 2h", "confidence: high",
    "created: 2026-08-01", "updated: 2026-08-01", "blocked_by: []", "blocks: []",
    "verification:", `  - id: own-${id.toLowerCase()}`, `    bash: "${ownCommand}"`,
    "---", "", "## Goal", "", "Something proved once.", "",
  ].join("\n");
}

function provenHistory(id) {
  const row = (from, to, source, reason) => JSON.stringify({
    id: "E" + Math.random().toString(36).slice(2), ts: "2026-08-02T10:00:00.000Z",
    task: id, field: "status", from, to, actor: "local:closer", source, reason,
  });
  return row("pending", "in_progress", "take", REASON_UNKNOWN) + "\n" +
    row("in_progress", "done", "done", REASON_PROVEN) + "\n";
}

/** A backlog with one proven closing per entry of `owns`, and `projectCommand` as the project contract. */
function withBacklog(projectCommand, owns, fn) {
  const dir = fixtureDir(join(tmpdir(), "branchling-proofs-once-"));
  mkdirSync(join(dir, "tasks"));
  mkdirSync(join(dir, "history"));
  writeFileSync(join(dir, "_template.md"), "---\nid: TASK-NNN\n---\n", "utf8");
  writeFileSync(join(dir, "boards.yaml"), 'default: main\nboards:\n  - slug: main\n    name: "Main"\n', "utf8");
  writeFileSync(join(dir, "config.yaml"),
    'task_id_prefix: "TASK"\nclosing_contract:\n  - id: repo-guard\n    bash: "' + projectCommand + '"\n', "utf8");
  owns.forEach((own, i) => {
    const id = "TASK-" + (i + 1);
    writeFileSync(join(dir, "tasks", `${id}-closed.md`), closedTask(id, own), "utf8");
    writeFileSync(join(dir, "history", `${id}.jsonl`), provenHistory(id), "utf8");
  });
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function checkProofs(dir) {
  const r = spawnSync(process.execPath, [CLI, "check", "--proofs", "--dir", dir],
    { encoding: "utf8", input: "", env: { ...process.env, NO_COLOR: "1" } });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

const runsOf = (dir) =>
  existsSync(join(dir, "project-runs")) ? readFileSync(join(dir, "project-runs"), "utf8").split("\n").filter(Boolean).length : 0;

test("two proven closings, one run of the project entry", () => {
  withBacklog("echo run >> project-runs", ["true", "true"], (dir) => {
    const r = checkProofs(dir);
    assert.equal(r.code, 0, r.out);
    assert.equal(runsOf(dir), 1, "the project entry ran " + runsOf(dir) + " times for two closings\n" + r.out);
    assert.match(r.out, /3 verification command\(s\) re-run across 2 proven closing/);
    assert.match(r.out, /1 project `closing_contract` entr\(ies\) run once and applied to 2 proven closing/);
    // The cost line counts what will run, not the project entry once per closing.
    assert.match(r.out, /re-running 3 verification command\(s\) from 2 proven closing/);
  });
});

test("the project entry runs after the first closing's own entries, as done orders them", () => {
  withBacklog("test -f own-1 && echo run >> project-runs", ["touch own-1", "true"], (dir) => {
    const r = checkProofs(dir);
    assert.equal(r.code, 0, r.out);
    assert.equal(runsOf(dir), 1, r.out);
  });
});

test("POSITIVE CONTROL: a red project entry is one project finding naming every closing it would fail", () => {
  withBacklog("echo run >> project-runs; exit 3", ["true", "true"], (dir) => {
    const r = checkProofs(dir);
    assert.equal(r.code, 1, r.out);
    assert.equal(runsOf(dir), 1, r.out);
    assert.match(r.out, /1 project `closing_contract` entr\(ies\) no longer pass — 2 proven closing\(s\) would fail on them/);
    assert.match(r.out, /- repo-guard: `echo run >> project-runs; exit 3` exits 3\n\s+would fail: TASK-1, TASK-2/);
    // Not repeated as a broken proof of each task: the repair is not in them.
    assert.doesNotMatch(r.out, /closed task\(s\) whose proof no longer holds/);
  });
});

test("a closing whose own entry fails is its own broken proof and is not named under the project finding", () => {
  withBacklog("echo run >> project-runs; exit 3", ["false", "true"], (dir) => {
    const r = checkProofs(dir);
    assert.equal(r.code, 1, r.out);
    assert.equal(runsOf(dir), 1, r.out);
    assert.match(r.out, /1 closed task\(s\) whose proof no longer holds/);
    assert.match(r.out, /- TASK-1 .*`false` exits 1/);
    assert.match(r.out, /would fail: TASK-2\n/);
  });
});
