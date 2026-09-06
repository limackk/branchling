/** `release` returns a claimant's task to the queue (TL-304). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isolateHome, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("release");
const CLI = join(SCRIPTS_DIR, "cli.mjs");
function run(cwd, args) { return spawnSync(process.execPath, [CLI].concat(args), { cwd, encoding: "utf8", env: { ...process.env, NO_COLOR: "1", BACKLOG_STATE_DIR: join(cwd, ".state") } }); }
function fixture() { const dir = mkdtempSync(join(tmpdir(), "branchling-release-")); assert.equal(run(dir, ["init", "--dir", ".", "--no-example"]).status, 0); const r = run(dir, ["new", "--title", "Release fixture"]); return { dir, id: r.stdout.match(/[A-Z]+-\d+/)[0] }; }
function text(dir, id) { return readFileSync(join(dir, "tasks", readdirSync(join(dir, "tasks")).find((f) => f.startsWith(id + "-"))), "utf8"); }

test("a claimant releases the task, records why, and another actor can take it", () => {
  const { dir, id } = fixture();
  assert.equal(run(dir, ["take", id, "--actor", "agent:first"]).status, 0);
  const released = run(dir, ["release", id, "--actor", "agent:first", "--reason", "Deferred to the next phase.", "--json"]);
  assert.equal(released.status, 0, released.stderr);
  assert.match(text(dir, id), /^status: pending/m);
  assert.match(text(dir, id), /^owner: ""/m);
  assert.equal(run(dir, ["take", id, "--actor", "agent:second"]).status, 0);
});

test("release refuses another actor and a closed task", () => {
  const { dir, id } = fixture();
  assert.equal(run(dir, ["take", id, "--actor", "agent:first"]).status, 0);
  assert.equal(run(dir, ["release", id, "--actor", "agent:second", "--reason", "Not mine."]).status, 1);
  assert.equal(run(dir, ["done", id, "--actor", "agent:first"]).status, 1);
});

test("a JSON refusal keeps the release envelope and names the cause", () => {
  const { dir, id } = fixture();
  assert.equal(run(dir, ["take", id, "--actor", "agent:first"]).status, 0);
  const refused = run(dir, ["release", id, "--actor", "agent:other", "--reason", "Not mine.", "--json"]);
  assert.equal(refused.status, 1);
  const body = JSON.parse(refused.stdout);
  assert.equal(body.kind, "task-release");
  assert.equal(body.ok, false);
  assert.match(body.refusal, /owner: agent:first/);
});
