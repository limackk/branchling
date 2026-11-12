/**
 * `check --proofs --task <ID>` on a task still in progress refuses with a
 * remedy naming `done <ID> --dry-run` (TL-685).
 *
 * WHY. Sessions ran the audit as a self-check before closing their own task,
 * and got a refusal that named no way forward. The question they were asking —
 * would `done` pass now? — is the one `done <ID> --dry-run` answers: it runs
 * the whole contract `done` runs and changes nothing. The refusal is built in
 * scripts/check-backlog-proofs.mjs.
 *
 * WHAT IS PROVED. The refusal carries the remedy line; the remedy, run as
 * printed, runs the task's contract (the project's half included) and leaves
 * the task file as it was; and nothing ran during the refusal itself. The
 * NEGATIVE CONTROL is a closed task with no proven closing: its refusal must
 * NOT send anybody to `done`, because there is nothing left to close.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fixtureDir } from "./_fixture-dir.mjs";
import { isolateHome, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("check-proofs-in-progress");

const CLI = join(SCRIPTS_DIR, "cli.mjs");

function taskFile(id, status, ownCommand) {
  return [
    "---", `id: ${id}`, 'title: "A task"', "type: task", "labels: []", "board: main", 'epic: ""',
    "priority: P1", `status: ${status}`, "owner: local:test", "estimate: 2h", "confidence: high",
    "created: 2026-08-01", "updated: 2026-08-01", "blocked_by: []", "blocks: []",
    "verification:", `  - id: own-${id.toLowerCase()}`, `    bash: "${ownCommand}"`,
    "---", "", "## Goal", "", "Something to prove.", "",
    "## Acceptance criteria", "", `- [x] it holds [proof: own-${id.toLowerCase()}]`, "",
  ].join("\n");
}

/** TASK-1 is in progress; TASK-2 is closed but no closing of it was proven. */
function backlog() {
  const dir = fixtureDir(join(tmpdir(), "branchling-proofs-in-progress-"));
  mkdirSync(join(dir, "tasks"));
  mkdirSync(join(dir, "history"));
  writeFileSync(join(dir, "_template.md"), "---\nid: TASK-NNN\n---\n", "utf8");
  writeFileSync(join(dir, "boards.yaml"), 'default: main\nboards:\n  - slug: main\n    name: "Main"\n', "utf8");
  writeFileSync(join(dir, "config.yaml"),
    'task_id_prefix: "TASK"\nclosing_contract:\n  - id: repo-suite\n    bash: "echo run >> project-runs"\n', "utf8");
  writeFileSync(join(dir, "tasks", "TASK-1-task.md"), taskFile("TASK-1", "in_progress", "echo run >> own-1"), "utf8");
  writeFileSync(join(dir, "tasks", "TASK-2-task.md"), taskFile("TASK-2", "done", "echo run >> own-2"), "utf8");
  return dir;
}

function cli(dir, ...args) {
  const r = spawnSync(process.execPath, [CLI, ...args, "--dir", dir],
    { encoding: "utf8", input: "", env: { ...process.env, NO_COLOR: "1" } });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

const runsOf = (dir, name) =>
  existsSync(join(dir, name)) ? readFileSync(join(dir, name), "utf8").split("\n").filter(Boolean).length : 0;

const REMEDY = /^ {2}→ (\S+) (done TASK-1 --dry-run)$/m;

test("the refusal on an in-progress task names `done <ID> --dry-run`, and nothing ran", () => {
  const dir = backlog();
  for (const flags of [["--task", "TASK-1"], ["--task", "TASK-1", "--own-only"]]) {
    const r = cli(dir, "check", "--proofs", ...flags);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /TASK-1 has no proof this audit can re-run — it is `in_progress`/);
    assert.match(r.out, REMEDY, "the refusal names no remedy\n" + r.out);
  }
  assert.equal(runsOf(dir, "own-1") + runsOf(dir, "project-runs"), 0, "the refusal ran an entry");
});

test("the remedy, run as printed, runs the whole contract and changes nothing", () => {
  const dir = backlog();
  const refused = cli(dir, "check", "--proofs", "--task", "TASK-1");
  const [, , command] = refused.out.match(REMEDY) || [];
  assert.ok(command, refused.out);
  const file = join(dir, "tasks", "TASK-1-task.md");
  const before = readFileSync(file, "utf8");

  const r = cli(dir, ...command.split(" "), "--actor", "local:test");
  assert.equal(r.code, 0, r.out);
  assert.equal(runsOf(dir, "own-1"), 1, "the task's own entry did not run\n" + r.out);
  assert.equal(runsOf(dir, "project-runs"), 1, "the project's entry did not run\n" + r.out);
  assert.equal(readFileSync(file, "utf8"), before, "the remedy changed the task file");
});

test("NEGATIVE CONTROL: a closed task with no proven closing is not sent to `done`", () => {
  const dir = backlog();
  const r = cli(dir, "check", "--proofs", "--task", "TASK-2");
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /TASK-2 has no proof this audit can re-run — it is `done`, but no closing/);
  // No remedy line at all: an arrow naming nothing would still send the reader
  // looking for a next step that does not exist.
  assert.doesNotMatch(r.out, /→/, r.out);
});
