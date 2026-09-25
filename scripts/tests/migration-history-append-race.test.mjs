/**
 * A history append racing the history-log rename in an id migration (TL-410).
 *
 * The migration record is written before the tree moves. A writer that started
 * with the old id can therefore be accepted on either side of the rename, but
 * its event must finish in the log named by the new id. The large fixture is a
 * timing CONTROL, not load coverage: once the first history file has moved,
 * the remaining renames keep the real migration process alive long enough for
 * the parent to append through `recordEdit`. The test also asserts that the
 * migration has not reported completion at that instant, so a green result
 * cannot come from two operations that merely ran one after the other.
 *
 * Each migration also has a positive control with the same fixture and final
 * assertion, but with the append completed before the migration starts. That
 * proves the expected event is readable when there is no collision.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { recordEdit } from "../history.mjs";
import { SCRIPTS_DIR, isolateHome, plainOutput } from "./_repo.mjs";

const CLI = join(SCRIPTS_DIR, "cli.mjs");
const TASKS = 1200;
const NEW_PREFIX = "ZZQ";
const RENUMBER_START = 5001;

isolateHome("migration-history-append-race");
plainOutput();

const MIGRATIONS = [
  {
    label: "migrate-prefix",
    args: (f) => ["migrate-prefix", "--dir", f.backlog, "--to", NEW_PREFIX, "--actor", "agent:migration"],
    newId: (oldId) => oldId.replace(/^BL-/, NEW_PREFIX + "-"),
  },
  {
    label: "renumber",
    args: (f) => ["renumber", "--dir", f.backlog, "--start", String(RENUMBER_START), "--actor", "agent:migration"],
    newId: () => "BL-" + RENUMBER_START,
  },
];

let fixtureNumber = 0;

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "branchling-history-append-race-" + fixtureNumber++ + "-"));
  const backlog = join(dir, "backlog");
  const tasks = join(backlog, "tasks");
  const history = join(backlog, "history");
  const state = process.env.BACKLOG_STATE_DIR;
  mkdirSync(tasks, { recursive: true });
  mkdirSync(history, { recursive: true });
  writeFileSync(join(backlog, "config.yaml"), [
    "task_id_prefix: BL",
    "statuses: [pending, in_progress, awaiting_vouch, blocked, done, cancelled]",
    "archived_statuses: [done, cancelled]",
    "priorities: [P1]",
    "dashboard_open_statuses: [pending, in_progress, awaiting_vouch, blocked]",
    "reason_required_statuses: [blocked, cancelled]",
    "lock_ttl_minutes: 120",
    "",
  ].join("\n"), "utf8");
  writeFileSync(join(backlog, "plan.yaml"), "waves: []\n", "utf8");

  for (let n = 1; n <= TASKS; n++) {
    const id = "BL-" + n;
    writeFileSync(join(tasks, id + "-task-number-" + n + ".md"), [
      "---",
      "id: " + id,
      "title: Task number " + n,
      "status: pending",
      "priority: P1",
      "board: main",
      "blocked_by: []",
      "blocks: []",
      "---",
      "",
    ].join("\n"), "utf8");
    writeFileSync(join(history, id + ".jsonl"), JSON.stringify({
      id: "seed-" + n,
      ts: "2026-01-01T00:00:00.000Z",
      task: id,
      field: "title",
      from: "",
      to: "Task number " + n,
      actor: "local:seed",
      source: "manual",
      reason: "seed",
    }) + "\n", "utf8");
  }

  return {
    dir, backlog, state,
    env: { ...process.env, NO_COLOR: "1" },
    oldId: "BL-1",
  };
}

function appendWriterEvent(f) {
  const before = { id: f.oldId, title: "Task number 1", status: "pending", priority: "P1", board: "main" };
  const after = { ...before, title: "Writer changed the title" };
  recordEdit(f.backlog, {
    taskId: f.oldId,
    before,
    after,
    actor: "agent:writer",
    source: "manual",
    reason: "the concurrent writer's change",
    session: "",
  });
}

function assertWriterEvent(f, migration) {
  const newId = migration.newId(f.oldId);
  const file = join(f.backlog, "history", newId + ".jsonl");
  assert.ok(existsSync(file), "the migrated history log must exist: " + file);
  const events = readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const writes = events.filter((event) => event.actor === "agent:writer" && event.field === "title");
  assert.equal(writes.length, 1, "the accepted writer event must be readable exactly once under " + newId);
  assert.equal(writes[0].task, newId, "the event inside the renamed log must name the task's new id");
}

function runMigration(f, migration) {
  return spawnSync(process.execPath, [CLI].concat(migration.args(f)), {
    encoding: "utf8",
    env: f.env,
    timeout: 120_000,
  });
}

function waitFor(fn, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (fn()) return true;
    if (Date.now() >= deadline) return false;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);
  }
}

for (const migration of MIGRATIONS) {
  test("POSITIVE CONTROL: " + migration.label + " carries an event appended before it starts", () => {
    const f = fixture();
    appendWriterEvent(f);
    const result = runMigration(f, migration);
    assert.equal(result.status, 0, result.stderr);
    assertWriterEvent(f, migration);
  });

  test(migration.label + " keeps an event appended after its history rename has started", async () => {
    const f = fixture();
    const complete = join(f.dir, "migration-complete");
    const wrapper = join(f.dir, "migration-child.mjs");
    writeFileSync(wrapper, [
      'import { spawnSync } from "node:child_process";',
      'import { writeFileSync } from "node:fs";',
      'const [cli, complete, ...args] = process.argv.slice(2);',
      'const result = spawnSync(process.execPath, [cli, ...args], { stdio: "inherit", env: process.env });',
      'writeFileSync(complete, String(result.status), "utf8");',
      'process.exit(result.status === null ? 1 : result.status);',
    ].join("\n"), "utf8");

    const child = spawn(process.execPath, [wrapper, CLI, complete].concat(migration.args(f)), {
      stdio: ["ignore", "ignore", "inherit"],
      env: f.env,
    });
    const newLog = join(f.backlog, "history", migration.newId(f.oldId) + ".jsonl");
    assert.ok(waitFor(() => existsSync(newLog), 120_000), "the migration never began renaming history logs");
    assert.equal(existsSync(complete), false,
      "the migration completed before the append, so this run did not sample the race");

    appendWriterEvent(f);

    const code = await new Promise((resolve) => child.on("exit", resolve));
    assert.equal(code, 0, "the migration command itself must succeed");
    assert.equal(readFileSync(complete, "utf8"), "0");
    assertWriterEvent(f, migration);
  });
}
