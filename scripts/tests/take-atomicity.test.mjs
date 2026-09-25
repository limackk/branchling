/**
 * A take is ONE transaction: the task file and its history move together, or
 * neither moves (TL-407).
 *
 * The failure is forced without permissions. The state root remains writable,
 * so `take` can acquire its task reservation, but its `mutex` path is a regular
 * file. History persistence therefore fails before an event is appended on
 * every machine, independently of the user running the suite.
 *
 * The retry proves that the failed command also gives its reservation back;
 * the positive control proves that the guarded path still commits matching
 * frontmatter and history rather than merely refusing every take.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

isolateHome("take-atomicity");

const CLI = join(SCRIPTS_DIR, "cli.mjs");
const STATE = (dir) => join(dir, ".state");
const BROKEN_STATE = (dir) => join(dir, ".broken-state");

function run(dir, args, stateDir = STATE(dir)) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    cwd: dir, encoding: "utf8", timeout: 60_000,
    env: { ...process.env, NO_COLOR: "1", BACKLOG_STATE_DIR: stateDir },
  });
}

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "branchling-take-atomic-"));
  assert.equal(spawnSync("git", ["init", "-q", "."], { cwd: dir }).status, 0);
  assert.equal(run(dir, ["init", "--dir", ".", "--no-example"]).status, 0);
  mkdirSync(BROKEN_STATE(dir), { recursive: true });
  writeFileSync(join(BROKEN_STATE(dir), "mutex"), "not a directory\n", "utf8");
  return dir;
}

function newTask(dir, title) {
  const r = run(dir, ["new", "--dir", ".", "--title", title]);
  assert.equal(r.status, 0, r.stderr);
  const m = r.stdout.match(/[A-Z]+-\d+/);
  assert.ok(m, "the id of the new task is not in the output: " + r.stdout);
  return m[0];
}

function taskFile(dir, id) {
  const name = readdirSync(join(dir, "tasks")).find((f) => f.startsWith(id + "-"));
  assert.ok(name, "no file for " + id);
  return join(dir, "tasks", name);
}

const read = (dir, id) => readFileSync(taskFile(dir, id), "utf8");

function field(text, key) {
  const line = (text.match(new RegExp("^" + key + ": *(.*)$", "m")) || [])[1];
  return line === undefined ? undefined : line.replace(/\s+#.*$/, "").trim();
}

function history(dir, id) {
  const path = join(dir, "history", id + ".jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

test("a history write that fails leaves the task file and log untouched", () => {
  const dir = repo();
  const id = newTask(dir, "Raise the drawbridge");
  const before = { text: read(dir, id), entries: history(dir, id) };

  const r = run(dir, ["take", id, "--dir", ".", "--actor", "agent:claude"], BROKEN_STATE(dir));

  assert.notEqual(r.status, 0, "take reported success although no event could be written");
  assert.equal(read(dir, id), before.text,
    "the frontmatter moved while the history did not — the split truth TL-407 is about");
  assert.deepEqual(history(dir, id), before.entries,
    "a partial history was appended by a command that then failed");
});

test("after the failed write, retry records the complete claim without repair", () => {
  const dir = repo();
  const id = newTask(dir, "Raise the drawbridge");
  const before = read(dir, id);

  assert.notEqual(run(dir, ["take", id, "--dir", ".", "--actor", "agent:claude"], BROKEN_STATE(dir)).status, 0);
  unlinkSync(join(BROKEN_STATE(dir), "mutex"));

  const retry = run(dir, ["take", id, "--dir", ".", "--actor", "agent:claude"], BROKEN_STATE(dir));
  assert.equal(retry.status, 0, retry.stderr);

  const written = history(dir, id).filter((e) => e.source === "take");
  const status = written.filter((e) => e.field === "status");
  const owner = written.filter((e) => e.field === "owner");
  assert.equal(status.length, 1, "retry did not record exactly one status transition");
  assert.equal(status[0].from, field(before, "status"));
  assert.equal(status[0].to, field(read(dir, id), "status"));
  assert.equal(owner.length, 1, "retry did not record exactly one owner transition");
  assert.equal(owner[0].to, field(read(dir, id), "owner"));
});

test("a successful take writes matching status and owner events", () => {
  const dir = repo();
  const id = newTask(dir, "Raise the drawbridge");
  const before = read(dir, id);

  const r = run(dir, ["take", id, "--dir", ".", "--actor", "agent:claude"]);
  assert.equal(r.status, 0, r.stderr);

  const text = read(dir, id);
  assert.notEqual(field(text, "status"), field(before, "status"));
  assert.equal(field(text, "owner"), "agent:claude");

  const written = history(dir, id).filter((e) => e.source === "take");
  const byField = (name) => written.filter((e) => e.field === name);
  assert.equal(byField("status").length, 1);
  assert.equal(byField("status")[0].to, field(text, "status"));
  assert.equal(byField("owner").length, 1);
  assert.equal(byField("owner")[0].to, field(text, "owner"));
});
