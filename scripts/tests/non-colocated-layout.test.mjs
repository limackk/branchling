#!/usr/bin/env node
/**
 * The code and the data do NOT have to live in one directory (BL-1445).
 *
 * BL-1399 turned the data directory into an argument, but two scripts were left
 * with their own `join(__dirname, "..")` fallback — that is, pure co-location,
 * bypassing `resolveBacklogDir()`. In a repository where the code and the data lie
 * together (`backlog/scripts` next to `backlog/tasks`), that difference is
 * invisible: both ways give the same directory.
 *
 * It shows only in the layout the module is intended for — code in
 * `<repo>/scripts`, data in `<repo>/backlog`. There `__dirname/..` is the ROOT
 * of the REPO, not the backlog, and the generator looks for `boards.yaml` in the
 * wrong place. Found at the first real `worktrail init` in the extracted repository.
 *
 * This test reproduces that layout. Before the fix it FAILS, and that is its only
 * reason to exist: without it the regression comes back with every installation in
 * which the code does not lie above the data — that is, with EVERY npm install.
 */

import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(HERE, "..");

/** Builds a tree shaped like the extracted repo: code BESIDE the data, not ABOVE it. */
function makeSplitRepo() {
  const root = mkdtempSync(join(tmpdir(), "worktrail-split-"));
  cpSync(SCRIPTS, join(root, "scripts"), { recursive: true });

  const bl = join(root, "backlog");
  mkdirSync(join(bl, "tasks"), { recursive: true });
  mkdirSync(join(bl, "history"), { recursive: true });
  mkdirSync(join(bl, "archive"), { recursive: true });
  writeFileSync(join(bl, "config.yaml"), 'project_name: "probe"\n');
  writeFileSync(
    join(bl, "boards.yaml"),
    "default: main\nboards:\n  - slug: main\n    name: \"Main\"\n"
  );
  writeFileSync(join(bl, "_template.md"), "# szablon\n");
  writeFileSync(
    join(bl, "tasks", "BL-001-probe.md"),
    [
      "---",
      "id: BL-001",
      'title: "Probe"',
      "type: task",
      "labels: []",
      "board: main",
      'epic: ""',
      "priority: P2",
      "status: pending",
      "owner: unassigned",
      "estimate: 2h",
      "confidence: medium",
      "created: 2026-08-30",
      "updated: 2026-08-30",
      "blocked_by: []",
      "blocks: []",
      "---",
      "",
      "## Cel",
      "",
      "Probe.",
      "",
    ].join("\n")
  );
  return root;
}

test("build finds the backlog when the code lies BESIDE the data, not above it", () => {
  const root = makeSplitRepo();
  try {
    const out = execFileSync(
      process.execPath,
      [join(root, "scripts", "build-backlog.mjs")],
      { cwd: root, encoding: "utf8", env: { ...process.env, BACKLOG_DIR: "" } }
    );
    assert.match(out, /generated/, "the generator has to build the views: " + out);
    assert.ok(
      existsSync(join(root, "backlog", "INDEX.yaml")),
      "INDEX.yaml has to appear in the backlog, not in the repository root"
    );
    assert.ok(
      !existsSync(join(root, "INDEX.yaml")),
      "nothing may land in the repository root"
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("check finds the tasks when the code lies BESIDE the data", () => {
  const root = makeSplitRepo();
  try {
    const out = execFileSync(
      process.execPath,
      [join(root, "scripts", "cli.mjs"), "check"],
      { cwd: root, encoding: "utf8", env: { ...process.env, BACKLOG_DIR: "" } }
    );
    // A green result on ZERO tasks would be a false pass — the guard has to see
    // the one task we put there.
    assert.match(out, /1 task/, "check has to count the task from the backlog: " + out);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
