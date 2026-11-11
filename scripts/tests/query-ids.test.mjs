/**
 * `query --ids <id,id,…>` (TL-680).
 *
 * `--text` matches a substring of "<id> <title>", so `--text X-1` also matches
 * X-10 to X-19 and cannot express a list of known tasks. The fixture therefore
 * holds a task whose id is a prefix of another's: an implementation that
 * matched ids by substring would return both, and this file would notice.
 * One task is closed, so the scope has a different right answer from `all`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fixtureDir } from "./_fixture-dir.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SCRIPTS_DIR, isolateHome, plainOutput } from "./_repo.mjs";

isolateHome("query-ids");
plainOutput();

const CLI = join(SCRIPTS_DIR, "cli.mjs");

function run(args) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 60_000, env: { ...process.env, NO_COLOR: "1" },
  });
}

function setStatus(dir, id, status) {
  const file = readdirSync(join(dir, "tasks")).find((f) => f.startsWith(id + "-"));
  const path = join(dir, "tasks", file);
  writeFileSync(path, readFileSync(path, "utf8").replace(/^status: \S+/m, "status: " + status), "utf8");
}

/** Eleven tasks, so the first id is a textual prefix of the tenth and eleventh
 *  (`X-1` of `X-10`, `X-11`). The second is in progress and the third closed. */
function fixture() {
  const dir = fixtureDir(join(tmpdir(), "branchling-query-ids-"));
  assert.equal(run(["init", "--dir", dir, "--no-example"]).status, 0);
  const ids = [];
  for (let i = 1; i <= 11; i++) {
    const r = run(["new", "--dir", dir, "--title", "Task number " + i]);
    assert.equal(r.status, 0, r.stderr);
    ids.push(r.stdout.match(/[A-Z]+-\d+/)[0]);
  }
  setStatus(dir, ids[1], "in_progress");
  setStatus(dir, ids[2], "cancelled");
  const prefix = ids[0].replace(/-\d+$/, "");
  // The positive control for the substring trap: the first id really is a
  // prefix of the tenth's.
  assert.ok(ids[9].startsWith(ids[0]), ids.join(" "));
  return { dir, ids, prefix };
}

const ask = (dir, ...args) => {
  const r = run(["query", "--dir", dir, "--json", ...args]);
  assert.equal(r.status, 0, r.stderr);
  return { answer: JSON.parse(r.stdout), stderr: r.stderr };
};
const idsOf = (answer) => answer.tasks.map((t) => t.id).sort();

test("--ids selects exactly the listed tasks, never one whose id merely starts the same", () => {
  const fx = fixture();
  const want = [fx.ids[0], fx.ids[1], fx.ids[4]];
  const { answer, stderr } = ask(fx.dir, "--ids", want.join(","));
  assert.deepEqual(idsOf(answer), want.slice().sort());
  assert.equal(answer.total, 3);
  // Every listed id matched, so nothing is reported.
  assert.doesNotMatch(stderr, /matched nothing/);
  // Spaces after the commas are tolerated, as on every other axis.
  assert.deepEqual(idsOf(ask(fx.dir, "--ids", fx.ids[0] + ", " + fx.ids[4]).answer), [fx.ids[0], fx.ids[4]].sort());
});

test("--ids combines with the other criteria (AND between axes)", () => {
  const fx = fixture();
  const list = [fx.ids[0], fx.ids[1], fx.ids[4]].join(",");
  const { answer, stderr } = ask(fx.dir, "--ids", list, "--status", "in_progress");
  assert.deepEqual(idsOf(answer), [fx.ids[1]]);
  // The two held out by --status are named, with the reason that held them.
  for (const id of [fx.ids[0], fx.ids[4]]) {
    assert.match(stderr, new RegExp("# " + id + " matched nothing: it does not meet the other criteria"));
  }
  // --text narrows the same list further, and --count counts the same rows.
  assert.deepEqual(idsOf(ask(fx.dir, "--ids", list, "--text", "number 5").answer), [fx.ids[4]]);
  const count = run(["query", "--dir", fx.dir, "--ids", list, "--status", "pending", "--count"]);
  assert.equal(count.status, 0, count.stderr);
  assert.equal(count.stdout.trim(), "2");
});

test("--ids applies across --scope as the other criteria do", () => {
  const fx = fixture();
  const list = [fx.ids[0], fx.ids[2]].join(",");
  const active = ask(fx.dir, "--ids", list);
  assert.deepEqual(idsOf(active.answer), [fx.ids[0]]);
  assert.match(active.stderr, new RegExp("# " + fx.ids[2] + " matched nothing: its status `cancelled` is outside --scope active"));
  assert.deepEqual(idsOf(ask(fx.dir, "--ids", list, "--scope", "archived").answer), [fx.ids[2]]);
  assert.deepEqual(idsOf(ask(fx.dir, "--ids", list, "--scope", "all").answer), [fx.ids[0], fx.ids[2]].sort());
  assert.deepEqual(idsOf(ask(fx.dir, "--ids", list, "--status", "cancelled").answer), [fx.ids[2]]);
});

test("an id of the right prefix that names no task is reported on stderr, stdout stays the answer", () => {
  const fx = fixture();
  const ghost = fx.prefix + "-999";
  const { answer, stderr } = ask(fx.dir, "--ids", fx.ids[0] + "," + ghost);
  assert.deepEqual(idsOf(answer), [fx.ids[0]]);
  assert.match(stderr, new RegExp("# " + ghost + " matched nothing: no task with this id in this tree"));
  // The text output keeps the note off stdout as well.
  const text = run(["query", "--dir", fx.dir, "--ids", ghost]);
  assert.equal(text.status, 0, text.stderr);
  assert.doesNotMatch(text.stdout, new RegExp(ghost));
  assert.match(text.stderr, new RegExp(ghost + " matched nothing"));
});

test("an id outside the configured prefix is refused, as an unknown value", () => {
  const fx = fixture();
  const foreign = "PROJ-1";
  assert.notEqual(fx.prefix, "PROJ");
  const r = run(["query", "--dir", fx.dir, "--json", "--ids", fx.ids[0] + "," + foreign]);
  assert.equal(r.status, 1, r.stderr);
  const answer = JSON.parse(r.stdout);
  assert.equal(answer.ok, false);
  assert.equal(answer.refusalKind, "unknown-value");
  assert.deepEqual(answer.rejected, { field: "ids", value: foreign });
  assert.deepEqual(answer.declared, [fx.prefix + "-<number>"]);
  // A value that is not an id at all is refused the same way, not searched for.
  const text = run(["query", "--dir", fx.dir, "--ids", "1"]);
  assert.equal(text.status, 1);
  assert.equal(text.stdout, "");
  assert.match(text.stderr, /`1` is not an allowed value for the field `ids`/);
});

test("--ids is listed in query --help", () => {
  const r = run(["query", "--help"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /--ids <id,id,…>/);
});
