/**
 * `query --conflict-group <g,…>` (TL-687).
 *
 * Supervised loops schedule by conflict group, and `query` had no axis for it.
 * The answer has to be the group the DISPATCHER reads — the task's own
 * `conflict_group:`, else the field `conflict_group_from` names — so the
 * fixture carries both kinds, a task whose own group replaces the fallback,
 * and a group whose name contains another's, to catch a substring match.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fixtureDir } from "./_fixture-dir.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SCRIPTS_DIR, isolateHome, plainOutput } from "./_repo.mjs";

isolateHome("query-conflict-group");
plainOutput();

const CLI = join(SCRIPTS_DIR, "cli.mjs");

function run(args) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 60_000, env: { ...process.env, NO_COLOR: "1" },
  });
}

function set(dir, id, field, value) {
  const r = run(["set", id, field, value, "--dir", dir, "--actor", "agent:test"]);
  assert.equal(r.status, 0, r.stderr);
}

/**
 * Six tasks:
 *   0  own group `db`
 *   1  own groups `db`, `viewer`
 *   2  own group `viewer-ui` (contains `viewer`, must not match it)
 *   3  no group of its own, epic `db`        → `db` only through the fallback
 *   4  own group `cli`, epic `db`            → the own group replaces the fallback
 *   5  nothing at all                        → in no group
 */
function fixture({ fallback }) {
  const dir = fixtureDir(join(tmpdir(), "branchling-query-conflict-group-"));
  assert.equal(run(["init", "--dir", dir, "--no-example"]).status, 0);
  if (fallback) appendFileSync(join(dir, "config.yaml"), "\nconflict_group_from: epic\n", "utf8");
  const ids = [];
  for (let i = 1; i <= 6; i++) {
    const r = run(["new", "--dir", dir, "--title", "Task number " + i]);
    assert.equal(r.status, 0, r.stderr);
    ids.push(r.stdout.match(/[A-Z]+-\d+/)[0]);
  }
  set(dir, ids[0], "conflict_group", "db");
  set(dir, ids[1], "conflict_group", "db,viewer");
  set(dir, ids[2], "conflict_group", "viewer-ui");
  set(dir, ids[3], "epic", "db");
  set(dir, ids[4], "conflict_group", "cli");
  set(dir, ids[4], "epic", "db");
  return { dir, ids };
}

const ask = (dir, ...args) => {
  const r = run(["query", "--dir", dir, "--json", ...args]);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout).tasks.map((t) => t.id).sort();
};
const pick = (ids, ...n) => n.map((i) => ids[i]).sort();

test("--conflict-group selects exactly the tasks naming that group, never a substring", () => {
  const { dir, ids } = fixture({ fallback: false });
  // Positive control: the tree really holds all six tasks.
  assert.equal(ask(dir).length, 6);
  assert.deepEqual(ask(dir, "--conflict-group", "db"), pick(ids, 0, 1));
  assert.deepEqual(ask(dir, "--conflict-group", "viewer"), pick(ids, 1));
  assert.deepEqual(ask(dir, "--conflict-group", "viewer-ui"), pick(ids, 2));
  assert.deepEqual(ask(dir, "--conflict-group", "nowhere"), []);
});

test("--conflict-group is OR inside the axis and AND across axes", () => {
  const { dir, ids } = fixture({ fallback: false });
  assert.deepEqual(ask(dir, "--conflict-group", "viewer-ui, cli"), pick(ids, 2, 4));
  assert.deepEqual(ask(dir, "--conflict-group", "db,viewer"), pick(ids, 0, 1));
  assert.deepEqual(ask(dir, "--conflict-group", "db", "--text", "number 2"), pick(ids, 1));
  const count = run(["query", "--dir", dir, "--conflict-group", "db,cli", "--count"]);
  assert.equal(count.status, 0, count.stderr);
  assert.equal(count.stdout.trim(), "3");
});

test("--conflict-group \"\" asks for the tasks in no group", () => {
  const { dir, ids } = fixture({ fallback: false });
  assert.deepEqual(ask(dir, "--conflict-group", ""), pick(ids, 3, 5));
});

test("--conflict-group reads the group the dispatcher reads: conflict_group_from fills in, an own group replaces it", () => {
  const { dir, ids } = fixture({ fallback: true });
  // Task 3 is in `db` only through `conflict_group_from: epic`; task 4 carries
  // epic `db` too, but its own `cli` replaces the fallback.
  assert.deepEqual(ask(dir, "--conflict-group", "db"), pick(ids, 0, 1, 3));
  assert.deepEqual(ask(dir, "--conflict-group", "cli"), pick(ids, 4));
  assert.deepEqual(ask(dir, "--conflict-group", ""), pick(ids, 5));
});

test("--conflict-group is documented in query --help", () => {
  const r = run(["query", "--help"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /--conflict-group <g>/);
});
