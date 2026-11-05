/**
 * `query --scope active|archived|all` (TL-540).
 *
 * The fixture holds one open and one closed task, so each scope has a
 * different right answer; a fixture with only open tasks would let `archived`
 * pass by returning nothing and `all` by returning the default.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SCRIPTS_DIR, isolateHome, plainOutput } from "./_repo.mjs";

isolateHome("query-scope");
plainOutput();

const CLI = join(SCRIPTS_DIR, "cli.mjs");

function run(args) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 60_000, env: { ...process.env, NO_COLOR: "1" },
  });
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "branchling-query-scope-"));
  assert.equal(run(["init", "--dir", dir, "--no-example"]).status, 0);
  const ids = ["Still open", "Already closed"].map((title) => {
    const r = run(["new", "--dir", dir, "--title", title]);
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.match(/[A-Z]+-\d+/)[0];
  });
  // Closed by a hand edit of the file — a supported path, and the template
  // task has no closing contract `done` could run.
  const file = readdirSync(join(dir, "tasks")).find((f) => f.startsWith(ids[1] + "-"));
  const path = join(dir, "tasks", file);
  writeFileSync(path, readFileSync(path, "utf8").replace(/^status: \S+/m, "status: cancelled"), "utf8");
  return { dir, open: ids[0], closed: ids[1] };
}

const ask = (dir, ...args) => {
  const r = run(["query", "--dir", dir, "--json", ...args]);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};

test("each scope answers its own set and names itself", () => {
  const fx = fixture();
  const cases = [
    [[], "active", [fx.open]],
    [["--scope", "active"], "active", [fx.open]],
    [["--scope", "archived"], "archived", [fx.closed]],
    [["--scope", "all"], "all", [fx.open, fx.closed]],
  ];
  for (const [args, scope, ids] of cases) {
    const answer = ask(fx.dir, ...args);
    assert.equal(answer.scope, scope, args.join(" "));
    assert.deepEqual(answer.tasks.map((t) => t.id).sort(), ids.slice().sort(), args.join(" "));
  }
  // --status chooses the statuses itself, so no scope is named.
  assert.equal(ask(fx.dir, "--status", "cancelled").scope, null);
  // The other criteria still narrow a scope.
  assert.deepEqual(ask(fx.dir, "--scope", "all", "--text", "closed").tasks.map((t) => t.id), [fx.closed]);
});

test("--scope with --status, and an unknown scope, are usage errors", () => {
  const fx = fixture();
  for (const args of [["--scope", "all", "--status", "pending"], ["--scope", "everything"]]) {
    const r = run(["query", "--dir", fx.dir, "--json", ...args]);
    assert.equal(r.status, 2, args.join(" "));
    assert.equal(r.stdout, "");
  }
});
