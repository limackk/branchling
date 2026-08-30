/**
 * Dangling `blocked_by` / `blocks` (BL-1451).
 *
 * The defect: a reference to a task that does not exist passed `build` AND
 * `check` in silence. That is worse than a loud error, because `blocked_by` is
 * the field the tool answers "can I take this?" with — a task blocked by
 * nothing looks exactly like a task that has to wait.
 *
 * These references do not come from typos. They come from DELETING or MOVING a
 * task, which every backlog split, archive-with-delete and cross-repo migration
 * does. The guard therefore judges the SET, like the id-collision guard, not
 * one file at a time.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SCRIPTS_DIR, TASKS_DIR } from "./_repo.mjs";

const GUARD = join(SCRIPTS_DIR, "check-backlog-refs.mjs");
const CLI = join(SCRIPTS_DIR, "cli.mjs");

function task(dir, id, { blocked_by = [], blocks = [], status = "pending" } = {}) {
  writeFileSync(
    join(dir, "tasks", `${id}-x.md`),
    [
      "---",
      `id: ${id}`,
      'title: "T"',
      "type: code",
      "labels: []",
      "board: main",
      'epic: ""',
      "priority: P1",
      `status: ${status}`,
      "owner: unassigned",
      "estimate: 2h",
      "confidence: high",
      "created: 2026-08-01",
      "updated: 2026-08-01",
      `blocked_by: [${blocked_by.join(", ")}]`,
      `blocks: [${blocks.join(", ")}]`,
      "---",
      "",
      "## Cel",
      "",
      "x",
      "",
    ].join("\n"),
    "utf8",
  );
}

function sandbox(build) {
  const dir = mkdtempSync(join(tmpdir(), "worktrail-refs-"));
  mkdirSync(join(dir, "tasks"));
  writeFileSync(join(dir, "_template.md"), "---\nid: BL-NNN\n---\n", "utf8");
  writeFileSync(join(dir, "boards.yaml"), 'default: main\nboards:\n  - slug: main\n    name: "Main"\n', "utf8");
  build(dir);
  return dir;
}

function run(args) {
  const r = spawnSync(process.execPath, [GUARD, ...args], { encoding: "utf8" });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

function withSandbox(build, fn) {
  const dir = sandbox(build);
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("blocked_by pointing at a NON-EXISTENT number fails", () => {
  withSandbox(
    (d) => {
      task(d, "BL-100", { blocked_by: ["BL-999"] });
    },
    (dir) => {
      const r = run(["--dir", dir]);
      assert.notEqual(r.code, 0, "a dangling blocked_by went through: " + r.out);
      assert.match(r.out, /BL-100/, "the message does not say WHICH task is broken");
      assert.match(r.out, /BL-999/, "the message does not say WHAT it points at");
      assert.match(r.out, /blocked_by/, "the message does not say WHICH field");
    },
  );
});

test("blocks is checked in the same pass", () => {
  withSandbox(
    (d) => {
      task(d, "BL-100", { blocks: ["BL-998"] });
    },
    (dir) => {
      const r = run(["--dir", dir]);
      assert.notEqual(r.code, 0, "a dangling blocks went through: " + r.out);
      assert.match(r.out, /BL-998/);
    },
  );
});

test("a reference to a DONE task passes — \"closed\" is not \"gone\"", () => {
  // Without this test the simplest fix ("references must point at an ACTIVE
  // task") would look correct and would force people to delete real dependency
  // history.
  withSandbox(
    (d) => {
      task(d, "BL-100", { blocked_by: ["BL-101"] });
      task(d, "BL-101", { status: "done" });
    },
    (dir) => {
      const r = run(["--dir", dir]);
      assert.equal(r.code, 0, "a reference to a closed blocker failed: " + r.out);
    },
  );
});

test("a healthy tree passes and SAYS how many references it checked", () => {
  // A positive control built into the message: a "✓" over zero references means
  // "there was nothing to check", not "I checked and it is fine".
  withSandbox(
    (d) => {
      task(d, "BL-100", { blocked_by: ["BL-101"], blocks: ["BL-102"] });
      task(d, "BL-101");
      task(d, "BL-102");
    },
    (dir) => {
      const r = run(["--dir", dir]);
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /2 blocked_by\/blocks references/, "the guard did not give the number of references checked: " + r.out);
    },
  );
});

test("an EMPTY tree does not fake success", () => {
  withSandbox(
    () => {},
    (dir) => {
      const r = run(["--dir", dir]);
      const m = r.out.match(/(\d+) blocked_by\/blocks references/);
      assert.ok(m, "no count in the message: " + r.out);
      assert.equal(m[1], "0", "the guard invented references on an empty tree");
    },
  );
});

test("an entry in a format outside `BL-NNN` fails and SAYS where to record an external dependency", () => {
  // The fields accept only numbers from THIS backlog (`itemPattern` in
  // task-fields.mjs). A cross-repo dependency cannot be resolved — the tool does
  // not know whether `worktrail#BL-1` is done — so it lives in prose, and the guard
  // has to say so instead of staying silent.
  withSandbox(
    (d) => {
      task(d, "BL-100", { blocked_by: ["inne-repo#BL-1"] });
    },
    (dir) => {
      const r = run(["--dir", dir]);
      assert.notEqual(r.code, 0, "a foreign format went through: " + r.out);
      assert.match(r.out, /inne-repo#BL-1/);
      assert.match(r.out, /## Log|prose/i, "the message does not say what to do about it: " + r.out);
    },
  );
});

test("`check --refs` runs ONLY this guard, and a selector-less `check` includes it", () => {
  withSandbox(
    (d) => {
      task(d, "BL-100", { blocked_by: ["BL-999"] });
    },
    (dir) => {
      const only = spawnSync(process.execPath, [CLI, "check", "--dir", dir, "--refs"], { encoding: "utf8" });
      const outOnly = (only.stdout || "") + (only.stderr || "");
      assert.notEqual(only.status, 0, "check --refs did not fail: " + outOnly);
      assert.ok(!/each TL-NNN used once|each TASK-NNN used once/.test(outOnly), "the collision guard ran too: " + outOnly);

      const all = spawnSync(process.execPath, [CLI, "check", "--dir", dir], { encoding: "utf8" });
      assert.notEqual(all.status, 0, "the default `check` let a dangling reference through");
    },
  );
});

test("the real tree of THIS repository is clean — and on a non-zero sample", () => {
  const r = run(["--dir", join(TASKS_DIR, "..")]);
  assert.equal(r.code, 0, r.out);
  const m = r.out.match(/(\d+) blocked_by\/blocks references/);
  assert.ok(m && Number(m[1]) > 0, "zero references checked — green with no evidential force: " + r.out);
});
