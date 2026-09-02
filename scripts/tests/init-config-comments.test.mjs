/**
 * The generated `config.yaml` says what changing each key costs (TL-63).
 *
 * WHY A TEST ON COMMENTS. This file is realistically the only document opened by
 * somebody adapting the tool to their own project — so its content is an
 * interface, not an ornament. We test two things that are easy to break without
 * noticing: that a comment does not upset the narrow parser, and that the
 * classification AGREES with what the code actually enforces. A comment saying
 * "free" next to a key that requires a migration is worse than no comment.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig, parseConfigYaml } from "../config.mjs";

import { isolateHome } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("init-config-comments");

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "cli.mjs");

function run(cwd, args) {
  return spawnSync(process.execPath, [CLI].concat(args), { cwd, encoding: "utf8", timeout: 30_000 });
}

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), "worktrail-cfgdoc-"));
  assert.equal(run(dir, ["init", "--dir", ".", "--no-example"]).status, 0);
  return dir;
}

function configText(dir) {
  return readFileSync(join(dir, "config.yaml"), "utf8");
}

test("comments do not upset the narrow parser", () => {
  const dir = fresh();
  const { problems } = parseConfigYaml(configText(dir));
  assert.deepEqual(problems, [], "the generated file does not parse cleanly: " + problems.join("; "));
  assert.doesNotThrow(() => loadConfig(dir));
});

test("the legend of the three classes stands in the header", () => {
  const text = configText(fresh());
  for (const cls of ["[free]", "[tree]", "[migration]"]) {
    assert.ok(text.includes(cls), "no class " + cls);
  }
});

test("every vocabulary has a class assigned", () => {
  const text = configText(fresh());
  const lines = text.split("\n");
  for (const key of ["project_name", "task_id_prefix", "statuses", "priorities", "types", "labels", "owners", "estimates", "actors", "title_max_length"]) {
    const at = lines.findIndex((l) => l.startsWith(key + ":"));
    assert.notEqual(at, -1, "the key `" + key + "` is missing from the template");
    // The class stands either on that line or in the comment directly above the block.
    const window = lines.slice(Math.max(0, at - 5), at + 1).join("\n");
    assert.match(window, /\[(free|tree|migration)\]/, "the key `" + key + "` has no change class");
  }
});

test("`statuses` names both keys that have to be corrected together with it", () => {
  const text = configText(fresh());
  const at = text.indexOf("statuses: [pending");
  const above = text.slice(Math.max(0, at - 400), at);
  assert.match(above, /TOGETHER/, "it does not warn that two keys have to be corrected together");
  assert.ok(text.includes("archived_statuses"), "no archived_statuses");
  assert.ok(text.includes("dashboard_open_statuses"), "no dashboard_open_statuses");
});

// ── The classification has to be true, not pretty ─────────────────────────

test("positive control: [migration] on the prefix matches what the code does", () => {
  const dir = fresh();
  assert.equal(run(dir, ["new", "--title", "A task"]).status, 0);
  const p = join(dir, "config.yaml");
  writeFileSync(p, readFileSync(p, "utf8").replace(/^task_id_prefix: .*$/m, "task_id_prefix: INNY"), "utf8");

  assert.notEqual(run(dir, ["build"]).status, 0, "the prefix is marked [migration], yet the change goes through with nothing else");
  assert.notEqual(run(dir, ["new", "--title", "Drugie"]).status, 0);
});

test("positive control: [free] next to the priorities really is free", () => {
  const dir = fresh();
  assert.equal(run(dir, ["new", "--title", "A task"]).status, 0);
  const p = join(dir, "config.yaml");
  writeFileSync(p, readFileSync(p, "utf8").replace(/^estimates: .*$/m, "estimates: [15m, 3h, 2d]"), "utf8");
  assert.equal(run(dir, ["build"]).status, 0, "a key marked [free] breaks the build");
});

test("`statuses` changed on its own fails — so the warning does not lie", () => {
  const dir = fresh();
  const p = join(dir, "config.yaml");
  writeFileSync(p, readFileSync(p, "utf8").replace(/^statuses: .*$/m, "statuses: [todo, doing, shipped]"), "utf8");
  const r = run(dir, ["build"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /archived_statuses/);
});
