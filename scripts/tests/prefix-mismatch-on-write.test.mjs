/**
 * A prefix mismatch stops the WRITING OF A TASK, not just the rebuild (TL-61).
 *
 * WHY A SEPARATE FILE. The `detectPrefixMismatch` gate was tested from `build`'s
 * side and worked there. The defect lay in WHERE it stood: `build` refused while
 * `branchling new` in the same tree happily appended a task under the new prefix. A
 * test that asks only about `build` passed for the whole lifetime of that defect
 * — so the question has to be put to the command that writes.
 *
 * THE POSITIVE CONTROL matters here more than usual: a gate that blocks TOO MUCH
 * would break the most common onboarding step — changing the prefix to your own
 * just after `branchling init`, while the tree is still empty. So next to an assertion
 * refuse" there stands an assertion "it has to let this through".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { isolateHome } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("prefix-mismatch-on-write");

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "cli.mjs");

function run(cwd, args) {
  return spawnSync(process.execPath, [CLI].concat(args), { cwd, encoding: "utf8", timeout: 30_000 });
}

function backlog() {
  const dir = mkdtempSync(join(tmpdir(), "branchling-prefix-"));
  // `--no-example` (TL-64): "an empty tree" has to mean EMPTY here. The example
  // task would make the positive control examine a tree with one task in it —
  // that is, exactly the case it is meant to tell apart.
  assert.equal(run(dir, ["init", "--dir", ".", "--no-example"]).status, 0);
  return dir;
}

function setPrefix(dir, prefix) {
  const p = join(dir, "config.yaml");
  writeFileSync(p, readFileSync(p, "utf8").replace(/^task_id_prefix: .*$/m, "task_id_prefix: " + prefix), "utf8");
}

function taskFiles(dir) {
  return readdirSync(join(dir, "tasks")).filter((f) => f.endsWith(".md"));
}

test("positive control: on an EMPTY tree changing the prefix still works", () => {
  const dir = backlog();
  setPrefix(dir, "ACME");
  const r = run(dir, ["new", "--title", "First task"]);
  assert.equal(r.status, 0, "the gate blocks the most common onboarding step:\n" + r.stderr);
  assert.deepEqual(taskFiles(dir).map((f) => f.split("-")[0]), ["ACME"]);
});

test("a mismatch with the tree: `new` refuses and writes NOTHING", () => {
  const dir = backlog();
  assert.equal(run(dir, ["new", "--title", "First"]).status, 0);
  const before = taskFiles(dir);

  setPrefix(dir, "OTHER");
  const r = run(dir, ["new", "--title", "Second"]);

  assert.notEqual(r.status, 0, "it wrote the task despite the prefix mismatch");
  assert.deepEqual(taskFiles(dir), before, "the tree changed despite the refusal");
});

test("the message points at migrate-prefix and names both prefixes", () => {
  const dir = backlog();
  run(dir, ["new", "--title", "First"]);
  setPrefix(dir, "OTHER");
  const err = run(dir, ["new", "--title", "Second"]).stderr;

  assert.match(err, /migrate-prefix --to OTHER/, "it does not name the way to renumber");
  assert.match(err, /--dry-run/, "it does not say to look first without writing");
  assert.match(err, /TASK/, "it does not name the prefix that IS in the tree");
});

test("the `new` message talks about tasks, and `build` about views", () => {
  // A shared cause, a shared way out, a DIFFERENT consequence. A message describing
  // somebody else's failure sends the reader looking in the wrong place.
  const dir = backlog();
  run(dir, ["new", "--title", "First"]);
  setPrefix(dir, "OTHER");

  assert.match(run(dir, ["new", "--title", "Second"]).stderr, /two\s+number spaces/);
  assert.match(run(dir, ["build"]).stderr, /views would be rebuilt[\s\S]*as EMPTY/);
});

test("build still refuses — the gate did not move, it widened", () => {
  const dir = backlog();
  run(dir, ["new", "--title", "First"]);
  setPrefix(dir, "OTHER");
  assert.notEqual(run(dir, ["build"]).status, 0);
});
