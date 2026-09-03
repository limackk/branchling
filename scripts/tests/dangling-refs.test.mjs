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
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isolateHome, SCRIPTS_DIR, TASKS_DIR } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("dangling-refs");

import { staleBlocked } from "../check-backlog-refs.mjs";

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
  const dir = mkdtempSync(join(tmpdir(), "branchling-refs-"));
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
  // not know whether `branchling#BL-1` is done — so it lives in prose, and the guard
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

// ── A task file PATH written in prose (TL-138) ────────────────────────────
//
// A THIRD question of the same tree, and a different defect again: the fields
// are correct, and a path in the body points at a filename that no longer
// exists. It happened here — a product rename rewrote `branchling` in PROSE
// while the slugs on disk kept the old word — and nothing saw it, because the
// reference check reads ids and not paths.

/** Append prose to a task the `task()` helper already wrote. */
function body(dir, id, text) {
  const file = join(dir, "tasks", `${id}-x.md`);
  writeFileSync(file, readFileSync(file, "utf8") + text + "\n", "utf8");
}

test("a path to a task file that does not exist fails, and says what it meant", () => {
  withSandbox(
    (dir) => {
      config(dir, []);
      task(dir, "BL-1");
      task(dir, "BL-2");
      // The exact accident: right id, stale slug.
      body(dir, "BL-2", "Pre-flight: `backlog/tasks/BL-1-renamed.md` explains why.");
    },
    (dir) => {
      const r = run(["--dir", dir]);
      assert.equal(r.code, 1, "a path leading nowhere passed: " + r.out);
      assert.match(r.out, /BL-1-renamed\.md/);
      assert.match(r.out, /BL-1 is `BL-1-x\.md`/, "the guard did not resolve the id to the real file");
    },
  );
});

test("POSITIVE CONTROL: the same path, spelled right, passes and is COUNTED", () => {
  // Without this the test above passes just as well against a guard that
  // rejects every path it sees.
  withSandbox(
    (dir) => {
      config(dir, []);
      task(dir, "BL-1");
      task(dir, "BL-2");
      body(dir, "BL-2", "Pre-flight: `backlog/tasks/BL-1-x.md` explains why.");
    },
    (dir) => {
      const r = run(["--dir", dir]);
      assert.equal(r.code, 0, r.out);
      const m = r.out.match(/(\d+) path\(s\) to a task file written in prose/);
      assert.ok(m && Number(m[1]) === 1, "the path was not checked at all: " + r.out);
    },
  );
});

test("a filename NOT written as a path is data about a name, not a pointer", () => {
  // A task reporting broken paths has to quote them, and the quotation must not
  // be the very thing that fails the guard. What promises to resolve is a path;
  // a bare name in a list does not.
  withSandbox(
    (dir) => {
      config(dir, []);
      task(dir, "BL-1");
      body(dir, "BL-1", "Broken, measured on 2026-09-01:\n\n    BL-1-gone-forever.md\n");
    },
    (dir) => {
      const r = run(["--dir", dir]);
      assert.equal(r.code, 0, "a quoted filename was read as a path: " + r.out);
    },
  );
});

test("the real tree of THIS repository has no path leading nowhere, on a non-zero sample", () => {
  const r = run(["--dir", join(TASKS_DIR, "..")]);
  assert.equal(r.code, 0, r.out);
  const m = r.out.match(/(\d+) path\(s\) to a task file written in prose/);
  assert.ok(m && Number(m[1]) > 0, "zero paths checked — green with no evidential force: " + r.out);
});

// ── A blocking status whose blockers have all closed (TL-134) ─────────────
//
// A DIFFERENT DEFECT from a dangling reference: every reference here is correct
// and closed. The rule above cannot see it, and this file asserts both — the
// same tree passes the reference check and is reported by this one.

/** A config declaring the fixture's OWN vocabulary. The status called "blocked"
 *  is this repository's word; the guard must work off `config.yaml`, so the
 *  fixture uses names no project of ours uses. */
function config(dir, lines) {
  writeFileSync(join(dir, "config.yaml"), [
    "task_id_prefix: BL",
    "statuses: [queued, running, parked, shipped]",
    "archived_statuses: [shipped]",
    "dashboard_open_statuses: [queued, running, parked]",
    "in_progress_status: running",
    "reason_required_statuses: [parked]",
    ...(lines || []),
  ].join("\n") + "\n", "utf8");
}

