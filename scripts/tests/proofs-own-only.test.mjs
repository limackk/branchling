/**
 * `check --proofs --task <ID> --own-only` re-runs one task's own entries and no
 * project `closing_contract` entry (TL-557).
 *
 * WHAT HAS TO BE PROVED. Where the project contract is the whole test suite, a
 * session held to targeted tests must be able to ask whether one task's proof
 * still holds without starting that suite. So the audit must run the named
 * task's entries, no other task's, and none of the project's.
 *
 * WHY THE RUNS ARE COUNTED FROM FILES. Every entry in the fixture appends a line
 * to a file of its own, so what ran is measured, not inferred from what the
 * report says about itself. The POSITIVE CONTROL runs the same fixture without
 * `--own-only` and sees the project entry run: a fixture whose project entry
 * could never run would make "it did not run" prove nothing.
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

isolateHome("proofs-own-only");

const CLI = join(SCRIPTS_DIR, "cli.mjs");

function taskFile(id, status, ownCommand) {
  return [
    "---", `id: ${id}`, 'title: "A task"', "type: task", "labels: []", "board: main", 'epic: ""',
    "priority: P1", `status: ${status}`, "owner: local:test", "estimate: 2h", "confidence: high",
    "created: 2026-08-01", "updated: 2026-08-01", "blocked_by: []", "blocks: []",
    "verification:", `  - id: own-${id.toLowerCase()}`, `    bash: "${ownCommand}"`,
    "---", "", "## Goal", "", "Something to prove.", "",
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

/**
 * TASK-1 and TASK-2 are proven closings, TASK-3 is in progress and TASK-4 has
 * not been started. Each entry appends to a file named after it.
 */
function withBacklog(fn, { ownOne = "echo run >> own-1" } = {}) {
  const dir = fixtureDir(join(tmpdir(), "branchling-proofs-own-only-"));
  mkdirSync(join(dir, "tasks"));
  mkdirSync(join(dir, "history"));
  writeFileSync(join(dir, "_template.md"), "---\nid: TASK-NNN\n---\n", "utf8");
  writeFileSync(join(dir, "boards.yaml"), 'default: main\nboards:\n  - slug: main\n    name: "Main"\n', "utf8");
  writeFileSync(join(dir, "config.yaml"),
    'task_id_prefix: "TASK"\nclosing_contract:\n  - id: repo-suite\n    bash: "echo run >> project-runs"\n', "utf8");
  const tasks = [
    ["TASK-1", "done", ownOne, true],
    ["TASK-2", "done", "echo run >> own-2", true],
    ["TASK-3", "in_progress", "echo run >> own-3", false],
    ["TASK-4", "pending", "echo run >> own-4; exit 1", false],
  ];
  for (const [id, status, command, proven] of tasks) {
    writeFileSync(join(dir, "tasks", `${id}-task.md`), taskFile(id, status, command), "utf8");
    if (proven) writeFileSync(join(dir, "history", `${id}.jsonl`), provenHistory(id), "utf8");
  }
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function check(dir, ...flags) {
  const r = spawnSync(process.execPath, [CLI, "check", ...flags, "--dir", dir],
    { encoding: "utf8", input: "", env: { ...process.env, NO_COLOR: "1" } });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

const runsOf = (dir, name) =>
  existsSync(join(dir, name)) ? readFileSync(join(dir, name), "utf8").split("\n").filter(Boolean).length : 0;

test("the own-only audit of one task runs that task's entries and no project entry", () => {
  withBacklog((dir) => {
    const r = check(dir, "--proofs", "--task", "TASK-1", "--own-only");
    assert.equal(r.code, 0, r.out);
    assert.equal(runsOf(dir, "own-1"), 1, "the named task's own entry did not run once\n" + r.out);
    assert.equal(runsOf(dir, "project-runs"), 0, "a project entry ran under --own-only\n" + r.out);
    for (const other of ["own-2", "own-3", "own-4"]) {
      assert.equal(runsOf(dir, other), 0, other + " ran, but only TASK-1 was named\n" + r.out);
    }
    assert.match(r.out, /1 verification command\(s\) re-run across 1 proven closing/);
    // The report says what it left out, so this green cannot pass for a full one.
    assert.match(r.out, /narrowed to TASK-1 by `--task`/);
    assert.match(r.out, /own entries only \(`--own-only`\): 1 project `closing_contract` entr\(ies\) not run/);
  });
});

test("POSITIVE CONTROL: without --own-only the same audit runs the project entry", () => {
  withBacklog((dir) => {
    const r = check(dir, "--proofs", "--task", "TASK-1");
    assert.equal(r.code, 0, r.out);
    assert.equal(runsOf(dir, "own-1"), 1, r.out);
    assert.equal(runsOf(dir, "project-runs"), 1, "the fixture's project entry never runs\n" + r.out);
    assert.equal(runsOf(dir, "own-2"), 0, r.out);
    assert.doesNotMatch(r.out, /own entries only/);
  });
});

test("--own-only over the whole archive runs every own entry and still no project entry", () => {
  withBacklog((dir) => {
    const r = check(dir, "--proofs", "--own-only");
    assert.equal(r.code, 0, r.out);
    assert.equal(runsOf(dir, "own-1"), 1, r.out);
    assert.equal(runsOf(dir, "own-2"), 1, r.out);
    assert.equal(runsOf(dir, "project-runs"), 0, r.out);
  });
});

test("a red own entry still fails the own-only audit", () => {
  withBacklog((dir) => {
    const r = check(dir, "--proofs", "--task", "TASK-1", "--own-only");
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /1 closed task\(s\) whose proof no longer holds/);
    assert.match(r.out, /- TASK-1 .*`false` exits 1/);
    assert.equal(runsOf(dir, "project-runs"), 0, r.out);
  }, { ownOne: "false" });
});

test("a named task nobody has started gets its own contract run, and no project entry", () => {
  withBacklog((dir) => {
    const r = check(dir, "--proofs", "--task", "TASK-4", "--own-only");
    assert.equal(r.code, 0, r.out);
    assert.equal(runsOf(dir, "own-4"), 1, r.out);
    assert.equal(runsOf(dir, "own-1") + runsOf(dir, "project-runs"), 0, r.out);
    assert.match(r.out, /1 open contract\(s\) can still fail against this tree/);
  });
});

test("a named task with no proof to re-run is a refusal, not a zero-sample green", () => {
  withBacklog((dir) => {
    const r = check(dir, "--proofs", "--task", "TASK-3", "--own-only");
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /TASK-3 has no proof this audit can re-run — it is `in_progress`/);
    assert.equal(runsOf(dir, "own-3") + runsOf(dir, "project-runs"), 0, r.out);

    const missing = check(dir, "--proofs", "--task", "TASK-99", "--own-only");
    assert.equal(missing.code, 1, missing.out);
    assert.match(missing.out, /no task `TASK-99`/);
  });
});

test("--task and --own-only are refused without --proofs, and --task without an id", () => {
  withBacklog((dir) => {
    for (const flags of [["--own-only"], ["--task", "TASK-1"], ["--proofs", "--task"]]) {
      const r = check(dir, ...flags);
      assert.equal(r.code, 2, flags.join(" ") + "\n" + r.out);
    }
    assert.equal(runsOf(dir, "own-1") + runsOf(dir, "project-runs"), 0);
  });
});