test("a task PARKED behind blockers that have all closed is reported", () => {
  withSandbox(
    (d) => {
      config(d);
      task(d, "BL-100", { status: "parked", blocked_by: ["BL-101"] });
      task(d, "BL-101", { status: "shipped" });
    },
    (dir) => {
      const r = run(["--dir", dir]);
      // Reported, not failed: closing a blocker and lifting the status are two
      // writes, so a tree caught between them is mid-work rather than broken.
      assert.equal(r.code, 0, "a self-correcting state failed the build: " + r.out);
      assert.match(r.out, /BL-100/, "the report does not say WHICH task");
      assert.match(r.out, /BL-101/, "the report does not say which blockers closed");
      assert.match(r.out, /parked/, "the report does not name the status from config.yaml");
    },
  );
});

test("POSITIVE CONTROL: the same shape with one blocker still open is NOT reported", () => {
  withSandbox(
    (d) => {
      config(d);
      task(d, "BL-100", { status: "parked", blocked_by: ["BL-101", "BL-102"] });
      task(d, "BL-101", { status: "shipped" });
      task(d, "BL-102", { status: "queued" });
    },
    (dir) => {
      const r = run(["--dir", dir]);
      assert.equal(r.code, 0, r.out);
      assert.doesNotMatch(r.out, /blocking status/, "a task with an open blocker was reported: " + r.out);
    },
  );
});

test("a parked task with an EMPTY blocked_by is not reported — nothing here can judge it", () => {
  withSandbox(
    (d) => {
      config(d);
      task(d, "BL-100", { status: "parked" });
    },
    (dir) => {
      const r = run(["--dir", dir]);
      assert.equal(r.code, 0, r.out);
      assert.doesNotMatch(r.out, /blocking status/, r.out);
    },
  );
});

test("the status comes from config.yaml: rename it and the rule follows", () => {
  withSandbox(
    (d) => {
      writeFileSync(join(d, "config.yaml"), [
        "task_id_prefix: BL",
        "statuses: [queued, running, waiting, shipped]",
        "archived_statuses: [shipped]",
        "dashboard_open_statuses: [queued, running, waiting]",
        "in_progress_status: running",
        "reason_required_statuses: [waiting]",
      ].join("\n") + "\n", "utf8");
      task(d, "BL-100", { status: "waiting", blocked_by: ["BL-101"] });
      task(d, "BL-101", { status: "shipped" });
    },
    (dir) => {
      const r = run(["--dir", dir]);
      assert.match(r.out, /waiting/, "the rule did not follow the project's own word: " + r.out);
    },
  );
});

test("a status NOT protected by reason_required_statuses is nobody's decision to have made", () => {
  withSandbox(
    (d) => {
      config(d);
      // `queued` is an ordinary status: a task sitting in it behind closed
      // blockers is just a task waiting to be picked up.
      task(d, "BL-100", { status: "queued", blocked_by: ["BL-101"] });
      task(d, "BL-101", { status: "shipped" });
    },
    (dir) => {
      const r = run(["--dir", dir]);
      assert.doesNotMatch(r.out, /blocking status/, r.out);
    },
  );
});

test("the guard changes nothing: the file is byte for byte what it was", () => {
  withSandbox(
    (d) => {
      config(d);
      task(d, "BL-100", { status: "parked", blocked_by: ["BL-101"] });
      task(d, "BL-101", { status: "shipped" });
    },
    (dir) => {
      const file = join(dir, "tasks", "BL-100-x.md");
      const before = readFileSync(file, "utf8");
      run(["--dir", dir]);
      assert.equal(readFileSync(file, "utf8"), before);
    },
  );
});

test("a stale reference and a stale status are reported as TWO defects, not one", () => {
  withSandbox(
    (d) => {
      config(d);
      task(d, "BL-100", { status: "parked", blocked_by: ["BL-101"] });
      task(d, "BL-101", { status: "shipped" });
      task(d, "BL-102", { blocked_by: ["BL-999"] });
    },
    (dir) => {
      const r = run(["--dir", dir]);
      assert.notEqual(r.code, 0, "the dangling reference stopped failing: " + r.out);
      assert.match(r.out, /BL-999/);
      assert.match(r.out, /blocking status/);
    },
  );
});

test("staleBlocked, without a tree", () => {
  const config_ = { archivedStatuses: ["shipped"], reasonRequiredStatuses: ["parked", "shipped"] };
  const tasks = [
    { id: "BL-1", file: "a", status: "parked", blocked_by: ["BL-2"] },
    { id: "BL-2", file: "b", status: "shipped", blocked_by: [] },
    // A blocker that is not in the tree at all: that is the dangling-reference
    // defect, and saying it twice would report one problem as two.
    { id: "BL-3", file: "c", status: "parked", blocked_by: ["BL-404"] },
    // A protected status that is ALSO archived is not a blocking one.
    { id: "BL-4", file: "d", status: "shipped", blocked_by: ["BL-2"] },
  ];
  assert.deepEqual(staleBlocked(tasks, config_).map((t) => t.id), ["BL-1"]);
});
